// const express = require('express');
// const Nylas = require('nylas');
// const router = express.Router();

// // Nylas v3 configuration with API key only
// const nylas = Nylas.config({
//   apiKey: process.env.NYLAS_API_KEY
// });

// // Middleware for error handling
// const asyncHandler = (fn) => (req, res, next) => {
//   Promise.resolve(fn(req, res, next)).catch(next);
// };

// // Helper function to format response
// const formatResponse = (success, data, message = null) => {
//   return {
//     success,
//     data,
//     message,
//     timestamp: new Date().toISOString()
//   };
// };

// // ==================== INBOX FETCH APIs ====================

// /**
//  * GET /api/inbox/threads
//  * Fetch email threads from inbox
//  */
// router.get('/threads', asyncHandler(async (req, res) => {
//   try {
//     const { 
//       limit = 20, 
//       offset = 0, 
//       expanded = true,
//       unread = false,
//       starred = false,
//       folder = 'inbox'
//     } = req.query;

//     const queryParams = {
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       expanded: expanded === 'true'
//     };

//     // Add filters if specified
//     if (unread === 'true') queryParams.unread = true;
//     if (starred === 'true') queryParams.starred = true;
//     if (folder) queryParams.in = folder;

//     const threads = await nylas.threads.list(queryParams);

//     // Format thread data for better readability
//     const formattedThreads = threads.map(thread => ({
//       id: thread.id,
//       subject: thread.subject,
//       participants: thread.participants?.map(p => ({
//         name: p.name,
//         email: p.email
//       })) || [],
//       messageCount: thread.messageCount,
//       lastMessageAt: new Date(thread.lastMessageAt * 1000).toISOString(),
//       unread: thread.unread,
//       starred: thread.starred,
//       folders: thread.folders || [],
//       snippet: thread.snippet
//     }));

//     res.json(formatResponse(true, {
//       threads: formattedThreads,
//       count: formattedThreads.length,
//       pagination: {
//         limit: parseInt(limit),
//         offset: parseInt(offset)
//       }
//     }));

//   } catch (error) {
//     console.error('Error fetching threads:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/messages
//  * Fetch messages from inbox
//  */
// router.get('/messages', asyncHandler(async (req, res) => {
//   try {
//     const { 
//       limit = 50, 
//       offset = 0, 
//       folder = 'inbox',
//       unread = false,
//       starred = false,
//       search = null,
//       from = null,
//       to = null,
//       subject = null
//     } = req.query;

//     const queryParams = {
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       in: folder
//     };

//     // Add filters
//     if (unread === 'true') queryParams.unread = true;
//     if (starred === 'true') queryParams.starred = true;
//     if (search) queryParams.search_query_native = search;
//     if (from) queryParams.from = from;
//     if (to) queryParams.to = to;
//     if (subject) queryParams.subject = subject;

//     const messages = await nylas.messages.list(queryParams);

//     // Format message data
//     const formattedMessages = messages.map(message => ({
//       id: message.id,
//       subject: message.subject,
//       from: message.from?.map(f => ({
//         name: f.name,
//         email: f.email
//       })) || [],
//       to: message.to?.map(t => ({
//         name: t.name,
//         email: t.email
//       })) || [],
//       cc: message.cc?.map(c => ({
//         name: c.name,
//         email: c.email
//       })) || [],
//       bcc: message.bcc?.map(b => ({
//         name: b.name,
//         email: b.email
//       })) || [],
//       date: new Date(message.date * 1000).toISOString(),
//       unread: message.unread,
//       starred: message.starred,
//       folders: message.folders || [],
//       snippet: message.snippet,
//       threadId: message.thread_id,
//       attachments: message.attachments?.map(att => ({
//         id: att.id,
//         filename: att.filename,
//         size: att.size,
//         contentType: att.content_type
//       })) || []
//     }));

//     res.json(formatResponse(true, {
//       messages: formattedMessages,
//       count: formattedMessages.length,
//       pagination: {
//         limit: parseInt(limit),
//         offset: parseInt(offset)
//       }
//     }));

