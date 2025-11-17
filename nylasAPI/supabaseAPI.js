// const express = require('express');
// const axios = require('axios');
// const { createClient } = require('@supabase/supabase-js');
// require('dotenv').config();

// const router = express.Router();

// // Env
// const SUPABASE_URL = process.env.SUPABASE_URL;
// const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
// const NYLAS_API_BASE_URL = 'https://api.us.nylas.com/v3';

// // Postgres advisory lock function
// async function withInboxLock(supabase, inboxId, fn) {
//   // Use Postgres advisory lock instead of in-memory lock
//   const { error: lockError } = await supabase.rpc('pg_try_advisory_lock', { key: inboxId });
//   if (lockError) throw new Error(`Failed to acquire lock: ${lockError.message}`);

//   try {
//     return await fn();
//   } finally {
//     await supabase.rpc('pg_advisory_unlock', { key: inboxId });
//   }
// }

// function getSupabaseAdmin() {
//   if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
//     throw new Error('Supabase env not configured');
//   }
//   return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// }

// function requireAuth(req) {
//   const userId = req.headers['x-user-id'] || req.user?.id;
//   if (!userId) {
//     const err = new Error('Unauthorized');
//     err.status = 401;
//     throw err;
//   }
//   return String(userId);
// }

// // helper to fetch or create the inbox row
// async function getInboxId(supabase, accountId, mailboxName) {
//   const { data, error } = await supabase
//     .from('email_inboxes')
//     .select('id')
//     .eq('account_id', accountId)
//     .eq('mailbox_name', mailboxName)
//     .maybeSingle();

//   if (error) throw error;
//   if (data) return data.id;

//   // create it if missing
//   const { data: created, error: createErr } = await supabase
//     .from('email_inboxes')
//     .insert({ account_id: accountId, mailbox_name: mailboxName })
//     .select('id')
//     .single();
//   if (createErr) throw createErr;
//   return created.id;
// }

// // Get account from Supabase
// async function getAppAccountById(supabase, appAccountId, userId) {
//   const { data, error } = await supabase
//     .from('app_accounts')
//     .select('*')
//     .eq('app_account_id', appAccountId)
//     .eq('user_id', userId)
//     .single();

//   if (!error && data) {
//     const provider = data.app_id === '114' && data.oauth_mode === '1'
//       ? 'nylas'
//       : data.app_id === '114' && data.oauth_mode === '0'
//         ? 'smtp'
//         : 'unknown';

//     return {
//       id: data.app_account_id,
//       user_id: data.user_id,
//       provider: provider,
//       oauth_refresh_token: data.oauth_refresh_token,
//       app_username: data.app_username,
//       email: data.email || data.app_username,
//       provider_external_id: data.provider_external_id
//     };
//   }

//   // Fallback: attempt to resolve basic account info from email_inboxes if app_accounts missing
//   const { data: inboxData, error: inboxError } = await supabase
//     .from('email_inboxes')
//     .select('account_id, user_id, provider, owner_email, mailbox_name')
//     .eq('account_id', appAccountId)
//     .eq('user_id', userId)
//     .maybeSingle();

//   if (inboxError || !inboxData) return null;

//   return {
//     id: inboxData.account_id,
//     user_id: inboxData.user_id,
//     provider: inboxData.provider || 'smtp',
//     oauth_refresh_token: null,
//     app_username: inboxData.owner_email,
//     email: inboxData.owner_email,
//     provider_external_id: null
//   };
// }

// // Provider fetchers
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

// async function fetchSmtpInbox({ token, email, sinceIso, page = 1, limit = 20 }) {
//   const resp = await axios.post(
//     'https://videoresponse.onepgr.com:3001/api/fetchinbox',
//     { token, email, page, limit },
//     { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-API-Key': token } }
//   );
//   let messages = Array.isArray(resp.data?.inbox) ? resp.data.inbox
//     : Array.isArray(resp.data?.emails) ? resp.data.emails
//       : Array.isArray(resp.data) ? resp.data
//         : [];
//   if (sinceIso) {
//     const since = new Date(sinceIso).getTime();
//     messages = messages.filter(m => m?.date && new Date(m.date).getTime() > since);
//   }
//   return { messages, nextCursor: null };
// }

// async function resolveThreadId(supabase, inboxId, externalThreadId) {
//   if (!externalThreadId) return null;
//   const { data, error } = await supabase
//     .from('email_threads')
//     .select('id')
//     .eq('inbox_id', inboxId)
//     .eq('external_thread_id', externalThreadId)
//     .single();
//   if (error || !data) return null;
//   return data.id;
// }

// function normalizeNylasThread(thread, inboxId) {
//   return {
//     inbox_id: inboxId,
//     external_thread_id: thread?.id,
//     subject: thread?.subject || null,
//     snippet: thread?.snippet || null,
//     participants: thread?.participants || null,
//     last_message_at: thread?.latest_message_received_date
//       ? new Date(thread.latest_message_received_date * 1000).toISOString()
//       : (thread?.last_message_timestamp ? new Date(thread.last_message_timestamp * 1000).toISOString() : null),
//     unread_count: thread?.unread_count || 0,
//     is_starred: !!thread?.starred,
//     has_attachments: !!thread?.has_attachments
//   };
// }

