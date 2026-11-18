const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const NodeCache = require('node-cache');

const {
  createWebhookRouter,
  computeSignature,
  verifySignature,
  parseSignatureHeader,
  mapAccountEvent,
  processEvent,
  WEBHOOK_PATH,
} = require('../../unipileV2/webhook');
const { createAccountStore } = require('../../unipileV2/services/accountStore');

const SECRET = 'whsec_test_123';
const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (body, secret = SECRET, t = nowSec()) =>
  `t=${t},v0=${computeSignature(secret, String(t), Buffer.from(body))}`;

// ---------------------------------------------------------------- fakes

/** In-memory stand-in for the account store, recording calls. */
function fakeStore(provider, docs = []) {
  const calls = [];
  const store = {
    provider,
    docs,
    calls,
    async findByUserId(userId) {
      return docs.find((d) => d.user_id === String(userId) && d.provider === provider) || null;
    },
    async findByAnyAccountId(id) {
      return docs.find((d) => d.account_id === id || d.v2_account_id === id) || null;
    },
    async linkV2Account(docId, v2Id) {
      calls.push(['linkV2Account', docId, v2Id]);
      const doc = docs.find((d) => d._id === docId);
      if (doc) doc.v2_account_id = v2Id;
    },
    async applyStatus(docId, change) {
      calls.push(['applyStatus', docId, change]);
    },
    async upsertForUser(userId, data) {
      calls.push(['upsertForUser', userId, data]);
      return 'created';
    },
  };
  return store;
}

function deps({ store, writePrimary = false, apiAccount = null, eventCache = new NodeCache() } = {}) {
  const apiCalls = [];
  return {
    writePrimary,
    storeForProvider: (p) => (String(p).toUpperCase() === store?.provider ? store : null),
    apiClient: {
      async get(path) {
        apiCalls.push(path);
        if (!apiAccount) throw Object.assign(new Error('not found'), { response: { status: 404 } });
        return { data: apiAccount };
      },
    },
    eventCache,
    log: () => {},
    apiCalls,
  };
}

// ---------------------------------------------------------------- signature

test('parseSignatureHeader reads t and every v0', () => {
  assert.deepEqual(parseSignatureHeader('t=123,v0=abc,v0=def'), { t: '123', v0: ['abc', 'def'] });
  assert.deepEqual(parseSignatureHeader(undefined), { t: null, v0: [] });
});

test('verifySignature accepts a valid signature over the raw body', () => {
  const body = '{"type":"account.add","id":"evt_1"}';
  assert.deepEqual(verifySignature({ header: sign(body), rawBody: Buffer.from(body), secret: SECRET }), { ok: true });
});

test('verifySignature rejects tampered body, wrong secret, stale timestamp, missing header/secret', () => {
  const body = '{"type":"account.add"}';
  const header = sign(body);
  assert.equal(verifySignature({ header, rawBody: Buffer.from(body + ' '), secret: SECRET }).reason, 'signature_mismatch');
  assert.equal(verifySignature({ header, rawBody: Buffer.from(body), secret: 'other' }).reason, 'signature_mismatch');
  const stale = sign(body, SECRET, nowSec() - 301);
  assert.equal(verifySignature({ header: stale, rawBody: Buffer.from(body), secret: SECRET }).reason, 'timestamp_out_of_tolerance');
  assert.equal(verifySignature({ header: undefined, rawBody: Buffer.from(body), secret: SECRET }).reason, 'missing_signature');
  assert.equal(verifySignature({ header, rawBody: Buffer.from(body), secret: '' }).reason, 'secret_not_configured');
});

test('verifySignature accepts when any of several v0 values matches', () => {
  const body = '{}';
  const t = nowSec();
  const good = computeSignature(SECRET, String(t), Buffer.from(body));
  const header = `t=${t},v0=deadbeef,v0=${good}`;
  assert.equal(verifySignature({ header, rawBody: Buffer.from(body), secret: SECRET }).ok, true);
});

// ---------------------------------------------------------------- mapping

test('account events map to the v1 status vocabulary', () => {
  assert.deepEqual(
    ['account.add', 'account.reconnect', 'account.status.running', 'account.status.disconnected', 'account.status.errored', 'account.remove']
      .map((t) => [t, mapAccountEvent(t).status, mapAccountEvent(t).connected]),
    [
      ['account.add', 'CREATION_SUCCESS', true],
      ['account.reconnect', 'RECONNECTED', true],
      ['account.status.running', 'OK', true],
      ['account.status.disconnected', 'CREDENTIALS', false],
      ['account.status.errored', 'ERROR', false],
      ['account.remove', 'DELETED', false],
    ],
  );
  assert.equal(mapAccountEvent('account.status.degraded').status, null);
  assert.equal(mapAccountEvent('account.status.partial').status, null);
  assert.equal(mapAccountEvent('nope'), null);
});