//   } catch (error) {
//     console.error('Error fetching messages:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/messages/:messageId
//  * Get specific message with full body content
//  */
// router.get('/messages/:messageId', asyncHandler(async (req, res) => {
//   try {
//     const { messageId } = req.params;
//     const message = await nylas.messages.find(messageId);

//     const formattedMessage = {
//       id: message.id,
//       subject: message.subject,
//       from: message.from?.map(f => ({
//         name: f.name,
//         email: f.email
//       })) || [],
//       to: message.to?.map(t => ({
//         name: t.name,
//         email: t.email
//       })) || [],
//       cc: message.cc?.map(c => ({
//         name: c.name,
//         email: c.email
//       })) || [],
//       bcc: message.bcc?.map(b => ({
//         name: b.name,
//         email: b.email
//       })) || [],
//       date: new Date(message.date * 1000).toISOString(),
//       unread: message.unread,
//       starred: message.starred,
//       folders: message.folders || [],
//       snippet: message.snippet,
//       body: message.body,
//       threadId: message.thread_id,
//       attachments: message.attachments?.map(att => ({
//         id: att.id,
//         filename: att.filename,
//         size: att.size,
//         contentType: att.content_type,
//         isInline: att.is_inline,
//         contentDisposition: att.content_disposition
//       })) || []
//     };

//     res.json(formatResponse(true, formattedMessage));

//   } catch (error) {
//     console.error('Error fetching message:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/stats
//  * Get inbox statistics
//  */
// router.get('/stats', asyncHandler(async (req, res) => {
//   try {
//     // Get various inbox statistics
//     const [totalMessages, unreadMessages, starredMessages, recentMessages] = await Promise.all([
//       nylas.messages.list({ in: 'inbox', limit: 1 }),
//       nylas.messages.list({ in: 'inbox', unread: true, limit: 1 }),
//       nylas.messages.list({ in: 'inbox', starred: true, limit: 1 }),
//       nylas.messages.list({ 
//         in: 'inbox', 
//         limit: 1,
//         // Messages from last 7 days
//         after: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60)
//       })
//     ]);

//     const stats = {
//       total: totalMessages.length,
//       unread: unreadMessages.length,
//       starred: starredMessages.length,
//       recent: recentMessages.length,
//       lastUpdated: new Date().toISOString()
//     };

//     res.json(formatResponse(true, stats));

//   } catch (error) {
//     console.error('Error fetching inbox stats:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/search
//  * Advanced search functionality
//  */
// router.get('/search', asyncHandler(async (req, res) => {
//   try {
//     const { 
//       query,
//       limit = 20,
//       offset = 0,
//       folder = 'inbox',
//       unread = false,
//       starred = false
//     } = req.query;

//     if (!query) {
//       return res.status(400).json(formatResponse(false, null, 'Search query is required'));
//     }

//     const queryParams = {
//       search_query_native: query,
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       in: folder
//     };

//     if (unread === 'true') queryParams.unread = true;
//     if (starred === 'true') queryParams.starred = true;

//     const messages = await nylas.messages.list(queryParams);

//     const formattedResults = messages.map(message => ({
//       id: message.id,
//       subject: message.subject,
//       from: message.from?.map(f => ({
//         name: f.name,
//         email: f.email
//       })) || [],
//       to: message.to?.map(t => ({
//         name: t.name,
//         email: t.email
//       })) || [],
//       date: new Date(message.date * 1000).toISOString(),
//       unread: message.unread,
//       starred: message.starred,
//       snippet: message.snippet,
//       threadId: message.thread_id
//     }));

//     res.json(formatResponse(true, {
//       results: formattedResults,
//       count: formattedResults.length,
//       query: query,
//       pagination: {
//         limit: parseInt(limit),
//         offset: parseInt(offset)
//       }
//     }));

//   } catch (error) {
//     console.error('Error searching messages:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/folders
//  * Get all folders/labels
//  */
// router.get('/folders', asyncHandler(async (req, res) => {
//   try {
//     const folders = await nylas.folders.list();

