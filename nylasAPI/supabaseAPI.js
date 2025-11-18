const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const router = express.Router();

// Env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NYLAS_PROXY_BASE_URL = 'https://videoresponse.onepgr.com:3001/api/nylas';

// Postgres advisory lock function
async function withInboxLock(supabase, inboxId, fn) {
  // Remove Postgres advisory lock for now to avoid recursion issues
  console.log(`[EmailSync] Processing inbox ${inboxId} without lock`);
  try {
    return await fn();
  } catch (err) {
    // console.error(`[EmailSync] Error processing inbox ${inboxId}:`, err);
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

async function resolveAccountReference(supabase, userId, requestedAppAccountId) {
  if (!requestedAppAccountId) return null;

  const directAccount = await getAppAccountById(supabase, requestedAppAccountId, userId);
  if (directAccount) {
    return {
      account: directAccount,
      requestedAppAccountId: requestedAppAccountId
    };
  }

  const sources = [
    { table: 'nylas_emails', provider: 'nylas' },
    { table: 'smtp_emails', provider: 'smtp' }
  ];

  for (const source of sources) {
    const { data: emailRow, error: emailErr } = await supabase
      .from(source.table)
      .select('email_account')
      .eq('user_id', userId)
      .eq('app_account_id', requestedAppAccountId)
      .not('email_account', 'is', null)
      .limit(1)
      .maybeSingle();

    if (emailErr) throw emailErr;
    if (emailRow?.email_account) {
      const { data: accountRow, error: accountErr } = await supabase
        .from('email_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('email', emailRow.email_account)
        .eq('provider', source.provider)
        .maybeSingle();

      if (accountErr) throw accountErr;
      if (accountRow?.id) {
        const resolvedAccount = await getAppAccountById(supabase, accountRow.id, userId);
        if (resolvedAccount) {
          return {
            account: resolvedAccount,
            requestedAppAccountId
          };
        }
      }
    }
  }

  return null;
}

// Provider fetchers
async function fetchNylasInbox({ grantId, limit = 50, cursor }) {
  if (!grantId) throw new Error('Missing Nylas grantId');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (cursor) params.set('cursor', String(cursor));
  const url = `${NYLAS_PROXY_BASE_URL}/allthreads/${grantId}${params.toString() ? `?${params}` : ''}`;

  console.log('[NylasAPI] Fetching threads via proxy from:', url);

  const resp = await axios.get(url, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  const payload = resp.data || {};
  const dataWrapper = Array.isArray(payload.data)
    ? { data: payload.data }
    : (payload.data && typeof payload.data === 'object' ? payload.data : {});

  const threads = Array.isArray(dataWrapper.data) ? dataWrapper.data : [];
  const nextCursor = dataWrapper.next_cursor || payload.next_cursor || payload.nextCursor || null;

  return {
    threads,
    nextCursor,
    meta: {
      requestId: dataWrapper.request_id || payload.request_id || null,
      success: typeof payload.success === 'boolean' ? payload.success : null
    }
  };
}
async function fetchSmtpInbox({ token, email, sinceIso, page = 1, limit = 20 }) {
  const resp = await axios.post(
    'https://videoresponse.onepgr.com:3001/api/fetchinbox',
    { token, email, page, limit },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-API-Key': token } }
  );

  let messages = Array.isArray(resp.data?.inbox) ? resp.data.inbox
    : Array.isArray(resp.data?.emails) ? resp.data.emails
      : Array.isArray(resp.data?.messages) ? resp.data.messages
        : Array.isArray(resp.data) ? resp.data
          : [];

  if (sinceIso) {
    const since = new Date(sinceIso).getTime();
    messages = messages.filter(m => m?.date && new Date(m.date).getTime() > since);
  }

  const metaSource = (resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)) ? resp.data : {};
  const pagination =
    metaSource.pagination ||
    metaSource.page_info ||
    metaSource.pageInfo ||
    metaSource.meta ||
    {};

  const meta = {
    success: typeof metaSource.success === 'boolean' ? metaSource.success : null,
    current_page: pagination.current_page ?? metaSource.current_page ?? metaSource.page ?? page ?? null,
    total_pages: pagination.total_pages ?? metaSource.total_pages ?? null,
    total_messages: pagination.total_messages ?? metaSource.total_messages ?? metaSource.total ?? null,
    limit_per_page: pagination.limit_per_page ?? metaSource.limit_per_page ?? metaSource.per_page ?? metaSource.limit ?? limit ?? null,
    has_next_page: pagination.has_next_page ?? metaSource.has_next_page ?? null,
    has_prev_page: pagination.has_prev_page ?? metaSource.has_prev_page ?? null
  };

  return { messages, nextCursor: null, meta };
}







function normalizeNylasEmail(thread, message, inboxId, userId, emailAccount, appAccountId) {
  // Use the latest message data, fallback to thread data
  const latestMessage = message || thread?.latest_draft_or_message;

  return {
    inbox_id: inboxId,
    app_account_id: appAccountId,
    user_id: userId, // Add user_id
    email_account: emailAccount, // Add email_account

    // Thread/Message identifiers
    external_thread_id: thread?.id || null,
    external_message_id: latestMessage?.id || thread?.id,
    grant_id: thread?.grant_id || latestMessage?.grant_id,

    // Email content
    subject: latestMessage?.subject || thread?.subject || null,
    body_html: latestMessage?.body || null,
    body_text: latestMessage?.body ? latestMessage.body.replace(/<[^>]*>/g, '').substring(0, 500) : null,
    snippet: latestMessage?.snippet || thread?.snippet || null,

    // Participants
    from_email: latestMessage?.from?.[0]?.email || null,
    from_name: latestMessage?.from?.[0]?.name || null,
    to_emails: latestMessage?.to || null,
    cc_emails: latestMessage?.cc || null,
    bcc_emails: latestMessage?.bcc || null,
    reply_to: latestMessage?.reply_to || null,
    participants: thread?.participants || null,

    // Metadata
    attachments: latestMessage?.attachments || null,
    message_ids: thread?.message_ids || null,
    draft_ids: thread?.draft_ids || null,

    // Flags and status
    starred: !!(latestMessage?.starred || thread?.starred),
    unread: !!(latestMessage?.unread || thread?.unread),
    folders: latestMessage?.folders || thread?.folders || null,
    has_attachments: !!(latestMessage?.attachments?.length || thread?.has_attachments),
    has_drafts: !!thread?.has_drafts,

    // Timestamps
    date: latestMessage?.date ? new Date(latestMessage.date * 1000).toISOString() : null,
    earliest_message_date: thread?.earliest_message_date ? new Date(thread.earliest_message_date * 1000).toISOString() : null,
    latest_message_received_date: thread?.latest_message_received_date ? new Date(thread.latest_message_received_date * 1000).toISOString() : null,
    received_at: latestMessage?.date ? new Date(latestMessage.date * 1000).toISOString() : null
  };
}


function normalizeSmtpEmail(msg, { userId, emailAccount, appAccountId, meta = {}, page, limit }) {
  // Extract email from "Name <email>" format if needed
  let fromEmail = msg.from || null;
  let fromName = null;
  if (typeof fromEmail === 'string' && fromEmail.includes('<') && fromEmail.includes('>')) {
    const match = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      fromName = match[1].trim().replace(/['"]/g, '');
      fromEmail = match[2].trim();
    }
  } else if (Array.isArray(fromEmail) && fromEmail.length > 0) {
    const primary = fromEmail[0];
    fromName = primary?.name || null;
    fromEmail = primary?.email || null;
  }

  // Normalize recipients into comma-separated text
  let toEmailsText = null;
  if (msg.to) {
    if (typeof msg.to === 'string') {
      toEmailsText = msg.to;
    } else if (Array.isArray(msg.to)) {
      toEmailsText = msg.to
        .map(recipient => {
          if (typeof recipient === 'string') return recipient;
          if (recipient?.email) {
            return recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
          }
          return null;
        })
        .filter(Boolean)
        .join(', ');
    }
  }

  const resolvedDate = msg.date ? new Date(msg.date).toISOString() : null;
  const messageId = msg.messageId || msg.id || msg.message_id || `smtp-${msg.uid || msg.seq || Date.now()}`;

  return {
    user_id: userId,
    app_account_id: appAccountId,
    email_account: emailAccount,
    subject: msg.subject || null,
    from_email: fromEmail,
    from_name: fromName,
    to_emails: toEmailsText,
    date: resolvedDate,
    uid: msg.uid ?? null,
    seq: msg.seq ?? null,
    read: !!msg.read,
    message_id: messageId,
    body_text: msg.text || msg.body_text || msg.body || null,
    body_html: msg.html || msg.body_html || msg.body || null,
    success: typeof meta.success === 'boolean' ? meta.success : null,
    current_page: meta.current_page ?? page ?? null,
    total_pages: meta.total_pages ?? null,
    total_messages: meta.total_messages ?? null,
    limit_per_page: meta.limit_per_page ?? limit ?? null,
    has_next_page: meta.has_next_page ?? null,
    has_prev_page: meta.has_prev_page ?? null
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
  token = null,
  requestedAppAccountId = null
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

    const sourceAppAccountId = requestedAppAccountId || appAccountId;

    if (account.provider === 'nylas') {
      const grantId = token || account.oauth_refresh_token || account.provider_external_id;
      if (!grantId) throw new Error('Missing Nylas grantId');
      console.log('[NylasSync] Using grantId:', grantId);
      const { threads: nylasThreads, nextCursor: fetchedCursor } = await fetchNylasInbox({ grantId, limit, cursor });
      const threads = Array.isArray(nylasThreads) ? nylasThreads : [];

      console.log(`[NylasSync] Found ${threads.length} threads`);
      console.log('[NylasSync] First thread sample:', {
        id: threads[0]?.id,
        subject: threads[0]?.subject,
        hasLatestMessage: !!threads[0]?.latest_draft_or_message
      });

      nextCursor = fetchedCursor || null;

      console.log(`[NylasSync] Processing ${threads.length} threads`);

      for (const thread of threads) {
        try {
          // Get the latest message from the thread
          const latestMessage = thread?.latest_draft_or_message;

          // Create a single email record with user_id and email_account
          const emailRow = normalizeNylasEmail(
            thread,
            latestMessage,
            inboxId,
            userId,            // Pass user_id from API
            account.email,     // Pass email_account from account
            sourceAppAccountId // Store caller-provided accountId when available
          );

          const { error: emailError } = await supabase
            .from('nylas_emails')
            .upsert(emailRow, { onConflict: 'inbox_id,external_message_id' });

          if (!emailError) {
            messagesUpserted++;
            console.log(`[NylasSync] Stored email: ${emailRow.external_message_id}`);
          } else {
            console.error('[NylasSync] Email upsert error:', emailError);
          }
        } catch (err) {
          console.error('[NylasSync] Error processing thread:', err);
        }
      }

      console.log(`[NylasSync] Completed: ${messagesUpserted} emails stored`);
      threadsUpserted = 0; // Not tracking threads for Nylas, only emails
    } else if (account.provider === 'smtp') {
      const token = account.oauth_refresh_token;
      const email = account.app_username;
      if (!token || !email) throw new Error('Missing SMTP token/email');

      const sinceIso = (!forceFullResync && lastSyncAt) ? lastSyncAt : null;
      const smtpResp = await fetchSmtpInbox({ token, email, sinceIso, limit });
      const messages = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];
      const meta = smtpResp?.meta || {};

      for (const msg of messages) {
        const emailRow = normalizeSmtpEmail(msg, {
          userId,
          emailAccount: account.email || email,
          appAccountId: sourceAppAccountId,
          meta,
          page: meta.current_page,
          limit
        });

        const { error: emailError } = await supabase
          .from('smtp_emails')
          .upsert(emailRow, { onConflict: 'message_id' });
        if (!emailError) messagesUpserted++;
        else console.error('[SmtpSync] Email upsert error:', emailError);
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


async function incrementalSyncAccountEmails({
  supabase,
  userId,
  appAccountId,
  mailboxName,
  account,
  lastSyncAt,
  syncCursor,
  limit = 50,
  requestedAppAccountId = null
}) {
  const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

  return withInboxLock(supabase, inboxId, async () => {
    let newEmails = [];
    let nextCursor = null;
    let messagesUpserted = 0;
    const sourceAppAccountId = requestedAppAccountId || appAccountId;

    if (account.provider === 'nylas') {
      // Nylas incremental sync using cursor or timestamp
      const grantId = account.oauth_refresh_token || account.provider_external_id;
      const { threads: nylasThreads, nextCursor: fetchedCursor } = await fetchNylasInbox({
        grantId,
        limit,
        cursor: syncCursor // proxy handles cursor
      });

      const threads = Array.isArray(nylasThreads) ? nylasThreads : [];
      nextCursor = fetchedCursor || null;

      for (const thread of threads) {
        const latestMessage = thread?.latest_draft_or_message;
        const emailRow = normalizeNylasEmail(
          thread,
          latestMessage,
          inboxId,
          userId,
          account.email,
          sourceAppAccountId
        );

        const { error: emailError } = await supabase
          .from('nylas_emails')
          .upsert(emailRow, { onConflict: 'inbox_id,external_message_id' });

        if (!emailError) {
          messagesUpserted++;
          newEmails.push(emailRow);
        }
      }

    } else if (account.provider === 'smtp') {
      // SMTP incremental sync using since timestamp
      const token = account.oauth_refresh_token;
      const email = account.app_username;

      const smtpResp = await fetchSmtpInbox({
        token,
        email,
        sinceIso: lastSyncAt, // Only fetch emails since last sync
        limit
      });

      const messages = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];
      const meta = smtpResp?.meta || {};

      for (const msg of messages) {
        const emailRow = normalizeSmtpEmail(msg, {
          userId,
          emailAccount: account.email,
          appAccountId: sourceAppAccountId,
          meta,
          limit
        });

        const { error: emailError } = await supabase
          .from('smtp_emails')
          .upsert(emailRow, { onConflict: 'message_id' });

        if (!emailError) {
          messagesUpserted++;
          newEmails.push(emailRow);
        }
      }
    }

    // Update sync state
    const lastSyncAtIso = new Date().toISOString();
    await supabase
      .from('email_inboxes')
      .update({
        last_sync_at: lastSyncAtIso,
        sync_cursor: nextCursor,
        sync_state: 'synced'
      })
      .eq('id', inboxId);

    return {
      messagesUpserted,
      newEmailsCount: newEmails.length,
      lastSyncAt: lastSyncAtIso,
      nextCursor,
      newEmails: newEmails.slice(0, 10) // Return first 10 new emails for immediate update
    };
  });
}

// ==================== API ENDPOINTS ====================

// POST /api/email/sync - Incremental sync for existing accounts
router.post('/api/email/sync', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const {
      appAccountId,
      mailboxName = 'INBOX',
      limit = 50,
      forceRefresh = false
    } = req.body;

    if (!appAccountId) {
      return res.status(400).json({
        success: false,
        message: 'appAccountId is required'
      });
    }

    const supabase = getSupabaseAdmin();

    // Resolve account details (supports external appAccountId)
    const accountResolution = await resolveAccountReference(supabase, userId, appAccountId);
    if (!accountResolution) {
      return res.status(404).json({
        success: false,
        message: 'Email account not found'
      });
    }
    const account = accountResolution.account;
    const requestedAppAccountId = accountResolution.requestedAppAccountId || appAccountId || account.id;
    const internalAppAccountId = account.id;

    // Get inbox sync state
    const inboxId = await getInboxId(supabase, internalAppAccountId, mailboxName);
    const { data: inboxState } = await supabase
      .from('email_inboxes')
      .select('last_sync_at, sync_cursor, sync_state')
      .eq('id', inboxId)
      .maybeSingle();

    // Determine sync strategy
    const lastSyncAt = inboxState?.last_sync_at;
    const syncCursor = inboxState?.sync_cursor;

    let syncSummary;

    if (forceRefresh || !lastSyncAt) {
      // Full resync
      console.log(`[EmailSync] Performing full sync for account ${requestedAppAccountId}`);
      syncSummary = await syncAccountEmails({
        supabase,
        userId,
        appAccountId: internalAppAccountId,
        mailboxName,
        limit: 100, // Higher limit for initial sync
        forceFullResync: true,
        requestedAppAccountId
      });
    } else {
      // Incremental sync - only fetch new emails since last sync
      console.log(`[EmailSync] Performing incremental sync for account ${requestedAppAccountId} since ${lastSyncAt}`);
      syncSummary = await incrementalSyncAccountEmails({
        supabase,
        userId,
        appAccountId: internalAppAccountId,
        mailboxName,
        account,
        lastSyncAt,
        syncCursor,
        limit,
        requestedAppAccountId
      });
    }

    return res.json({
      success: true,
      data: {
        syncType: forceRefresh || !lastSyncAt ? 'full' : 'incremental',
        ...syncSummary,
          accountId: requestedAppAccountId,
        provider: account.provider
      }
    });

  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Sync failed'
    });
  }
});





// In your /api/email/exists endpoint, replace this part:
router.get('/api/email/exists', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const { detailed = false, email: emailFilter, provider: providerFilter } = req.query;

    const supabase = getSupabaseAdmin();

    // Get all user's email accounts, optionally filtered by email/provider
    let accountsQuery = supabase
      .from('email_accounts')
      .select('id, email, provider, created_at')
      .eq('user_id', userId);

    if (emailFilter) accountsQuery = accountsQuery.eq('email', emailFilter);
    if (providerFilter) accountsQuery = accountsQuery.eq('provider', providerFilter);

    const { data: accounts } = await accountsQuery;

    if (!accounts || accounts.length === 0) {
      return res.json({
        success: true,
        exists: false,
        accounts: [],
        syncRequired: true
      });
    }

    let result = {
      success: true,
      exists: false,
      accounts: [],
      syncRequired: false
    };

    for (const account of accounts) {
      let emailCount = 0;
      let resolvedAppAccountId = account.id;
      const table = account.provider === 'nylas'
        ? 'nylas_emails'
        : account.provider === 'smtp'
          ? 'smtp_emails'
          : null;

      if (table) {
        // Determine which app_account_id is actually stored for this user/account
        const { data: storedIds, error: storedErr } = await supabase
          .from(table)
          .select('app_account_id')
          .eq('user_id', userId)
          .eq('email_account', account.email)
          .not('app_account_id', 'is', null)
          .limit(1);

        if (!storedErr && storedIds && storedIds.length > 0) {
          resolvedAppAccountId = storedIds[0].app_account_id || resolvedAppAccountId;
        }

        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('app_account_id', resolvedAppAccountId);

        if (!error) emailCount = count || 0;
      }

      // Get last sync info from email_inboxes
      const { data: inbox } = await supabase
        .from('email_inboxes')
        .select('last_sync_at')
        .eq('account_id', account.id)
        .eq('mailbox_name', 'INBOX')
        .maybeSingle();

      // Helper function to determine if sync is needed
      const shouldSync = (lastSyncTime) => {
        if (!lastSyncTime) return true;
        const lastSync = new Date(lastSyncTime);
        const now = new Date();
        const hoursSinceLastSync = (now - lastSync) / (1000 * 60 * 60);
        return hoursSinceLastSync > 1;
      };

      // In your /api/email/exists endpoint, update the accountInfo object:
      const accountInfo = {
        id: account.id,
        appAccountId: resolvedAppAccountId,
        email: account.email,
        provider: account.provider,
        emailCount,
        lastSyncAt: inbox?.last_sync_at,
        needsInitialSync: emailCount === 0,
        needsIncrementalSync: inbox?.last_sync_at ? shouldSync(inbox.last_sync_at) : true
      };

      result.accounts.push(accountInfo);

      if (emailCount > 0) {
        result.exists = true;
      }

      if (accountInfo.needsInitialSync || accountInfo.needsIncrementalSync) {
        result.syncRequired = true;
      }
    }

    return res.json(result);

  } catch (err) {
    console.error('Enhanced exists check error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Check failed'
    });
  }
});