// function normalizeNylasMessage(message, thread, inboxId) {
//   return {
//     inbox_id: inboxId,
//     external_message_id: message?.id,
//     direction: 'inbound',
//     from_email: message?.from?.[0]?.email || null,
//     from_name: message?.from?.[0]?.name || null,
//     to_emails: message?.to || null,
//     cc_emails: message?.cc || null,
//     bcc_emails: message?.bcc || null,
//     subject: message?.subject || thread?.subject || null,
//     body_html: message?.body || null,
//     body_text: message?.body ? message.body.replace(/<[^>]*>/g, '') : null,
//     snippet: thread?.snippet || message?.snippet || null,
//     is_read: !thread?.unread,
//     is_starred: !!thread?.starred,
//     has_attachments: !!thread?.has_attachments || (Array.isArray(message?.attachments) && message.attachments.length > 0),
//     folders: thread?.folders || null,
//     received_at: message?.date ? new Date(message.date * 1000).toISOString() : null
//   };
// }

// function normalizeSmtpMessage(msg, inboxId) {
//   // Extract email from "Name <email>" format if needed
//   let fromEmail = msg.from || null;
//   let fromName = null;
//   if (fromEmail && fromEmail.includes('<') && fromEmail.includes('>')) {
//     const match = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
//     if (match) {
//       fromName = match[1].trim().replace(/['"]/g, '');
//       fromEmail = match[2].trim();
//     }
//   }

//   // Extract snippet from text/html if not provided
//   let snippet = msg.snippet || null;
//   if (!snippet && msg.text) {
//     snippet = msg.text.substring(0, 200).replace(/\s+/g, ' ').trim();
//   } else if (!snippet && msg.html) {
//     snippet = msg.html.replace(/<[^>]*>/g, '').substring(0, 200).replace(/\s+/g, ' ').trim();
//   }

//   // Convert to_emails to JSONB format if it's a string
//   let toEmails = null;
//   if (msg.to) {
//     if (typeof msg.to === 'string') {
//       toEmails = [{ email: msg.to }];
//     } else if (Array.isArray(msg.to)) {
//       toEmails = msg.to.map(email => typeof email === 'string' ? { email } : email);
//     }
//   }

//   return {
//     inbox_id: inboxId,
//     external_message_id: msg.messageId || msg.id || `smtp-${msg.uid || msg.seq || Date.now()}`,
//     direction: 'inbound',
//     from_email: fromEmail,
//     from_name: fromName,
//     to_emails: toEmails,
//     cc_emails: null,
//     bcc_emails: null,
//     subject: msg.subject || null,
//     body_html: msg.html || msg.body || null,
//     body_text: msg.text || null,
//     snippet: snippet,
//     is_read: !msg.read, // Note: SMTP response uses 'read' not 'isRead'
//     is_starred: false, // SMTP response doesn't have this field
//     has_attachments: !!msg.hasAttachments || false,
//     folders: null,
//     received_at: msg.date || null
//   };
// }

// async function syncAccountEmails({
//   supabase,
//   userId,
//   appAccountId,
//   mailboxName = 'INBOX',
//   limit = 50,
//   forceFullResync = false,
//   overrideAccount = null
// }) {
//   // 1) Resolve inbox_id
//   const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//   return withInboxLock(supabase, inboxId, async () => {
//     const account = overrideAccount || await getAppAccountById(supabase, appAccountId, userId);
//     if (!account) throw new Error('Account not found or access denied');

//     const { data: inboxState } = await supabase
//       .from('email_inboxes')
//       .select('*')
//       .eq('id', inboxId)
//       .maybeSingle();

//     const lastSyncAt = (!forceFullResync && inboxState?.last_sync_at) ? inboxState.last_sync_at : null;
//     const cursor = (!forceFullResync && inboxState?.sync_cursor) ? inboxState.sync_cursor : null;

//     let threadsUpserted = 0;
//     let messagesUpserted = 0;
//     let nextCursor = null;

//     if (account.provider === 'nylas') {
//       const grantId = account.oauth_refresh_token || account.provider_external_id;
//       if (!grantId) throw new Error('Missing Nylas grantId');

//       const nylasResp = await fetchNylasThreads({ grantId, limit, cursor });
//       const threads = Array.isArray(nylasResp?.data) ? nylasResp.data : (Array.isArray(nylasResp?.threads) ? nylasResp.threads : []);
//       nextCursor = nylasResp?.next_cursor || nylasResp?.nextCursor || null;

//       for (const thread of threads) {
//         const threadRow = normalizeNylasThread(thread, inboxId);
//         const { error: threadError } = await supabase
//           .from('email_threads')
//           .upsert(threadRow, { onConflict: 'inbox_id,external_thread_id' });
//         if (!threadError) threadsUpserted++;

//         const latestMessage = thread?.latest_draft_or_message || thread?.latest_message ||
//           (Array.isArray(thread?.messages) ? thread.messages[thread.messages.length - 1] : null);

//         if (latestMessage) {
//           const messageRow = normalizeNylasMessage(latestMessage, thread, inboxId);
//           const threadId = await resolveThreadId(supabase, inboxId, thread?.id);
//           messageRow.thread_id = threadId;