//     const formattedFolders = folders.map(folder => ({
//       id: folder.id,
//       name: folder.name,
//       displayName: folder.display_name,
//       type: folder.type
//     }));

//     res.json(formatResponse(true, {
//       folders: formattedFolders,
//       count: formattedFolders.length
//     }));

//   } catch (error) {
//     console.error('Error fetching folders:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/unread
//  * Get all unread messages
//  */
// router.get('/unread', asyncHandler(async (req, res) => {
//   try {
//     const { limit = 50, offset = 0 } = req.query;

//     const messages = await nylas.messages.list({
//       unread: true,
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       in: 'inbox'
//     });

//     const formattedMessages = messages.map(message => ({
//       id: message.id,
//       subject: message.subject,
//       from: message.from?.map(f => ({
//         name: f.name,
//         email: f.email
//       })) || [],
//       date: new Date(message.date * 1000).toISOString(),
//       snippet: message.snippet,
//       threadId: message.thread_id
//     }));

//     res.json(formatResponse(true, {
//       messages: formattedMessages,
//       count: formattedMessages.length,
//       pagination: {
//         limit: parseInt(limit),
//         offset: parseInt(offset)
//       }
//     }));

//   } catch (error) {
//     console.error('Error fetching unread messages:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * GET /api/inbox/recent
//  * Get recent messages (last 24 hours)
//  */
// router.get('/recent', asyncHandler(async (req, res) => {
//   try {
//     const { limit = 20, offset = 0, hours = 24 } = req.query;

//     const hoursAgo = Math.floor(Date.now() / 1000) - (parseInt(hours) * 60 * 60);

//     const messages = await nylas.messages.list({
//       limit: parseInt(limit),
//       offset: parseInt(offset),
//       in: 'inbox',
//       after: hoursAgo
//     });

//     const formattedMessages = messages.map(message => ({
//       id: message.id,
//       subject: message.subject,
//       from: message.from?.map(f => ({
//         name: f.name,
//         email: f.email
//       })) || [],
//       date: new Date(message.date * 1000).toISOString(),
//       unread: message.unread,
//       snippet: message.snippet,
//       threadId: message.thread_id
//     }));

//     res.json(formatResponse(true, {
//       messages: formattedMessages,
//       count: formattedMessages.length,
//       timeRange: `${hours} hours`,
//       pagination: {
//         limit: parseInt(limit),
//         offset: parseInt(offset)
//       }
//     }));

//   } catch (error) {
//     console.error('Error fetching recent messages:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// // ==================== MESSAGE ACTIONS ====================

// /**
//  * PUT /api/inbox/messages/:messageId/read
//  * Mark message as read
//  */
// router.put('/messages/:messageId/read', asyncHandler(async (req, res) => {
//   try {
//     const { messageId } = req.params;
//     const { read = true } = req.body;

//     const updatedMessage = await nylas.messages.update(messageId, {
//       unread: !read
//     });

//     res.json(formatResponse(true, {
//       id: updatedMessage.id,
//       unread: updatedMessage.unread,
//       action: read ? 'marked as read' : 'marked as unread'
//     }));

//   } catch (error) {
//     console.error('Error updating message read status:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// /**
//  * PUT /api/inbox/messages/:messageId/star
//  * Star/unstar message
//  */
// router.put('/messages/:messageId/star', asyncHandler(async (req, res) => {
//   try {
//     const { messageId } = req.params;
//     const { starred = true } = req.body;

//     const updatedMessage = await nylas.messages.update(messageId, {
//       starred: starred
//     });

//     res.json(formatResponse(true, {
//       id: updatedMessage.id,
//       starred: updatedMessage.starred,
//       action: starred ? 'starred' : 'unstarred'
//     }));

//   } catch (error) {
//     console.error('Error updating message star status:', error);
//     res.status(500).json(formatResponse(false, null, error.message));
//   }
// }));

// // Error handling middleware
// router.use((error, req, res, next) => {
//   console.error('Unhandled error:', error);
//   res.status(500).json(formatResponse(false, null, 'Internal server error'));
// });

// module.exports = router;
