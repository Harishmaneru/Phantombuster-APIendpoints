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

// Postgres advisory lock function
async function withInboxLock(supabase, inboxId, fn) {
  // Remove Postgres advisory lock for now to avoid recursion issues
  console.log(`[EmailSync] Processing inbox ${inboxId} without lock`);
  try {
    return await fn();
  } catch (err) {
    console.error(`[EmailSync] Error processing inbox ${inboxId}:`, err);
    throw err;
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

// helper to fetch or create the inbox row
async function getInboxId(supabase, accountId, mailboxName) {
  // First, verify the account exists or create it
  await ensureAccountExists(supabase, accountId);

  const { data, error } = await supabase
    .from('email_inboxes')
    .select('id')
    .eq('account_id', accountId)
    .eq('mailbox_name', mailboxName)
    .maybeSingle();

  if (error) throw error;
  if (data) return data.id;

  // Create inbox if missing
  const { data: created, error: createErr } = await supabase
    .from('email_inboxes')
    .insert({
      account_id: accountId,
      mailbox_name: mailboxName
    })
    .select('id')
    .single();

  if (createErr) throw createErr;
  return created.id;
}

async function ensureAccountExists(supabase, accountId) {
  // Check if account exists
  const { data: existingAccount, error } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle();

  if (error) throw error;

  if (!existingAccount) {
    // In your store endpoint, we need user_id to create the account
    // This will be handled in the main store function
    throw new Error(`Account ${accountId} does not exist in email_accounts table`);
  }

  return existingAccount;
}

// Get account from Supabase
// Update getAppAccountById to work with email_accounts table
async function getAppAccountById(supabase, appAccountId, userId) {
  // Since we can't use appAccountId directly, we need to find by user_id and other criteria
  // This function needs to be rethought based on your new approach

  const { data: emailAccount, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', appAccountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !emailAccount) return null;

  return {
    id: emailAccount.id,
    user_id: emailAccount.user_id,
    provider: emailAccount.provider,
    oauth_refresh_token: emailAccount.oauth_token,
    app_username: emailAccount.email,
    email: emailAccount.email,
    provider_external_id: emailAccount.provider_external_id
  };
}

// Provider fetchers
// async function fetchNylasThreads({ grantId, limit, cursor }) {
//   if (!NYLAS_API_KEY) throw new Error('NYLAS_API_KEY not configured');
//   const params = new URLSearchParams();
//   if (limit) params.set('limit', String(limit));
//   if (cursor) params.set('cursor', String(cursor));
//   const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads${params.toString() ? `?${params}` : ''}`;
//   const resp = await axios.get(url, {
//     headers: {
//       'Accept': 'application/json, application/gzip',
//       'Authorization': `Bearer ${NYLAS_API_KEY}`,
//       'Content-Type': 'application/json'
//     }
//   });
//   return resp.data;
// }
async function fetchNylasThreads({ grantId, limit, cursor }) {
  if (!NYLAS_API_KEY) throw new Error('NYLAS_API_KEY not configured');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', String(cursor));
  const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads${params.toString() ? `?${params}` : ''}`;

  console.log('[NylasAPI] Fetching threads from:', url);

  const resp = await axios.get(url, {
    headers: {
      'Accept': 'application/json, application/gzip',
      'Authorization': `Bearer ${NYLAS_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  // console.log('[NylasAPI] Response data:', JSON.stringify(resp.data, null, 2));
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

async function resolveThreadId(supabase, inboxId, externalThreadId) {
  if (!externalThreadId) return null;
  const { data, error } = await supabase
    .from('email_threads')
    .select('id')
    .eq('inbox_id', inboxId)
    .eq('external_thread_id', externalThreadId)
    .single();
  if (error || !data) return null;
  return data.id;
}

function normalizeNylasThread(thread, inboxId) {
  return {
    inbox_id: inboxId,
    external_thread_id: thread?.id,
    subject: thread?.subject || null,
    snippet: thread?.snippet || null,
    participants: thread?.participants || null,
    last_message_at: thread?.latest_message_received_date
      ? new Date(thread.latest_message_received_date * 1000).toISOString()
      : (thread?.last_message_timestamp ? new Date(thread.last_message_timestamp * 1000).toISOString() : null),
    unread_count: thread?.unread ? 1 : 0, // Convert boolean to count
    message_count: thread?.message_ids?.length || 1,
    has_attachments: !!thread?.has_attachments

  };
}

function normalizeNylasMessage(message, thread, inboxId) {
  return {
    inbox_id: inboxId,
    external_message_id: message?.id,
    thread_id: null, // Will be set after thread is created
    direction: 'inbound',
    from_email: message?.from?.[0]?.email || null,
    from_name: message?.from?.[0]?.name || null,
    to_emails: message?.to || null,
    cc_emails: message?.cc || null,
    bcc_emails: message?.bcc || null,
    subject: message?.subject || thread?.subject || null,
    body_html: message?.body || null,
    body_text: message?.body ? message.body.replace(/<[^>]*>/g, '').substring(0, 500) : null,
    snippet: message?.snippet || thread?.snippet || null,
    is_read: !message?.unread,
    is_starred: !!message?.starred,
    has_attachments: !!message?.attachments?.length || false,
    folders: message?.folders || null, // This will now work after adding the column
    received_at: message?.date ? new Date(message.date * 1000).toISOString() : null
  };
}


function normalizeSmtpMessage(msg, inboxId) {
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
    inbox_id: inboxId,
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

async function syncAccountEmails({
  supabase,
  userId,
  appAccountId,
  mailboxName = 'INBOX',
  limit = 50,
  forceFullResync = false,
  overrideAccount = null,
  token = null
}) {
  // 1) Resolve inbox_id
  const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

  return withInboxLock(supabase, inboxId, async () => {
    const account = overrideAccount || await getAppAccountById(supabase, appAccountId, userId);
    if (!account) throw new Error('Account not found or access denied');

    const { data: inboxState } = await supabase
      .from('email_inboxes')
      .select('*')
      .eq('id', inboxId)
      .maybeSingle();

    const lastSyncAt = (!forceFullResync && inboxState?.last_sync_at) ? inboxState.last_sync_at : null;
    const cursor = (!forceFullResync && inboxState?.sync_cursor) ? inboxState.sync_cursor : null;

    let threadsUpserted = 0;
    let messagesUpserted = 0;
    let nextCursor = null;

    if (account.provider === 'nylas') {
      const grantId = token || account.oauth_refresh_token || account.provider_external_id;
      if (!grantId) throw new Error('Missing Nylas grantId');
      console.log('[NylasSync] Using grantId:', grantId);
      const nylasResp = await fetchNylasThreads({ grantId, limit, cursor });
      const threads = Array.isArray(nylasResp?.data) ? nylasResp.data : (Array.isArray(nylasResp?.threads) ? nylasResp.threads : []);

      console.log(`[NylasSync] Found ${threads.length} threads`);
      console.log('[NylasSync] First thread sample:', {
        id: threads[0]?.id,
        subject: threads[0]?.subject,
        hasLatestMessage: !!threads[0]?.latest_draft_or_message
      });

      nextCursor = nylasResp?.next_cursor || nylasResp?.nextCursor || null;

      console.log(`[NylasSync] Processing ${threads.length} threads`);

      for (const thread of threads) {
        try {
          // First, create/update the thread
          const threadRow = normalizeNylasThread(thread, inboxId);
          const { data: threadData, error: threadError } = await supabase
            .from('email_threads')
            .upsert(threadRow, { onConflict: 'inbox_id,external_thread_id' })
            .select('id')
            .single();

          if (threadError) {
            console.error('[NylasSync] Thread upsert error:', threadError);
            continue;
          }

          if (threadData) threadsUpserted++;
          const threadId = threadData?.id;

          // Then process the latest message
          const latestMessage = thread?.latest_draft_or_message || thread?.latest_message;
          if (latestMessage) {
            const messageRow = normalizeNylasMessage(latestMessage, thread, inboxId);
            messageRow.thread_id = threadId; // Set the thread_id from the created thread

            const { error: messageError } = await supabase
              .from('email_messages')
              .upsert(messageRow, { onConflict: 'inbox_id,external_message_id' });

            if (!messageError) {
              messagesUpserted++;
              console.log(`[NylasSync] Stored message: ${messageRow.external_message_id}`);
            } else {
              console.error('[NylasSync] Message upsert error:', messageError);
            }
          }
        } catch (err) {
          console.error('[NylasSync] Error processing thread:', err);
        }
      }

      console.log(`[NylasSync] Completed: ${threadsUpserted} threads, ${messagesUpserted} messages`);
    } else if (account.provider === 'smtp') {
      const token = account.oauth_refresh_token;
      const email = account.app_username;
      if (!token || !email) throw new Error('Missing SMTP token/email');

      const sinceIso = (!forceFullResync && lastSyncAt) ? lastSyncAt : null;
      const smtpResp = await fetchSmtpInbox({ token, email, sinceIso, limit });
      const messages = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];

      for (const msg of messages) {
        const messageRow = normalizeSmtpMessage(msg, inboxId);
        if (msg.threadId) {
          const threadId = await resolveThreadId(supabase, inboxId, msg.threadId);
          messageRow.thread_id = threadId;
        }

        const { error: messageError } = await supabase
          .from('email_messages')
          .upsert(messageRow, { onConflict: 'inbox_id,external_message_id' });
        if (!messageError) messagesUpserted++;
      }
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    const lastSyncAtIso = new Date().toISOString();
    const { error: syncError } = await supabase
      .from('email_inboxes')
      .update({
        last_sync_at: lastSyncAtIso,
        sync_cursor: nextCursor
      })
      .eq('id', inboxId);

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
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    const { data: inbox } = await supabase
      .from('email_inboxes')
      .select('last_sync_at, sync_cursor, provider')
      .eq('id', inboxId)
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
          provider: inbox?.provider || null,
          note: 'Account metadata not found; ensure initial store call seeds data'
        }
      });
    }

    let hasData = false;
    if (account.provider === 'nylas') {
      const { count } = await supabase
        .from('email_threads')
        .select('*', { count: 'exact', head: true })
        .eq('inbox_id', inboxId);
      hasData = (count || 0) > 0;
    } else if (account.provider === 'smtp') {
      const { count } = await supabase
        .from('email_messages')
        .select('*', { count: 'exact', head: true })
        .eq('inbox_id', inboxId);
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

    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    let hasData = false;
    if (!forceSync) {
      if (account.provider === 'nylas') {
        const { count } = await supabase
          .from('email_threads')
          .select('*', { count: 'exact', head: true })
          .eq('inbox_id', inboxId);
        hasData = (count || 0) > 0;
      } else if (account.provider === 'smtp') {
        const { count } = await supabase
          .from('email_messages')
          .select('*', { count: 'exact', head: true })
          .eq('inbox_id', inboxId);
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
        .eq('inbox_id', inboxId)
        .order('last_message_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      data = threads || [];
    } else if (account.provider === 'smtp') {
      const { data: messages, error } = await supabase
        .from('email_messages')
        .select('*')
        .eq('inbox_id', inboxId)
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
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    let query = supabase
      .from('email_messages')
      .select('*', { count: 'exact' })
      .eq('inbox_id', inboxId)
      .order('received_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (threadExternalId) {
      const resolvedThreadId = await resolveThreadId(supabase, inboxId, threadExternalId);
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
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    let query = supabase
      .from('email_threads')
      .select('*, email_messages(*)', { count: 'exact' })
      .eq('inbox_id', inboxId)
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
      appAccountId,  // This parameter becomes optional now
      token,
      email,
      page = 1,
      limit = 20,
      mailboxName = 'INBOX',
      provider = 'smtp'
    } = req.body;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: 'token and email are required'
      });
    }

    const supabase = getSupabaseAdmin();

    // 1. Ensure the account exists (appAccountId is now optional)
    const account = await ensureOrCreateEmailAccount(supabase, appAccountId, userId, email, provider, token);

    // 2. Now get or create the inbox using the auto-generated account ID
    const inboxId = await getInboxId(supabase, account.id, mailboxName);

    console.log('[EmailStore] Using account:', {
      accountId: account.id,
      email: account.email,
      provider: account.provider
    });

    // Rest of your existing logic...
    let emails = [];
    let messagesStored = 0;

    if (provider === 'smtp') {
      // Your existing SMTP logic
      const smtpResp = await fetchSmtpInbox({ token, email, sinceIso: null, page, limit });
      emails = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];

      for (const msg of emails) {
        const messageRow = normalizeSmtpMessage(msg, inboxId);

        const { error: messageError } = await supabase
          .from('email_messages')
          .upsert(messageRow, {
            onConflict: 'inbox_id,external_message_id'
          });

        if (!messageError) messagesStored++;
      }
    } else if (provider === 'nylas') {
      // Your existing Nylas logic
      const summary = await syncAccountEmails({
        supabase,
        userId,
        appAccountId: account.id,
        mailboxName,
        limit,
        forceFullResync: false,
        overrideAccount: account,
        token: token
      });

      // Fetch stored threads
      const { data: threads } = await supabase
        .from('email_threads')
        .select('*, email_messages(*)')
        .eq('inbox_id', inboxId)
        .order('last_message_at', { ascending: false })
        .limit(limit);

      return res.json({
        success: true,
        data: threads || [],
        synced: true,
        provider: 'nylas',
        summary: summary,
        accountId: account.id // Return the auto-generated ID for future use
      });
    }

    // Update sync state and return response
    const lastSyncAtIso = new Date().toISOString();
    await supabase
      .from('email_inboxes')
      .update({
        last_sync_at: lastSyncAtIso,
        sync_cursor: null
      })
      .eq('id', inboxId);

    const { data: storedMessages } = await supabase
      .from('email_messages')
      .select('*')
      .eq('inbox_id', inboxId)
      .order('received_at', { ascending: false })
      .limit(limit);

    return res.json({
      success: true,
      data: storedMessages || [],
      synced: true,
      messagesStored: messagesStored,
      lastSyncAt: lastSyncAtIso,
      provider: provider,
      accountId: account.id // Return the auto-generated ID
    });

  } catch (err) {
    console.error('Store error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Store failed' });
  }
});

// New helper function to ensure account exists
async function ensureOrCreateEmailAccount(supabase, appAccountId, userId, email, provider, token) {
  // First, ensure the user exists in app_users
  const { data: existingUser, error: userError } = await supabase
    .from('app_users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (userError) throw userError;

  if (!existingUser) {
    // Create the user if they don't exist
    const { data: newUser, error: createUserError } = await supabase
      .from('app_users')
      .insert({
        id: userId,
        email: email
      })
      .select('id')
      .single();

    if (createUserError) throw createUserError;
    console.log('[EmailStore] Created new user:', newUser.id);
  }

  // Now look for existing email account
  const { data: existingAccount, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;

  if (existingAccount) {
    return existingAccount;
  }

  // Create new account without specifying ID
  const { data: newAccount, error: createError } = await supabase
    .from('email_accounts')
    .insert({
      user_id: userId,
      provider: provider,
      email: email,
      oauth_token: token,
      provider_external_id: null,
      created_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (createError) throw createError;
  return newAccount;
}


// Add this test endpoint to debug permissions
router.get('/api/email/test-permissions', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();

    const tables = ['app_users', 'email_accounts', 'email_inboxes', 'email_threads', 'email_messages'];
    const results = {};

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('count')
          .limit(1);

        results[table] = {
          accessible: !error,
          error: error ? `${error.code}: ${error.message}` : null
        };
      } catch (err) {
        results[table] = {
          accessible: false,
          error: err.message
        };
      }
    }

    return res.json({
      success: true,
      message: 'Permission check completed',
      results: results
    });

  } catch (err) {
    console.error('Permission test error:', err);
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