//           const { error: messageError } = await supabase
//             .from('email_messages')
//             .upsert(messageRow, { onConflict: 'inbox_id,external_message_id' });
//           if (!messageError) messagesUpserted++;
//         }
//       }
//     } else if (account.provider === 'smtp') {
//       const token = account.oauth_refresh_token;
//       const email = account.app_username;
//       if (!token || !email) throw new Error('Missing SMTP token/email');

//       const sinceIso = (!forceFullResync && lastSyncAt) ? lastSyncAt : null;
//       const smtpResp = await fetchSmtpInbox({ token, email, sinceIso, limit });
//       const messages = Array.isArray(smtpResp?.messages) ? smtpResp.messages : [];

//       for (const msg of messages) {
//         const messageRow = normalizeSmtpMessage(msg, inboxId);
//         if (msg.threadId) {
//           const threadId = await resolveThreadId(supabase, inboxId, msg.threadId);
//           messageRow.thread_id = threadId;
//         }

//         const { error: messageError } = await supabase
//           .from('email_messages')
//           .upsert(messageRow, { onConflict: 'inbox_id,external_message_id' });
//         if (!messageError) messagesUpserted++;
//       }
//     } else {
//       throw new Error(`Unsupported provider: ${account.provider}`);
//     }

//     const lastSyncAtIso = new Date().toISOString();
//     const { error: syncError } = await supabase
//       .from('email_inboxes')
//       .update({
//         last_sync_at: lastSyncAtIso,
//         sync_cursor: nextCursor
//       })
//       .eq('id', inboxId);

//     if (syncError) throw syncError;

//     return { threadsUpserted, messagesUpserted, nextCursor, lastSyncAt: lastSyncAtIso, provider: account.provider };
//   });
// }

// // ==================== API ENDPOINTS ====================

// // 1) GET /api/email/check - Check if emails exist
// router.get('/api/email/check', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, mailboxName = 'INBOX' } = req.query;
//     if (!appAccountId) {
//       return res.status(400).json({ success: false, message: 'appAccountId is required' });
//     }

//     const supabase = getSupabaseAdmin();
//     const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//     const { data: inbox } = await supabase
//       .from('email_inboxes')
//       .select('last_sync_at, sync_cursor, provider')
//       .eq('id', inboxId)
//       .maybeSingle();

//     const account = await getAppAccountById(supabase, appAccountId, userId);
//     if (!account) {
//       console.warn('[EmailCheck] Account metadata not found', { userId, appAccountId });
//       return res.json({
//         success: true,
//         data: {
//           hasData: false,
//           lastSyncAt: inbox?.last_sync_at || null,
//           syncCursor: inbox?.sync_cursor || null,
//           provider: inbox?.provider || null,
//           note: 'Account metadata not found; ensure initial store call seeds data'
//         }
//       });
//     }

//     let hasData = false;
//     if (account.provider === 'nylas') {
//       const { count } = await supabase
//         .from('email_threads')
//         .select('*', { count: 'exact', head: true })
//         .eq('inbox_id', inboxId);
//       hasData = (count || 0) > 0;
//     } else if (account.provider === 'smtp') {
//       const { count } = await supabase
//         .from('email_messages')
//         .select('*', { count: 'exact', head: true })
//         .eq('inbox_id', inboxId);
//       hasData = (count || 0) > 0;
//     }

//     return res.json({
//       success: true,
//       data: {
//         hasData,
//         lastSyncAt: inbox?.last_sync_at || null,
//         syncCursor: inbox?.sync_cursor || null,
//         provider: account.provider
//       }
//     });
//   } catch (err) {
//     console.error('Check error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Check failed' });
//   }
// });

// // 2) POST /api/email/sync-and-fetch - MAIN ENDPOINT: Sync and return emails
// router.post('/api/email/sync-and-fetch', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, mailboxName = 'INBOX', limit = 50, forceSync = false } = req.body;
//     if (!appAccountId) {
//       return res.status(400).json({ success: false, message: 'appAccountId is required' });
//     }

//     const supabase = getSupabaseAdmin();
//     const account = await getAppAccountById(supabase, appAccountId, userId);
//     if (!account) {
//       return res.status(404).json({ success: false, message: 'Account not found' });
//     }

//     const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//     let hasData = false;
//     if (!forceSync) {
//       if (account.provider === 'nylas') {
//         const { count } = await supabase
//           .from('email_threads')
//           .select('*', { count: 'exact', head: true })
//           .eq('inbox_id', inboxId);
//         hasData = (count || 0) > 0;
//       } else if (account.provider === 'smtp') {
//         const { count } = await supabase
//           .from('email_messages')
//           .select('*', { count: 'exact', head: true })
//           .eq('inbox_id', inboxId);
//         hasData = (count || 0) > 0;
//       }
//     }

//     if (!hasData || forceSync) {
//       await syncAccountEmails({ supabase, userId, appAccountId, mailboxName, limit, forceFullResync: forceSync });
//     }

//     let data = [];
//     if (account.provider === 'nylas') {
//       const { data: threads, error } = await supabase
//         .from('email_threads')
//         .select('*, email_messages(*)')
//         .eq('inbox_id', inboxId)
//         .order('last_message_at', { ascending: false })
//         .limit(limit);
//       if (error) throw error;
//       data = threads || [];
//     } else if (account.provider === 'smtp') {
//       const { data: messages, error } = await supabase
//         .from('email_messages')
//         .select('*')
//         .eq('inbox_id', inboxId)
//         .order('received_at', { ascending: false })
//         .limit(limit);
//       if (error) throw error;
//       data = messages || [];
//     }

