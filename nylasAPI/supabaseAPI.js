const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const router = express.Router();

// Env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_API_BASE_URL = 'https://api.us.nylas.com/v3';

// Simple per-inbox lock
const inboxLocks = new Map();
const getLockKey = (userId, appAccountId, mailboxName) => `${userId}:${appAccountId}:${mailboxName || 'INBOX'}`;

async function withInboxLock(lockKey, fn) {
  while (inboxLocks.get(lockKey)) {
    await new Promise(r => setTimeout(r, 50));
  }
  inboxLocks.set(lockKey, true);
  try {
    return await fn();
  } finally {
    inboxLocks.delete(lockKey);
  }
}

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function requireAuth(req) {
  const userId = req.headers['x-user-id'] || req.user?.id;
  if (!userId) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
  return String(userId);
}

// Get account from Supabase
async function getAppAccountById(supabase, appAccountId, userId) {
  const { data, error } = await supabase
    .from('app_accounts')
    .select('*')
    .eq('app_account_id', appAccountId)
    .eq('user_id', userId)
    .single();

  if (!error && data) {
    const provider = data.app_id === '114' && data.oauth_mode === '1'
      ? 'nylas'
      : data.app_id === '114' && data.oauth_mode === '0'
        ? 'smtp'
        : 'unknown';

    return {
      id: data.app_account_id,
      user_id: data.user_id,
      provider: provider,
      oauth_refresh_token: data.oauth_refresh_token,
      app_username: data.app_username,
      email: data.email || data.app_username,
      provider_external_id: data.provider_external_id
    };
  }

  // Fallback: attempt to resolve basic account info from email_inboxes if app_accounts missing
  const { data: inboxData, error: inboxError } = await supabase
    .from('email_inboxes')
    .select('app_account_id, user_id, provider, owner_email, mailbox_name')
    .eq('app_account_id', appAccountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (inboxError || !inboxData) return null;

  return {
    id: inboxData.app_account_id,
    user_id: inboxData.user_id,
    provider: inboxData.provider || 'smtp',
    oauth_refresh_token: null,
    app_username: inboxData.owner_email,
    email: inboxData.owner_email,
    provider_external_id: null
  };
}

// Provider fetchers
async function fetchNylasThreads({ grantId, limit, cursor }) {
  if (!NYLAS_API_KEY) throw new Error('NYLAS_API_KEY not configured');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', String(cursor));
  const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads${params.toString() ? `?${params}` : ''}`;
  const resp = await axios.get(url, {
    headers: {
      'Accept': 'application/json, application/gzip',
      'Authorization': `Bearer ${NYLAS_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return resp.data;
}

async function fetchSmtpInbox({ token, email, sinceIso, page = 1, limit = 20 }) {
  const resp = await axios.post(
    'https://videoresponse.onepgr.com:3001/api/fetchinbox',
    { token, email, page, limit },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-API-Key': token } }
  );
  let messages = Array.isArray(resp.data?.inbox) ? resp.data.inbox
    : Array.isArray(resp.data?.emails) ? resp.data.emails
      : Array.isArray(resp.data) ? resp.data
        : [];
  if (sinceIso) {
    const since = new Date(sinceIso).getTime();
    messages = messages.filter(m => m?.date && new Date(m.date).getTime() > since);
  }
  return { messages, nextCursor: null };
}

async function resolveThreadId(supabase, userId, appAccountId, mailboxName, externalThreadId) {
  if (!externalThreadId) return null;
  const { data, error } = await supabase
    .from('email_threads')
    .select('id')
    .eq('app_account_id', appAccountId)
    .eq('mailbox_name', mailboxName)
    .eq('user_id', userId)
    .eq('external_thread_id', externalThreadId)
    .single();
  if (error || !data) return null;
  return data.id;
}

function normalizeNylasThread(thread, userId, appAccountId, mailboxName) {
  return {
    app_account_id: appAccountId,
    mailbox_name: mailboxName,
    user_id: userId,
    external_thread_id: thread?.id,
    subject: thread?.subject || null,
    snippet: thread?.snippet || null,
    participants: thread?.participants || null,
    last_message_at: thread?.latest_message_received_date
      ? new Date(thread.latest_message_received_date * 1000).toISOString()
      : (thread?.last_message_timestamp ? new Date(thread.last_message_timestamp * 1000).toISOString() : null),
    unread_count: thread?.unread_count || 0,
    is_starred: !!thread?.starred,
    has_attachments: !!thread?.has_attachments
  };
}

function normalizeNylasMessage(message, thread, userId, appAccountId, mailboxName) {
  return {
    app_account_id: appAccountId,
    mailbox_name: mailboxName,
    user_id: userId,
    external_message_id: message?.id,
    direction: 'inbound',
    from_email: message?.from?.[0]?.email || null,
    from_name: message?.from?.[0]?.name || null,
    to_emails: message?.to || null,
    cc_emails: message?.cc || null,
    bcc_emails: message?.bcc || null,
    subject: message?.subject || thread?.subject || null,
    body_html: message?.body || null,
    body_text: message?.body ? message.body.replace(/<[^>]*>/g, '') : null,
    snippet: thread?.snippet || message?.snippet || null,
    is_read: !thread?.unread,
    is_starred: !!thread?.starred,
    has_attachments: !!thread?.has_attachments || (Array.isArray(message?.attachments) && message.attachments.length > 0),
    folders: thread?.folders || null,
    received_at: message?.date ? new Date(message.date * 1000).toISOString() : null
  };
}

function normalizeSmtpMessage(msg, userId, appAccountId, mailboxName) {
  // Extract email from "Name <email>" format if needed
  let fromEmail = msg.from || null;
  let fromName = null;
  if (fromEmail && fromEmail.includes('<') && fromEmail.includes('>')) {
    const match = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      fromName = match[1].trim().replace(/['"]/g, '');
      fromEmail = match[2].trim();
    }
  }

  // Extract snippet from text/html if not provided
  let snippet = msg.snippet || null;
  if (!snippet && msg.text) {
    snippet = msg.text.substring(0, 200).replace(/\s+/g, ' ').trim();
  } else if (!snippet && msg.html) {
    snippet = msg.html.replace(/<[^>]*>/g, '').substring(0, 200).replace(/\s+/g, ' ').trim();
  }

  // Convert to_emails to JSONB format if it's a string
  let toEmails = null;
  if (msg.to) {
    if (typeof msg.to === 'string') {
      toEmails = [{ email: msg.to }];
    } else if (Array.isArray(msg.to)) {
      toEmails = msg.to.map(email => typeof email === 'string' ? { email } : email);
    }
  }

  return {
    app_account_id: appAccountId,
    mailbox_name: mailboxName,
    user_id: userId,
    external_message_id: msg.messageId || msg.id || `smtp-${msg.uid || msg.seq || Date.now()}`,
    direction: 'inbound',
    from_email: fromEmail,
    from_name: fromName,
    to_emails: toEmails,
    cc_emails: null,
    bcc_emails: null,
    subject: msg.subject || null,
    body_html: msg.html || msg.body || null,
    body_text: msg.text || null,
    snippet: snippet,
    is_read: !msg.read, // Note: SMTP response uses 'read' not 'isRead'
    is_starred: false, // SMTP response doesn't have this field
    has_attachments: !!msg.hasAttachments || false,
    folders: null,
    received_at: msg.date || null
  };
}

async function syncAccountEmails({ supabase, userId, appAccountId, mailboxName = 'INBOX', limit = 50, forceFullResync = false }) {
  const lockKey = getLockKey(userId, appAccountId, mailboxName);

  return withInboxLock(lockKey, async () => {
    const account = await getAppAccountById(supabase, appAccountId, userId);
    if (!account) throw new Error('Account not found or access denied');

    const { data: inboxState } = await supabase
      .from('email_inboxes')
      .select('*')
      .eq('app_account_id', appAccountId)
      .eq('mailbox_name', mailboxName)
      .eq('user_id', userId)
      .maybeSingle();

    const lastSyncAt = (!forceFullResync && inboxState?.last_sync_at) ? inboxState.last_sync_at : null;
    const cursor = (!forceFullResync && inboxState?.sync_cursor) ? inboxState.sync_cursor : null;

    let threadsUpserted = 0;
    let messagesUpserted = 0;
    let nextCursor = null;

    if (account.provider === 'nylas') {
      const grantId = account.oauth_refresh_token || account.provider_external_id;
      if (!grantId) throw new Error('Missing Nylas grantId');

      const nylasResp = await fetchNylasThreads({ grantId, limit, cursor });
      const threads = Array.isArray(nylasResp?.data) ? nylasResp.data : (Array.isArray(nylasResp?.threads) ? nylasResp.threads : []);
      nextCursor = nylasResp?.next_cursor || nylasResp?.nextCursor || null;

      for (const thread of threads) {
        const threadRow = normalizeNylasThread(thread, userId, appAccountId, mailboxName);
        const { error: threadError } = await supabase
          .from('email_threads')
          .upsert(threadRow, { onConflict: 'app_account_id,mailbox_name,user_id,external_thread_id' });
        if (!threadError) threadsUpserted++;

        const latestMessage = thread?.latest_draft_or_message || thread?.latest_message ||
          (Array.isArray(thread?.messages) ? thread.messages[thread.messages.length - 1] : null);

        if (latestMessage) {
          const messageRow = normalizeNylasMessage(latestMessage, thread, userId, appAccountId, mailboxName);
          const threadId = await resolveThreadId(supabase, userId, appAccountId, mailboxName, thread?.id);
          messageRow.thread_id = threadId;

          const { error: messageError } = await supabase
            .from('email_messages')
            .upsert(messageRow, { onConflict: 'app_account_id,mailbox_name,user_id,external_message_id' });
          if (!messageError) messagesUpserted++;
        }
      }
    } else if (account.provider === 'smtp') {
      const token = account.oauth_refresh_token;
      const email = account.app_username;
      if (!token || !email) throw new Error('Missing SMTP token/email');

      const sinceIso = (!forceFullResync && lastSyncAt) ? lastSyncAt : null;
      const smtpResp = await fetchSmtpInbox({ token, email, sinceIso, limit });
      const messages = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];

      for (const msg of messages) {
        const messageRow = normalizeSmtpMessage(msg, userId, appAccountId, mailboxName);
        if (msg.threadId) {
          const threadId = await resolveThreadId(supabase, userId, appAccountId, mailboxName, msg.threadId);
          messageRow.thread_id = threadId;
        }

        const { error: messageError } = await supabase
          .from('email_messages')
          .upsert(messageRow, { onConflict: 'app_account_id,mailbox_name,user_id,external_message_id' });
        if (!messageError) messagesUpserted++;
      }
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    const lastSyncAtIso = new Date().toISOString();
    const { error: syncError } = await supabase
      .from('email_inboxes')
      .upsert({
        app_account_id: appAccountId,
        mailbox_name: mailboxName,
        user_id: userId,
        provider: account.provider,
        owner_email: account.email,
        last_sync_at: lastSyncAtIso,
        sync_cursor: nextCursor
      }, { onConflict: 'app_account_id,mailbox_name,user_id' });

    if (syncError) throw syncError;

    return { threadsUpserted, messagesUpserted, nextCursor, lastSyncAt: lastSyncAtIso, provider: account.provider };
  });
}

// ==================== API ENDPOINTS ====================

// 1) GET /api/email/check - Check if emails exist
router.get('/api/email/check', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { appAccountId, mailboxName = 'INBOX' } = req.query;
    if (!appAccountId) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const supabase = getSupabaseAdmin();
    const { data: inbox } = await supabase
      .from('email_inboxes')
      .select('last_sync_at, sync_cursor')
      .eq('app_account_id', appAccountId)
      .eq('user_id', userId)
      .eq('mailbox_name', mailboxName)
      .maybeSingle();

    const account = await getAppAccountById(supabase, appAccountId, userId);
    if (!account) {
      console.warn('[EmailCheck] Account metadata not found', { userId, appAccountId });
      return res.json({
        success: true,
        data: {
          hasData: false,
          lastSyncAt: inbox?.last_sync_at || null,
          syncCursor: inbox?.sync_cursor || null,
          provider: null,
          note: 'Account metadata not found; ensure initial store call seeds data'
        }
      });
    }

    let hasData = false;
    if (account.provider === 'nylas') {
      const { count } = await supabase
        .from('email_threads')
        .select('*', { count: 'exact', head: true })
        .eq('app_account_id', appAccountId)
        .eq('user_id', userId)
        .eq('mailbox_name', mailboxName);
      hasData = (count || 0) > 0;
    } else if (account.provider === 'smtp') {
      const { count } = await supabase
        .from('email_messages')
        .select('*', { count: 'exact', head: true })
        .eq('app_account_id', appAccountId)
        .eq('user_id', userId)
        .eq('mailbox_name', mailboxName);
      hasData = (count || 0) > 0;
    }

    return res.json({
      success: true,
      data: {
        hasData,
        lastSyncAt: inbox?.last_sync_at || null,
        syncCursor: inbox?.sync_cursor || null,
        provider: account.provider
      }
    });
  } catch (err) {
    console.error('Check error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Check failed' });
  }
});