// router.get('/api/email/exists', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, email, provider } = req.query;

//     if (!appAccountId || !email || !provider) {
//       return res.status(400).json({
//         success: false,
//         message: 'appAccountId, email and provider are required'
//       });
//     }

//     const supabase = getSupabaseAdmin();

//     // Directly check the email storage tables without checking email_accounts first
//     let exists = false;
//     let checkedSource = null;
//     let count = 0;

//     if (provider === 'nylas') {
//       // Check nylas_emails table
//       const { count: nylasCount, error: nylasErr } = await supabase
//         .from('nylas_emails')
//         .select('*', { count: 'exact', head: true })
//         .eq('app_account_id', appAccountId)
//         .eq('user_id', userId);

//       if (nylasErr) throw nylasErr;
//       count = nylasCount || 0;
//       exists = count > 0;
//       checkedSource = 'nylas_emails';

//     } else if (provider === 'smtp') {
//       // Check smtp_emails table
//       const { count: smtpCount, error: smtpErr } = await supabase
//         .from('smtp_emails')
//         .select('*', { count: 'exact', head: true })
//         .eq('app_account_id', appAccountId)
//         .eq('user_id', userId);

//       if (smtpErr) throw smtpErr;
//       count = smtpCount || 0;
//       exists = count > 0;
//       checkedSource = 'smtp_emails';
//     } else {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid provider'
//       });
//     }