//     return res.json({
//       success: true,
//       data: data,
//       synced: !hasData || forceSync,
//       provider: account.provider
//     });
//   } catch (err) {
//     console.error('Sync and fetch error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Sync and fetch failed' });
//   }
// });

// // 3) POST /api/email/quick-sync - Background sync
// router.post('/api/email/quick-sync', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, mailboxName = 'INBOX', limit = 50 } = req.body;
//     if (!appAccountId) {
//       return res.status(400).json({ success: false, message: 'appAccountId is required' });
//     }

//     const supabase = getSupabaseAdmin();
//     syncAccountEmails({ supabase, userId, appAccountId, mailboxName, limit, forceFullResync: false })
//       .then(summary => console.log(`Sync completed:`, summary))
//       .catch(err => console.error(`Sync failed:`, err));

//     return res.json({ success: true, message: 'Sync started in background', appAccountId });
//   } catch (err) {
//     console.error('Quick sync error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Sync failed' });
//   }
// });

// // 4) GET /api/email/messages - Get messages from Supabase
// router.get('/api/email/messages', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, mailboxName = 'INBOX', limit = 20, offset = 0, threadExternalId, threadId, search, isRead, hasAttachments } = req.query;
//     if (!appAccountId) {
//       return res.status(400).json({ success: false, message: 'appAccountId is required' });
//     }

//     const supabase = getSupabaseAdmin();
//     const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//     let query = supabase
//       .from('email_messages')
//       .select('*', { count: 'exact' })
//       .eq('inbox_id', inboxId)
//       .order('received_at', { ascending: false })
//       .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

//     if (threadExternalId) {
//       const resolvedThreadId = await resolveThreadId(supabase, inboxId, threadExternalId);
//       if (resolvedThreadId) {
//         query = query.eq('thread_id', resolvedThreadId);
//       } else {
//         return res.json({ success: true, data: [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: 0 } });
//       }
//     }
//     if (threadId) query = query.eq('thread_id', threadId);
//     if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%,body_text.ilike.%${search}%`);
//     if (isRead !== undefined) query = query.eq('is_read', isRead === 'true');
//     if (hasAttachments !== undefined) query = query.eq('has_attachments', hasAttachments === 'true');

//     const { data, error, count } = await query;
//     if (error) throw error;

//     return res.json({ success: true, data: data || [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: count || 0 } });
//   } catch (err) {
//     console.error('Get messages error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Failed to fetch messages' });
//   }
// });

// // 5) GET /api/email/threads - Get threads from Supabase
// router.get('/api/email/threads', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const { appAccountId, mailboxName = 'INBOX', limit = 20, offset = 0, search } = req.query;
//     if (!appAccountId) {
//       return res.status(400).json({ success: false, message: 'appAccountId is required' });
//     }

//     const supabase = getSupabaseAdmin();
//     const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//     let query = supabase
//       .from('email_threads')
//       .select('*, email_messages(*)', { count: 'exact' })
//       .eq('inbox_id', inboxId)
//       .order('last_message_at', { ascending: false })
//       .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

//     if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%`);

//     const { data, error, count } = await query;
//     if (error) throw error;

//     return res.json({ success: true, data: data || [], pagination: { limit: parseInt(limit), offset: parseInt(offset), total: count || 0 } });
//   } catch (err) {
//     console.error('Get threads error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Failed to fetch threads' });
//   }
// });

// // 6) POST /api/email/store - Accept token/email, call SMTP API, store in Supabase
// router.post('/api/email/store', async (req, res) => {
//   try {
//     const userId = requireAuth(req);
//     const {
//       appAccountId,
//       token,           // SMTP token (oauth_refresh_token)
//       email,           // User's email address
//       page = 1,        // Page number
//       limit = 20,      // Limit
//       mailboxName = 'INBOX',
//       provider = 'smtp' // 'smtp' or 'nylas'
//     } = req.body;

//     if (!appAccountId || !token || !email) {
//       return res.status(400).json({
//         success: false,
//         message: 'appAccountId, token, and email are required'
//       });
//     }

//     const maskedToken = token ? `${token.slice(0, 4)}***${token.slice(-4)}` : null;
//     console.log('[EmailStore] Incoming request', {
//       userId,
//       appAccountId,
//       email,
//       provider,
//       mailboxName,
//       page,
//       limit,
//       tokenMasked: maskedToken,
//       hasToken: !!token
//     });

//     const supabase = getSupabaseAdmin();
//     const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

//     // Verify account exists and belongs to user (fallback to request payload if missing metadata)
//     const account = await getAppAccountById(supabase, appAccountId, userId);
//     let resolvedAccount = account;
//     if (!resolvedAccount) {
//       console.warn('[EmailStore] Account lookup failed, using request payload fallback', { userId, appAccountId });
//       if (!token || !email) {
//         return res.status(404).json({ success: false, message: 'Account not found and credentials missing' });
//       }
//       resolvedAccount = {
//         id: appAccountId,
//         user_id: userId,
//         provider: provider,
//         oauth_refresh_token: token,
//         app_username: email,
//         email: email,
//         provider_external_id: null
//       };
//     }
//     console.log('[EmailStore] Account lookup success', {
//       appAccountId: resolvedAccount.id,
//       provider: resolvedAccount.provider,
//       accountEmail: resolvedAccount.email,
//       providerExternalId: resolvedAccount.provider_external_id ? `${resolvedAccount.provider_external_id.slice(0, 6)}***` : null
//     });