// 2) POST /api/email/sync-and-fetch - MAIN ENDPOINT: Sync and return emails
router.post('/api/email/sync-and-fetch', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { appAccountId, mailboxName = 'INBOX', limit = 50, forceSync = false } = req.body;
    if (!appAccountId) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const supabase = getSupabaseAdmin();
    const account = await getAppAccountById(supabase, appAccountId, userId);
    if (!account) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    let hasData = false;
    if (!forceSync) {
      if (account.provider === 'nylas') {
        const { count } = await supabase
          .from('email_threads')
          .select('*', { count: 'exact', head: true })
          .eq('app_account_id', appAccountId)
          .eq('user_id', userId)
          .eq('mailbox_name', mailboxName);
        hasData = (count || 0) > 0;
      } else if (account.provider === 'smtp') {
        const { count } = await supabase
          .from('email_messages')
          .select('*', { count: 'exact', head: true })
          .eq('app_account_id', appAccountId)
          .eq('user_id', userId)
          .eq('mailbox_name', mailboxName);
        hasData = (count || 0) > 0;
      }
    }

    if (!hasData || forceSync) {
      await syncAccountEmails({ supabase, userId, appAccountId, mailboxName, limit, forceFullResync: forceSync });
    }

    let data = [];
    if (account.provider === 'nylas') {
      const { data: threads, error } = await supabase
        .from('email_threads')
        .select('*, email_messages(*)')
        .eq('app_account_id', appAccountId)
        .eq('user_id', userId)
        .eq('mailbox_name', mailboxName)
        .order('last_message_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      data = threads || [];
    } else if (account.provider === 'smtp') {
      const { data: messages, error } = await supabase
        .from('email_messages')
        .select('*')
        .eq('app_account_id', appAccountId)
        .eq('user_id', userId)
        .eq('mailbox_name', mailboxName)
        .order('received_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      data = messages || [];
    }

    return res.json({
      success: true,
      data: data,
      synced: !hasData || forceSync,
      provider: account.provider
    });
  } catch (err) {
    console.error('Sync and fetch error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Sync and fetch failed' });
  }
});