// ---------------------------------------------------------------- processing

const migratedDoc = () => ({ _id: 'doc1', user_id: '11092', provider: 'LINKEDIN', account_id: 'v1_ABC' });

test('v1 mode: migrated account is linked via metadata.v1_account_id and only v2 fields change', async () => {
  const store = fakeStore('LINKEDIN', [migratedDoc()]);
  const d = deps({ store, writePrimary: false, apiAccount: { id: 'acc_1', metadata: { v1_account_id: 'v1_ABC' } } });
  const result = await processEvent(
    { id: 'evt_1', type: 'account.status.disconnected', account_id: 'acc_1', account_provider: 'linkedin', payload: { timestamp: 'x' } },
    d,
  );
  assert.equal(result.handled, true);
  assert.equal(result.via, 'v1_account_id');
  assert.deepEqual(d.apiCalls, ['/accounts/acc_1']);
  assert.deepEqual(store.calls[0], ['linkV2Account', 'doc1', 'acc_1']);
  const [, , change] = store.calls[1];
  assert.equal(change.writePrimary, false);
  assert.equal(change.v2Status, 'disconnected');
  assert.equal(change.status, 'CREDENTIALS');
});

test('v2 mode: already-linked account writes the primary status', async () => {
  const store = fakeStore('LINKEDIN', [{ ...migratedDoc(), v2_account_id: 'acc_1' }]);
  const d = deps({ store, writePrimary: true });
  const result = await processEvent(
    { type: 'account.status.errored', account_id: 'acc_1', account_provider: 'LINKEDIN', payload: { reason: 'proxy' } },
    d,
  );
  assert.equal(result.via, 'v2_account_id');
  assert.deepEqual(d.apiCalls, [], 'no Unipile lookup needed');
  const [, , change] = store.calls[0];
  assert.equal(change.writePrimary, true);
  assert.equal(change.status, 'ERROR');
  assert.equal(change.reason, 'proxy');
});

test('v2 mode: account.add with hosted-auth state upserts the user record', async () => {
  const store = fakeStore('WHATSAPP', []);
  const d = deps({ store, writePrimary: true });
  const result = await processEvent(
    { type: 'account.add', account_id: 'acc_new', account_provider: 'whatsapp', payload: { state: '555', account: { id: 'acc_new', name: 'WhatsApp +91' } } },
    d,
  );
  assert.equal(result.handled, true);
  assert.equal(result.via, 'state_upsert');
  assert.equal(store.calls[0][0], 'upsertForUser');
  assert.equal(store.calls[0][1], '555');
  assert.equal(store.calls[0][2].v2AccountId, 'acc_new');
  assert.equal(store.calls[0][2].status, 'CREATION_SUCCESS');
});

test('v1 mode: account.add for an unknown user never creates a record', async () => {
  const store = fakeStore('LINKEDIN', []);
  const d = deps({ store, writePrimary: false, apiAccount: { id: 'acc_x', metadata: {} } });
  const result = await processEvent(
    { type: 'account.add', account_id: 'acc_x', account_provider: 'linkedin', payload: { state: '999', account: { id: 'acc_x' } } },
    d,
  );
  assert.equal(result.handled, false);
  assert.equal(result.reason, 'unmatched_account');
  assert.equal(store.calls.length, 0);
});

test('events for providers we do not use are ignored', async () => {
  const d = deps({ store: fakeStore('LINKEDIN') });
  const result = await processEvent({ type: 'account.add', account_id: 'acc_g', account_provider: 'google', payload: {} }, d);
  assert.equal(result.handled, false);
  assert.match(result.reason, /unsupported_provider/);
});

test('message receipts are cached under the v1 keys', async () => {
  const cache = new NodeCache();
  const d = deps({ store: fakeStore('WHATSAPP'), eventCache: cache });
  await processEvent({ type: 'message.receipt.delivery', account_id: 'acc_1', account_provider: 'whatsapp', payload: { message_id: 'm1', chat_id: 'c1' } }, d);
  await processEvent({ type: 'message.receipt.read', account_id: 'acc_1', account_provider: 'whatsapp', payload: { message_id: 'm1', chat_id: 'c1' } }, d);
  const status = cache.get('msg_status:m1');
  assert.equal(status.delivered, true);
  assert.equal(status.seen, true);
  await processEvent({ type: 'message.new', id: 'evt_9', account_id: 'acc_1', account_provider: 'whatsapp', payload: { id: 'm2', text: 'hi' } }, d);
  assert.equal(cache.get('incoming_msg:m2').text, 'hi');
  const removed = await processEvent({ type: 'message.reaction.delete', account_id: 'acc_1', account_provider: 'whatsapp', payload: { message_id: 'm2', reaction: '👍' } }, d);
  assert.equal(removed.handled, true);
  assert.equal(cache.get('msg_event:m2').event, 'message.reaction.delete');
});