//     let emails = [];
//     let messagesStored = 0;

//     if (provider === 'smtp') {
//       // Step 1: Call SMTP fetchinbox API
//       const effectiveToken = resolvedAccount.oauth_refresh_token || token;
//       const effectiveEmail = resolvedAccount.app_username || email;
//       if (!effectiveToken || !effectiveEmail) {
//         throw new Error('Missing SMTP credentials for store operation');
//       }
//       const smtpResp = await fetchSmtpInbox({ token: effectiveToken, email: effectiveEmail, sinceIso: null, page, limit });
//       emails = Array.isArray(smtpResp?.messages) ? smtpResp.messages :
//         Array.isArray(smtpResp?.inbox) ? smtpResp.inbox :
//           Array.isArray(smtpResp?.emails) ? smtpResp.emails : [];

//       // Step 2: Store emails in Supabase
//       for (const msg of emails) {
//         const messageRow = normalizeSmtpMessage(msg, inboxId);

//         // Override fields from actual SMTP response
//         messageRow.external_message_id = msg.messageId || msg.id || `smtp-${msg.uid || msg.seq || Date.now()}`;
//         messageRow.from_email = msg.from ? (msg.from.includes('<') ? msg.from.match(/<(.+?)>/)?.[1] || msg.from : msg.from) : null;
//         messageRow.subject = msg.subject || null;
//         messageRow.body_html = msg.html || msg.body || null;
//         messageRow.body_text = msg.text || null;

//         // Convert to_emails format
//         if (msg.to) {
//           if (typeof msg.to === 'string') {
//             messageRow.to_emails = [{ email: msg.to }];
//           } else if (Array.isArray(msg.to)) {
//             messageRow.to_emails = msg.to.map(e => typeof e === 'string' ? { email: e } : e);
//           }
//         }

//         messageRow.is_read = msg.read !== undefined ? !msg.read : true; // Note: SMTP uses 'read', not 'isRead'
//         messageRow.received_at = msg.date || null;

//         // Resolve thread_id if threadId exists
//         if (msg.threadId) {
//           const threadId = await resolveThreadId(supabase, inboxId, msg.threadId);
//           messageRow.thread_id = threadId;
//         }

//         const { error: messageError } = await supabase
//           .from('email_messages')
//           .upsert(messageRow, {
//             onConflict: 'inbox_id,external_message_id'
//           });

//         if (!messageError) messagesStored++;
//       }

//     } else if (provider === 'nylas') {
//       // For Nylas, use existing sync logic
//       const summary = await syncAccountEmails({
//         supabase,
//         userId,
//         appAccountId,
//         mailboxName,
//         limit,
//         forceFullResync: false,
//         overrideAccount: resolvedAccount
//       });

//       // Fetch stored threads
//       const { data: threads } = await supabase
//         .from('email_threads')
//         .select('*, email_messages(*)')
//         .eq('inbox_id', inboxId)
//         .order('last_message_at', { ascending: false })
//         .limit(limit);

//       return res.json({
//         success: true,
//         data: threads || [],
//         synced: true,
//         provider: 'nylas',
//         summary: summary
//       });
//     }

//     // Step 3: Update sync state
//     const lastSyncAtIso = new Date().toISOString();
//     const { error: syncError } = await supabase
//       .from('email_inboxes')
//       .update({
//         last_sync_at: lastSyncAtIso,
//         sync_cursor: null
//       })
//       .eq('id', inboxId);

//     if (syncError) throw syncError;

//     // Step 4: Return stored emails from Supabase
//     const { data: storedMessages } = await supabase
//       .from('email_messages')
//       .select('*')
//       .eq('inbox_id', inboxId)
//       .order('received_at', { ascending: false })
//       .limit(limit);

//     return res.json({
//       success: true,
//       data: storedMessages || [],
//       synced: true,
//       messagesStored: messagesStored,
//       lastSyncAt: lastSyncAtIso,
//       provider: provider
//     });

//   } catch (err) {
//     console.error('Store error:', err);
//     return res.status(500).json({ success: false, message: err.message || 'Store failed' });
//   }
// });

// module.exports = router;


const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

/* ------------------------------------------------------------
 * Router & ENV
 * ----------------------------------------------------------*/
const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NYLAS_API_KEY = process.env.NYLAS_API_KEY;
const NYLAS_API_BASE_URL = 'https://api.us.nylas.com/v3';

/* ------------------------------------------------------------
 * Generic helpers
 * ----------------------------------------------------------*/
function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
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

/* ------------------------------------------------------------
 * Retry wrapper – network‑resilient axios GET with back‑off
 * ----------------------------------------------------------*/
async function retry(fn, tries = 3, delayMs = 500) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= tries) throw err;
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
    }
  }
}

/* ------------------------------------------------------------
 * Lease‑lock helpers
 * ----------------------------------------------------------*/