// 3) POST /api/email/quick-sync - Background sync
router.post('/api/email/quick-sync', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { appAccountId, mailboxName = 'INBOX', limit = 50 } = req.body;
    if (!appAccountId) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const supabase = getSupabaseAdmin();
    syncAccountEmails({ supabase, userId, appAccountId, mailboxName, limit, forceFullResync: false })
      .then(summary => console.log(`Sync completed:`, summary))
      .catch(err => console.error(`Sync failed:`, err));

    return res.json({ success: true, message: 'Sync started in background', appAccountId });
  } catch (err) {
    console.error('Quick sync error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Sync failed' });
  }
});

// 4) GET /api/email/messages - Get messages from Supabase
router.get('/api/email/messages', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { appAccountId, mailboxName = 'INBOX', limit = 20, offset = 0, threadExternalId, threadId, search, isRead, hasAttachments } = req.query;
    if (!appAccountId) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('email_messages')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('app_account_id', appAccountId)
      .eq('mailbox_name', mailboxName)
      .order('received_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (threadExternalId) {
      const resolvedThreadId = await resolveThreadId(supabase, userId, appAccountId, mailboxName, threadExternalId);
      if (resolvedThreadId) {
        query = query.eq('thread_id', resolvedThreadId);
      } else {
        return res.json({ success: true, data: [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: 0 } });
      }
    }
    if (threadId) query = query.eq('thread_id', threadId);
    if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%,body_text.ilike.%${search}%`);
    if (isRead !== undefined) query = query.eq('is_read', isRead === 'true');
    if (hasAttachments !== undefined) query = query.eq('has_attachments', hasAttachments === 'true');

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ success: true, data: data || [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: count || 0 } });
  } catch (err) {
    console.error('Get messages error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch messages' });
  }
});

// 5) GET /api/email/threads - Get threads from Supabase
router.get('/api/email/threads', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { appAccountId, mailboxName = 'INBOX', limit = 20, offset = 0, search } = req.query;
    if (!appAccountId) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from('email_threads')
      .select('*, email_messages(*)', { count: 'exact' })
      .eq('user_id', userId)
      .eq('app_account_id', appAccountId)
      .eq('mailbox_name', mailboxName)
      .order('last_message_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ success: true, data: data || [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: count || 0 } });
  } catch (err) {
    console.error('Get threads error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch threads' });
  }
});

// 6) POST /api/email/store - Accept token/email, call SMTP API, store in Supabase
router.post('/api/email/store', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const {
      appAccountId,
      token,           // SMTP token (oauth_refresh_token)
      email,           // User's email address
      page = 1,        // Page number
      limit = 20,      // Limit
      mailboxName = 'INBOX',
      provider = 'smtp' // 'smtp' or 'nylas'
    } = req.body;

    if (!appAccountId || !token || !email) {
      return res.status(400).json({
        success: false,
        message: 'appAccountId, token, and email are required'
      });
    }

    const maskedToken = token ? `${token.slice(0, 4)}***${token.slice(-4)}` : null;
    console.log('[EmailStore] Incoming request', {
      userId,
      appAccountId,
      email,
      provider,
      mailboxName,
      page,
      limit,
      tokenMasked: maskedToken,
      hasToken: !!token
    });

    const supabase = getSupabaseAdmin();

    // Verify account exists and belongs to user (fallback to request payload if missing metadata)
    const account = await getAppAccountById(supabase, appAccountId, userId);
    let resolvedAccount = account;
    if (!resolvedAccount) {
      console.warn('[EmailStore] Account lookup failed, using request payload fallback', { userId, appAccountId });
      if (!token || !email) {
        return res.status(404).json({ success: false, message: 'Account not found and credentials missing' });
      }
      resolvedAccount = {
        id: appAccountId,
        user_id: userId,
        provider: provider,
        oauth_refresh_token: token,
        app_username: email,
        email: email,
        provider_external_id: null
      };
    }
    console.log('[EmailStore] Account lookup success', {
      appAccountId: resolvedAccount.id,
      provider: resolvedAccount.provider,
      accountEmail: resolvedAccount.email,
      providerExternalId: resolvedAccount.provider_external_id ? `${resolvedAccount.provider_external_id.slice(0, 6)}***` : null
    });

    let emails = [];
    let messagesStored = 0;

    if (provider === 'smtp') {
      // Step 1: Call SMTP fetchinbox API
      const effectiveToken = resolvedAccount.oauth_refresh_token || token;
      const effectiveEmail = resolvedAccount.app_username || email;
      if (!effectiveToken || !effectiveEmail) {
        throw new Error('Missing SMTP credentials for store operation');
      }
      const smtpResp = await fetchSmtpInbox({ token: effectiveToken, email: effectiveEmail, sinceIso: null, page, limit });
      emails = Array.isArray(smtpResp?.messages) ? smtpResp.messages :
        Array.isArray(smtpResp?.inbox) ? smtpResp.inbox :
          Array.isArray(smtpResp?.emails) ? smtpResp.emails : [];

      // Step 2: Store emails in Supabase
      for (const msg of emails) {
        const messageRow = normalizeSmtpMessage(msg, userId, appAccountId, mailboxName);

        // Override fields from actual SMTP response
        messageRow.external_message_id = msg.messageId || msg.id || `smtp-${msg.uid || msg.seq || Date.now()}`;
        messageRow.from_email = msg.from ? (msg.from.includes('<') ? msg.from.match(/<(.+?)>/)?.[1] || msg.from : msg.from) : null;
        messageRow.subject = msg.subject || null;
        messageRow.body_html = msg.html || msg.body || null;
        messageRow.body_text = msg.text || null;

        // Convert to_emails format
        if (msg.to) {
          if (typeof msg.to === 'string') {
            messageRow.to_emails = [{ email: msg.to }];
          } else if (Array.isArray(msg.to)) {
            messageRow.to_emails = msg.to.map(e => typeof e === 'string' ? { email: e } : e);
          }
        }

        messageRow.is_read = msg.read !== undefined ? !msg.read : true; // Note: SMTP uses 'read', not 'isRead'
        messageRow.received_at = msg.date || null;

        // Resolve thread_id if threadId exists
        if (msg.threadId) {
          const threadId = await resolveThreadId(supabase, userId, appAccountId, mailboxName, msg.threadId);
          messageRow.thread_id = threadId;
        }

        const { error: messageError } = await supabase
          .from('email_messages')
          .upsert(messageRow, {
            onConflict: 'app_account_id,mailbox_name,user_id,external_message_id'
          });

        if (!messageError) messagesStored++;
      }

    } else if (provider === 'nylas') {
      // For Nylas, use existing sync logic
      const summary = await syncAccountEmails({
        supabase,
        userId,
        appAccountId,
        mailboxName,
        limit,
        forceFullResync: false
      });

      // Fetch stored threads
      const { data: threads } = await supabase
        .from('email_threads')
        .select('*, email_messages(*)')
        .eq('app_account_id', appAccountId)
        .eq('user_id', userId)
        .eq('mailbox_name', mailboxName)
        .order('last_message_at', { ascending: false })
        .limit(limit);

      return res.json({
        success: true,
        data: threads || [],
        synced: true,
        provider: 'nylas',
        summary: summary
      });
    }

    // Step 3: Update sync state
    const lastSyncAtIso = new Date().toISOString();
    const { error: syncError } = await supabase
      .from('email_inboxes')
      .upsert({
        app_account_id: appAccountId,
        mailbox_name: mailboxName,
        user_id: userId,
        provider: provider,
        owner_email: email,
        last_sync_at: lastSyncAtIso,
        sync_cursor: null
      }, {
        onConflict: 'app_account_id,mailbox_name,user_id'
      });

    if (syncError) throw syncError;

    // Step 4: Return stored emails from Supabase
    const { data: storedMessages } = await supabase
      .from('email_messages')
      .select('*')
      .eq('app_account_id', appAccountId)
      .eq('user_id', userId)
      .eq('mailbox_name', mailboxName)
      .order('received_at', { ascending: false })
      .limit(limit);

    return res.json({
      success: true,
      data: storedMessages || [],
      synced: true,
      messagesStored: messagesStored,
      lastSyncAt: lastSyncAtIso,
      provider: provider
    });

  } catch (err) {
    console.error('Store error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Store failed' });
  }
});

module.exports = router;