//     return res.json({
//       success: true,
//       exists,
//       count,
//       provider,
//       email,
//       appAccountId,
//       source: checkedSource
//     });

//   } catch (err) {
//     console.error('Exists check error:', err);
//     return res.status(500).json({
//       success: false,
//       message: err.message || 'Check failed'
//     });
//   }
// });


//  GET /api/email/check - Check if emails exist




// POST /api/email/store - Accept token/email, call SMTP API, store in Supabase
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
    const resolvedAppAccountId = appAccountId || account.id;

    console.log('[EmailStore] Using account:', {
      accountId: account.id,
      email: account.email,
      provider: account.provider
    });

    // Rest of your existing logic...
    let emails = [];
    let messagesStored = 0;

    if (provider === 'smtp') {
      const smtpResp = await fetchSmtpInbox({ token, email, sinceIso: null, page, limit });
      emails = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];
      const meta = smtpResp?.meta || {};

      for (const msg of emails) {
        const emailRow = normalizeSmtpEmail(msg, {
          userId,
          emailAccount: account.email,
          appAccountId: resolvedAppAccountId,
          meta,
          page,
          limit
        });

        const { error: emailError } = await supabase
          .from('smtp_emails')
          .upsert(emailRow, { onConflict: 'message_id' });

        if (!emailError) {
          messagesStored++;
        } else {
          console.error('[SMTPStore] Email upsert error:', emailError);
        }
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
        token: token,
        requestedAppAccountId: resolvedAppAccountId
      });

      // Fetch stored emails from nylas_emails table
      const { data: emails } = await supabase
        .from('nylas_emails')
        .select('*')
        .eq('inbox_id', inboxId)
        .eq('user_id', userId)
        .eq('app_account_id', resolvedAppAccountId)
        .order('received_at', { ascending: false })
        .limit(limit);

      return res.json({
        success: true,
        data: emails || [],
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

    const { data: storedEmails } = await supabase
      .from('smtp_emails')
      .select('*')
      .eq('user_id', userId)
      .eq('email_account', account.email)
      .eq('app_account_id', resolvedAppAccountId)
      .order('date', { ascending: false })
      .limit(limit);

    return res.json({
      success: true,
      data: storedEmails || [],
      synced: true,
      messagesStored: messagesStored,
      lastSyncAt: lastSyncAtIso,
      provider: provider,
      accountId: resolvedAppAccountId // Return the requested/internal ID we stored
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




module.exports = router;