async function claimInboxLease(supabase, inboxId, owner, ttlSec = 120) {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + ttlSec * 1000).toISOString();

  const { data, error } = await supabase
    .from('email_inboxes')
    .update({ syncing_owner: owner, syncing_until: until })
    .eq('id', inboxId)
    .or(`syncing_until.is.null,syncing_until.lt."${now}"`)
    .select('id,syncing_owner,syncing_until')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Inbox sync is already locked by another process');
  if (data.syncing_owner !== owner) throw new Error('Inbox sync is already in progress');
  return until;
}

async function releaseInboxLease(supabase, inboxId, owner) {
  await supabase
    .from('email_inboxes')
    .update({ syncing_owner: null, syncing_until: null })
    .eq('id', inboxId)
    .eq('syncing_owner', owner);
}

/* ------------------------------------------------------------
 * DB helpers
 * ----------------------------------------------------------*/
async function getAppAccountById(supabase, appAccountId, userIdNum) {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('id, user_id, provider, email, oauth_token, provider_external_id')
    .eq('id', appAccountId)
    .eq('user_id', userIdNum)
    .single();
  if (error || !data) throw new Error('Account not found or access denied');
  return data;
}

async function getInboxId(supabase, accountId, mailboxName) {
  const { data, error } = await supabase
    .from('email_inboxes')
    .select('id')
    .eq('account_id', accountId)
    .eq('mailbox_name', mailboxName)
    .maybeSingle();
  if (error) throw error;
  if (data) return data.id;

  const { data: created, error: createErr } = await supabase
    .from('email_inboxes')
    .insert({ account_id: accountId, mailbox_name: mailboxName })
    .select('id')
    .single();
  if (createErr) throw createErr;
  return created.id;
}

/* ------------------------------------------------------------
 * NYLAS helpers - EXPANDED
 * ----------------------------------------------------------*/