// ---------------------------------------------------------------- account store

test('accountStore.applyStatus only touches primary fields when writePrimary is true', async () => {
  const updates = [];
  const store = createAccountStore({
    provider: 'LINKEDIN',
    collectionName: 'x',
    getCollection: async () => ({ updateOne: async (filter, update) => updates.push(update) }),
  });
  await store.applyStatus('id1', { v2Status: 'disconnected', status: 'CREDENTIALS', connected: false, eventType: 'account.status.disconnected', writePrimary: false });
  await store.applyStatus('id1', { v2Status: 'disconnected', status: 'CREDENTIALS', connected: false, eventType: 'account.status.disconnected', writePrimary: true });
  assert.equal(updates[0].$set.v2_status, 'disconnected');
  assert.equal('status' in updates[0].$set, false);
  assert.equal('connected' in updates[0].$set, false);
  assert.equal(updates[1].$set.status, 'CREDENTIALS');
  assert.equal(updates[1].$set.connected, false);
});

test('accountStore ignores other-provider and temp_ records', async () => {
  const docs = [
    { _id: 1, user_id: 'temp_abc_1', provider: 'LINKEDIN', account_id: 'v1_X' },
    { _id: 2, user_id: '9426', provider: 'LINKEDIN', account_id: 'v1_X' },
    { _id: 3, user_id: '919110397112', provider: 'WHATSAPP', account_id: 'v1_W' }, // v1 webhook junk
  ];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some((f) => matches(doc, f));
      if (v instanceof RegExp) return v.test(doc[k]);
      if (v && v.$not) return !v.$not.test(doc[k]);
      return doc[k] === v;
    });
  const fakeCol = {
    find: (filter) => {
      const rows = docs.filter((d) => matches(d, filter));
      const cursor = { limit: () => cursor, project: () => cursor, toArray: async () => rows };
      return cursor;
    },
    countDocuments: async (filter) => docs.filter((d) => matches(d, filter)).length,
    updateMany: async () => ({}),
  };
  const store = createAccountStore({ provider: 'LINKEDIN', collectionName: 'x', getCollection: async () => fakeCol });

  assert.equal((await store.findByAnyAccountId('v1_X'))._id, 2, 'real user wins over temp_');
  assert.equal(await store.findByAnyAccountId('v1_W'), null, 'WHATSAPP junk in LinkedIn collection ignored');

  const result = await store.linkV2AccountByV1Id('v1_X', 'acc_1', { dryRun: true });
  assert.deepEqual(result, { matched: 1, users: ['9426'], tempCount: 1 });
});

// ---------------------------------------------------------------- HTTP route

async function withServer(router, fn) {
  const app = express();
  app.use(router);
  app.use(express.json()); // proves the route works even with a JSON parser after it
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('HTTP: 503 without secret, 401 on bad signature, 200 + async processing on good signature, duplicates ignored', async () => {
  const processed = [];
  let secret = '';
  const store = fakeStore('LINKEDIN', [{ ...migratedDoc(), v2_account_id: 'acc_1' }]);
  const router = createWebhookRouter({
    getSecret: () => secret,
    isV2Mode: () => false,
    storeForProvider: () => store,
    apiClient: { get: async () => ({ data: {} }) },
    log: (m) => processed.push(m),
  });

  await withServer(router, async (base) => {
    const body = JSON.stringify({ id: 'evt_http_1', type: 'account.status.running', account_id: 'acc_1', account_provider: 'linkedin', payload: {} });
    const post = (headers) => fetch(base + WEBHOOK_PATH, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

    assert.equal((await post({ 'unipile-signature': sign(body) })).status, 503);

    secret = SECRET;
    assert.equal((await post({ 'unipile-signature': sign(body, 'wrong') })).status, 401);
    assert.equal((await post({})).status, 401);

    const ok = await post({ 'unipile-signature': sign(body) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { success: true, received: 'account.status.running' });

    await new Promise((r) => setTimeout(r, 20)); // processing runs after the response
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0][2].status, 'OK');

    const dup = await post({ 'unipile-signature': sign(body) });
    assert.deepEqual(await dup.json(), { success: true, duplicate: true });
    assert.equal(store.calls.length, 1, 'duplicate delivery not processed twice');

    const info = await (await fetch(base + WEBHOOK_PATH)).json();
    assert.equal(info.secret_configured, true);
    assert.equal(info.api_version, 'v1');
  });
});