async function fetchThreadsPage({ grantId, limit, cursor }) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('view', 'expanded'); // Get messages in threads
  if (cursor) params.set('cursor', cursor);
  const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/threads?${params}`;

  const { data } = await retry(() => axios.get(url, {
    headers: { Authorization: `Bearer ${NYLAS_API_KEY}` }
  }));
  return {
    threads: data.threads || data.data || [],
    nextCursor: data.next_cursor || null,
  };
}

// Fetch messages for a specific thread
async function fetchThreadMessages({ grantId, threadId }) {
  const url = `${NYLAS_API_BASE_URL}/grants/${grantId}/messages?thread_id=${threadId}`;

  const { data } = await retry(() => axios.get(url, {
    headers: { Authorization: `Bearer ${NYLAS_API_KEY}` }
  }));
  return data.messages || data.data || [];
}

/* ------------------------------------------------------------
 * Core sync - WITH BATCHING & PROPER DIRECTION
 * ----------------------------------------------------------*/
async function syncAccountEmails({ supabase, userId, account, inboxId, limit = 50, cursor }) {
  if (account.provider === 'smtp') throw new Error('SMTP accounts are not supported.');
  if (account.provider !== 'nylas') throw new Error(`Provider ${account.provider} not implemented.`);

  const owner = `api:${process.pid}:${userId}`;
  await claimInboxLease(supabase, inboxId, owner);

  let pageCursor = cursor ?? null;
  let loops = 0;
  let threadsUpserted = 0;
  let messagesUpserted = 0;
  let lastCursor = null;

  try {
    const grantId = account.oauth_token;
    if (!grantId) throw new Error('Missing Nylas Grant ID (oauth_token)');

    // Track seen cursors to prevent infinite loops
    const seenCursors = new Set();
    if (pageCursor) seenCursors.add(pageCursor);

    while (loops < 50) {
      const { threads, nextCursor } = await fetchThreadsPage({
        grantId,
        limit,
        cursor: pageCursor
      });
      loops += 1;

      // Prevent infinite loop on repeated cursor
      if (nextCursor && seenCursors.has(nextCursor)) {
        console.log('Breaking on repeated cursor:', nextCursor);
        break;
      }
      if (nextCursor) seenCursors.add(nextCursor);

      if (!threads.length) break;

      // Batch all messages for upsert
      const allMessageUpserts = [];

      for (const t of threads) {
        // upsert thread
        await supabase.from('email_threads').upsert({
          inbox_id: inboxId,
          external_thread_id: t.id,
          subject: t.subject,
          snippet: t.snippet,
          participants: t.participants,
          last_message_at: t.latest_message_received_date
            ? new Date(t.latest_message_received_date * 1000).toISOString()
            : (t.latest_message_timestamp ? new Date(t.latest_message_timestamp * 1000).toISOString() : null),
          unread_count: t.unread_count || 0,
          is_starred: t.starred || false,
          has_attachments: t.has_attachments || false,
          message_count: t.message_count || 0, // track expected count
        }, { onConflict: 'inbox_id,external_thread_id' });
        threadsUpserted++;

        // Get internal thread ID
        const { data: threadRec } = await supabase
          .from('email_threads')
          .select('id')
          .eq('inbox_id', inboxId)
          .eq('external_thread_id', t.id)
          .single();
        if (!threadRec) continue;

        // Get messages from thread OR fetch separately
        let messages = Array.isArray(t.messages) ? t.messages : [];

        // If no messages in thread response, fetch them separately
        if (messages.length === 0 && t.id) {
          try {
            messages = await fetchThreadMessages({ grantId, threadId: t.id });
          } catch (err) {
            console.error(`Failed to fetch messages for thread ${t.id}:`, err.message);
            continue;
          }
        }

        // Skip messages without IDs and use proper direction logic
        const threadMessages = messages
          .filter(m => m && m.id) // Skip messages without IDs
          .map(m => {
            // Proper direction logic
            const isOutbound = Array.isArray(m.from)
              ? m.from.some(sender => sender.email === account.email)
              : m.from?.[0]?.email === account.email;

            return {
              inbox_id: inboxId,
              thread_id: threadRec.id,
              external_message_id: m.id,
              direction: isOutbound ? 'outbound' : 'inbound',
              from_email: m.from?.[0]?.email,
              to_emails: m.to,
              cc_emails: m.cc,
              bcc_emails: m.bcc,
              body_html: m.body,
              body_text: m.body ? m.body.replace(/<[^>]*>/g, '') : null,
              received_at: m.date ? new Date(m.date * 1000).toISOString() : null,
              subject: m.subject,
            };
          });

        allMessageUpserts.push(...threadMessages);
      }

      // Batch upsert all messages with error handling
      if (allMessageUpserts.length > 0) {
        // Process in chunks to avoid payload limits
        const chunkSize = 500;
        for (let i = 0; i < allMessageUpserts.length; i += chunkSize) {
          const chunk = allMessageUpserts.slice(i, i + chunkSize);
          try {
            const { error } = await supabase
              .from('email_messages')
              .upsert(chunk, {
                onConflict: 'inbox_id,external_message_id',
                ignoreDuplicates: false
              });

            if (error) {
              console.error('Batch message upsert error:', error.message);
              // Continue with next chunks rather than failing completely
            } else {
              messagesUpserted += chunk.length;
            }
          } catch (chunkError) {
            console.error('Chunk upsert failed:', chunkError.message);
            // Continue with remaining chunks
          }
        }
      }

      lastCursor = nextCursor;
      if (!nextCursor) break;
      pageCursor = nextCursor;

      // Early exit for incremental sync
      if (cursor && loops >= 2) break; // Only get recent pages for incremental
    }

    // Update cursor
    await supabase.from('email_inboxes')
      .update({
        last_sync_at: new Date().toISOString(),
        sync_cursor: lastCursor || pageCursor
      })
      .eq('id', inboxId);

    return {
      threadsUpserted,
      messagesUpserted,
      nextCursor: lastCursor || pageCursor,
      loops
    };

  } finally {
    await releaseInboxLease(supabase, inboxId, owner);
  }
}

/* ------------------------------------------------------------
 * Router endpoints
 * ----------------------------------------------------------*/

// GET /api/email/threads
router.get('/api/email/threads', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const userIdNum = Number(userId);
    if (!Number.isFinite(userIdNum)) return res.status(400).json({ success: false, message: 'Invalid user ID' });

    const appAccountId = Number(req.query.appAccountId);
    if (!Number.isFinite(appAccountId)) return res.status(400).json({ success: false, message: 'appAccountId is required' });

    const { mailboxName = 'INBOX', search } = req.query;
    const limit = parseInt(req.query.limit ?? '20', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);

    const supabase = getSupabaseAdmin();
    await getAppAccountById(supabase, appAccountId, userIdNum);
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    const selectCols =
      'id, external_thread_id, subject, snippet, participants, last_message_at, unread_count, ' +
      'is_starred, has_attachments, message_count,' +
      'email_messages!inner(id, external_message_id, received_at, direction)';

    let query = supabase
      .from('email_threads')
      .select(selectCols, { count: 'exact' })
      .eq('inbox_id', inboxId)
      .order('last_message_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, data: data || [], pagination: { limit, offset, total: count || 0 } });

  } catch (err) {
    console.error('Get threads error:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to fetch threads' });
  }
});

// POST /api/email/store – optimized with sync strategy
router.post('/api/email/store', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const userIdNum = Number(userId);
    if (!Number.isFinite(userIdNum)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const appAccountId = Number(req.body.appAccountId);
    if (!Number.isFinite(appAccountId)) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const { mailboxName = 'INBOX', provider, syncMode = 'incremental' } = req.body;
    const limit = parseInt(req.body.limit ?? '50', 10);

    if (provider === 'smtp') {
      return res.status(400).json({ success: false, message: 'SMTP accounts are not supported' });
    }

    const supabase = getSupabaseAdmin();
    const account = await getAppAccountById(supabase, appAccountId, userIdNum);
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    const { data: inbox } = await supabase
      .from('email_inboxes')
      .select('sync_cursor, last_sync_at')
      .eq('id', inboxId)
      .single();

    // Smart sync strategy
    const cursor = syncMode === 'full' ? null : inbox?.sync_cursor;
    const effectiveLimit = syncMode === 'full' ? 200 : limit; // Larger pages for full sync

    const summary = await syncAccountEmails({
      supabase,
      userId,
      account,
      inboxId,
      limit: effectiveLimit,
      cursor,
    });

    // Return recent threads
    const selectCols = `
      id, external_thread_id, subject, snippet, participants, last_message_at, 
      unread_count, is_starred, has_attachments, message_count,
      email_messages!inner(id, external_message_id, received_at, direction)
    `;

    const { data: threads } = await supabase
      .from('email_threads')
      .select(selectCols)
      .eq('inbox_id', inboxId)
      .order('last_message_at', { ascending: false })
      .limit(limit);

    res.json({
      success: true,
      data: threads || [],
      synced: true,
      provider: account.provider,
      summary,
      syncMode
    });

  } catch (err) {
    console.error('Store error:', err.message);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Store failed'
    });
  }
});

// GET /api/email/threads/:threadId/messages - Lazy loading for thread messages
router.get('/api/email/threads/:threadId/messages', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const userIdNum = Number(userId);
    const threadId = Number(req.params.threadId);

    if (!Number.isFinite(userIdNum) || !Number.isFinite(threadId)) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    const supabase = getSupabaseAdmin();

    // Verify user has access to this thread
    const { data: thread } = await supabase
      .from('email_threads')
      .select(`
        id, external_thread_id,
        email_inboxes!inner(
          id,
          email_accounts!inner(
            id, user_id, oauth_token, provider
          )
        )
      `)
      .eq('id', threadId)
      .eq('email_inboxes.email_accounts.user_id', userIdNum)
      .single();

    if (!thread) {
      return res.status(404).json({ success: false, message: 'Thread not found' });
    }

    // Get existing messages from database
    const { data: messages, error } = await supabase
      .from('email_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true });

    if (error) throw error;

    // If no messages in DB but we have external_thread_id, fetch from Nylas
    if ((!messages || messages.length === 0) && thread.external_thread_id) {
      try {
        const grantId = thread.email_inboxes.email_accounts.oauth_token;
        if (grantId && thread.email_inboxes.email_accounts.provider === 'nylas') {
          const nylasMessages = await fetchThreadMessages({
            grantId,
            threadId: thread.external_thread_id
          });

          // Store fetched messages
          if (nylasMessages.length > 0) {
            const messageUpserts = nylasMessages
              .filter(m => m && m.id)
              .map(m => {
                const isOutbound = Array.isArray(m.from)
                  ? m.from.some(sender => sender.email === thread.email_inboxes.email_accounts.email)
                  : m.from?.[0]?.email === thread.email_inboxes.email_accounts.email;

                return {
                  inbox_id: thread.email_inboxes.id,
                  thread_id: threadId,
                  external_message_id: m.id,
                  direction: isOutbound ? 'outbound' : 'inbound',
                  from_email: m.from?.[0]?.email,
                  to_emails: m.to,
                  cc_emails: m.cc,
                  bcc_emails: m.bcc,
                  body_html: m.body,
                  body_text: m.body ? m.body.replace(/<[^>]*>/g, '') : null,
                  received_at: m.date ? new Date(m.date * 1000).toISOString() : null,
                  subject: m.subject,
                };
              });

            if (messageUpserts.length > 0) {
              await supabase
                .from('email_messages')
                .upsert(messageUpserts, {
                  onConflict: 'inbox_id,external_message_id'
                });

              // Refetch the messages
              const { data: updatedMessages } = await supabase
                .from('email_messages')
                .select('*')
                .eq('thread_id', threadId)
                .order('received_at', { ascending: true });

              return res.json({
                success: true,
                data: updatedMessages || [],
                fetchedFromProvider: true
              });
            }
          }
        }
      } catch (nylasError) {
        console.error('Failed to fetch messages from Nylas:', nylasError.message);
        // Continue with empty messages rather than failing
      }
    }

    res.json({
      success: true,
      data: messages || [],
      fetchedFromProvider: false
    });

  } catch (err) {
    console.error('Get thread messages error:', err.message);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to fetch thread messages'
    });
  }
});

// POST /api/email/sync-status - Check sync status without syncing
router.post('/api/email/sync-status', async (req, res) => {
  try {
    const userId = requireAuth(req);
    const userIdNum = Number(userId);
    if (!Number.isFinite(userIdNum)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const appAccountId = Number(req.body.appAccountId);
    if (!Number.isFinite(appAccountId)) {
      return res.status(400).json({ success: false, message: 'appAccountId is required' });
    }

    const { mailboxName = 'INBOX' } = req.body;

    const supabase = getSupabaseAdmin();
    await getAppAccountById(supabase, appAccountId, userIdNum);
    const inboxId = await getInboxId(supabase, appAccountId, mailboxName);

    const { data: inbox, error } = await supabase
      .from('email_inboxes')
      .select('last_sync_at, sync_cursor, syncing_owner, syncing_until')
      .eq('id', inboxId)
      .single();

    if (error) throw error;

    const isSyncing = inbox.syncing_owner && new Date(inbox.syncing_until) > new Date();

    res.json({
      success: true,
      data: {
        last_sync_at: inbox.last_sync_at,
        sync_cursor: inbox.sync_cursor,
        is_syncing: isSyncing,
        syncing_owner: isSyncing ? inbox.syncing_owner : null,
        syncing_until: isSyncing ? inbox.syncing_until : null
      }
    });

  } catch (err) {
    console.error('Sync status error:', err.message);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to get sync status'
    });
  }
});

module.exports = router;
