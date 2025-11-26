// const express = require('express');
// const OpenAI = require('openai');
// const router = express.Router();

// // Initialize OpenAI
// const openai = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY
// });

// router.post('/generate-email-reply', async (req, res) => {
//     try {
//         const { emailBody, replyType } = req.body;

//         // Validate required fields
//         if (!emailBody) {
//             return res.status(400).json({
//                 success: false,
//                 error: 'emailBody is required in the payload'
//             });
//         }

//         // Define reply type instructions (optimized for speed)
//         const replyTypeInstructions = {
//             'Direct & Concise': {
//                 instruction: 'Write a direct and concise email reply. Get straight to the point without unnecessary formalities or filler words. Keep it brief and action-oriented. Focus on the essential information only.',
//                 maxTokens: 200, // Reduced for faster responses
//                 systemMessage: 'You are an expert at writing concise, direct email replies that get straight to the point.'
//             },
//             'Professional': {
//                 instruction: 'Write a professional, formal email reply. Use proper business language, complete sentences, and maintain a respectful, professional tone. Include appropriate greetings and closing. Balance formality with clarity.',
//                 maxTokens: 300, // Reduced for faster responses
//                 systemMessage: 'You are an expert email writer who creates perfect professional email replies for business contexts.'
//             },
//             'Detailed / Informative': {
//                 instruction: 'Write a detailed and informative email reply. Provide comprehensive information, context, and explanations. Include all relevant details that might be helpful. Use clear structure and organization. Ensure the recipient has all the information they need.',
//                 maxTokens: 400, // Reduced for faster responses
//                 systemMessage: 'You are an expert at writing detailed, informative email replies that provide comprehensive information and context.'
//             }
//         };

//         // All valid reply types
//         const allReplyTypes = ['Direct & Concise', 'Professional', 'Detailed / Informative'];

//         // Parse replyType to determine which types to generate
//         let typesToGenerate = [];
        
//         if (replyType) {
//             // Split by comma and clean up the types
//             const requestedTypes = replyType.split(',').map(type => type.trim());
            
//             // Validate and match types (case-insensitive, handles whitespace)
//             for (const requestedType of requestedTypes) {
//                 // Find matching type (case-insensitive comparison)
//                 const matchedType = allReplyTypes.find(validType => {
//                     // Normalize both strings for comparison
//                     const normalize = (str) => str.toLowerCase().trim().replace(/\s+/g, ' ');
//                     return normalize(requestedType) === normalize(validType);
//                 });
                
//                 if (matchedType && !typesToGenerate.includes(matchedType)) {
//                     typesToGenerate.push(matchedType);
//                 }
//             }

//             // If no valid types found, return error
//             if (typesToGenerate.length === 0) {
//                 return res.status(400).json({
//                     success: false,
//                     error: `Invalid replyType. Valid types are: "Direct & Concise", "Professional", "Detailed / Informative". You can request one or all three (comma-separated).`
//                 });
//             }
//         } else {
//             // If no replyType provided, default to all three
//             typesToGenerate = [...allReplyTypes];
//         }

//         // **OPTIMIZATION: Create all API calls at once for true parallel processing**
//         const generateReply = (type) => {
//             const typeConfig = replyTypeInstructions[type];
//             // Shorter, more efficient prompt for faster processing
//             const prompt = `Email: ${emailBody}\n\nGenerate a ${type} reply. ${typeConfig.instruction}`;

//             // Add timeout wrapper (30 seconds max per request)
//             const apiCall = openai.chat.completions.create({
//                 model: "gpt-4o-mini", // Faster and cheaper than gpt-3.5-turbo
//                 messages: [
//                     {
//                         role: "system",
//                         content: typeConfig.systemMessage
//                     },
//                     {
//                         role: "user",
//                         content: prompt
//                     }
//                 ],
//                 max_tokens: typeConfig.maxTokens, // Already optimized values
//                 temperature: 0.5, // Lower temp for faster, more deterministic responses
//                 stream: false
//             });

//             // Timeout wrapper - 30 seconds max
//             const timeoutPromise = new Promise((_, reject) => 
//                 setTimeout(() => reject(new Error(`Timeout: ${type} reply generation took too long`)), 30000)
//             );

//             return Promise.race([apiCall, timeoutPromise]).then(completion => ({
//                 replyType: type,
//                 reply: completion.choices[0].message.content,
//                 usage: completion.usage
//             }));
//         };

//         // **OPTIMIZATION: Use Promise.all for true parallel execution**
//         const replyPromises = typesToGenerate.map(type => generateReply(type));
        
//         const replies = await Promise.all(replyPromises);

//         // **OPTIMIZATION: Calculate total usage more efficiently**
//         const totalUsage = {
//             prompt_tokens: 0,
//             completion_tokens: 0,
//             total_tokens: 0
//         };

//         const responseReplies = {};
        
//         replies.forEach(reply => {
//             responseReplies[reply.replyType] = reply.reply;
//             totalUsage.prompt_tokens += reply.usage.prompt_tokens;
//             totalUsage.completion_tokens += reply.usage.completion_tokens;
//             totalUsage.total_tokens += reply.usage.total_tokens;
//         });

//         console.log('AI reply totalUsage', totalUsage);
        
//         const response = {
//             success: true,
//             replies: responseReplies
//         };

//         res.json(response);

//     } catch (error) {
//         console.error('Error generating email reply:', error);
//         res.status(500).json({
//             success: false,
//             error: error.message || 'Failed to generate email reply'
//         });
//     }
// });



// /**
//  * @route   POST /api/email/process
//  * @desc    Unified endpoint for email AI features (Summarize or Chat).
//  * @access  Private (assuming auth middleware)
//  *
//  * @body    {
//  * "task": "summarize" | "chat", // REQUIRED: The action to perform
//  * "emailBody": "...",           // REQUIRED: The full body of the email
//  * "emailSubject": "...",        // Optional: Subject for better context
//  * "userQuestion": "...",        // REQUIRED only if task is "chat"
//  * "chatHistory": [              // Optional: For multi-turn chat context
//  * { "role": "user", "content": "..." },
//  * { "role": "assistant", "content": "..." }
//  * ]
//  * }
//  */
// router.post('/summarize', async (req, res) => {
//     const { task, emailBody, emailSubject, userQuestion, chatHistory } = req.body;

//     // --- 1. Basic Payload Validation ---
//     if (!task) {
//         return res.status(400).json({
//             success: false,
//             error: 'Payload must include a "task" field ("summarize" or "chat")'
//         });
//     }

//     if (!emailBody) {
//         return res.status(400).json({
//             success: false,
//             error: 'Payload must include an "emailBody" field'
//         });
//     }

//     try {
//         // --- 2. Task: Summarize ---
//         if (task === 'summarize') {
//             const systemMessage = "You are an expert analysis AI. Your job is to read an email and extract the most essential points, action items, and key information. Format the output as a concise, easy-to-read bulleted list using Markdown.";

//             const userPrompt = `
//                 Please provide a point-wise summary of the following email.
//                 Focus on:
//                 1.  The main purpose or topic.
//                 2.  Any specific questions asked of the recipient.
//                 3.  Any action items or deadlines mentioned.

//                 --- EMAIL START ---
//                 Subject: ${emailSubject || 'N/A'}
                
//                 Body:
//                 ${emailBody}
//                 --- EMAIL END ---
//             `;

//             const completion = await openai.chat.completions.create({
//                 model: "gpt-4o-mini", // Using a cost-effective but smart model
//                 messages: [
//                     { role: "system", content: systemMessage },
//                     { role: "user", content: userPrompt }
//                 ],
//                 max_tokens: 500,
//                 temperature: 0.3 // Lower temp for factual summarization
//             });

//             const summary = completion.choices[0].message.content;

//             return res.json({
//                 success: true,
//                 task: "summary",
//                 summary: summary
//             });
//         }

//         // --- 3. Task: Chat ---
//         if (task === 'chat') {
//             if (!userQuestion) {
//                 return res.status(400).json({
//                     success: false,
//                     error: 'Payload must include "userQuestion" for "chat" task'
//                 });
//             }

//             // This system message is CRITICAL. It "pins" the email context for the AI.
//             const systemMessage = `
//                 You are a helpful AI assistant. Your purpose is to help a user discuss and understand a specific email.
//                 You must answer the user's questions based *ONLY* on the content of the email provided below.
//                 If the answer is not in the email, state clearly that the information is not available in the email.
//                 Do not make up information. Be concise and direct.

//                 --- FULL EMAIL CONTEXT ---
//                 Subject: ${emailSubject || 'N/A'}
                
//                 Body:
//                 ${emailBody}
//                 --- END EMAIL CONTEXT ---
//             `;

//             // Build the message history
//             let messageHistory = [{ role: "system", content: systemMessage }];

//             // Add existing chat history if provided and valid
//             if (Array.isArray(chatHistory) && chatHistory.length > 0) {
//                 messageHistory = [...messageHistory, ...chatHistory];
//             }

//             // Add the new user question
//             messageHistory.push({ role: "user", content: userQuestion });

//             // Generate the chat reply
//             const completion = await openai.chat.completions.create({
//                 model: "gpt-4o-mini", // Good model for chat
//                 messages: messageHistory,
//                 max_tokens: 500,
//                 temperature: 0.5 // A bit more creative for natural chat
//             });

//             const answer = completion.choices[0].message.content;

//             // Create the new history entry for the assistant's reply
//             const newHistoryEntry = { role: "assistant", content: answer };

//             // Send back the *updated* history so the client can store it
//             const updatedHistory = [
//                 ...(chatHistory || []),
//                 { role: "user", content: userQuestion },
//                 newHistoryEntry
//             ];

//             return res.json({
//                 success: true,
//                 task: "chat",
//                 answer: answer,
//                 chatHistory: updatedHistory // Send back the full history
            
//             });
//         }

//         // --- 4. Handle Invalid Task ---
//         return res.status(400).json({
//             success: false,
//             error: `Invalid task: "${task}". Must be "summarize" or "chat".`
//         });

//     } catch (error) {
//         console.error('Error processing email feature:', error);
//         res.status(500).json({
//             success: false,
//             error: error.message || 'Failed to process email request'
//         });
//     }
// });



// module.exports = router;


const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 10000, // 10 second timeout
    maxRetries: 1
});

// Cache for storing frequent requests (simple in-memory cache)
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to generate cache key
const generateCacheKey = (emailBody, replyType) => {
    return `${Buffer.from(emailBody).toString('base64').substring(0, 100)}-${replyType}`;
};

// Pre-defined reply templates for common scenarios
const quickTemplates = {
    'acknowledgment': {
        'Direct & Concise': "Thanks for your email. I'll look into this and get back to you.",
        'Professional': "Thank you for reaching out. I have received your message and will review it shortly.",
        'Detailed / Informative': "Thank you for your email. I've noted the details you've shared and will provide a comprehensive response after careful consideration."
    },
    'confirmation': {
        'Direct & Concise': "Confirmed. Will proceed as discussed.",
        'Professional': "This confirms that I have received your instructions and will proceed accordingly.",
        'Detailed / Informative': "I confirm receipt of your message and the details outlined. I will ensure all points are addressed as specified."
    }
};

// Quick pattern matcher for common email types
const detectEmailPattern = (emailBody) => {
    const body = emailBody.toLowerCase();
    
    if (body.includes('thank') || body.includes('thanks') || body.includes('appreciate')) {
        return 'acknowledgment';
    }
    if (body.includes('confirm') || body.includes('acknowledge') || body.includes('received')) {
        return 'confirmation';
    }
    if (body.includes('urgent') || body.includes('asap') || body.includes('immediately')) {
        return 'urgent';
    }
    
    return null;
};

router.post('/generate-email-reply', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { emailBody, replyType } = req.body;

        // Validate required fields
        if (!emailBody) {
            return res.status(400).json({
                success: false,
                error: 'emailBody is required in the payload'
            });
        }

        // Check cache first
        const cacheKey = generateCacheKey(emailBody, replyType);
        const cached = responseCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            console.log(`Cache hit for key: ${cacheKey}`);
            return res.json({
                success: true,
                replies: cached.data,
                cached: true,
                responseTime: Date.now() - startTime
            });
        }

        // Try quick template matching for common patterns
        const emailPattern = detectEmailPattern(emailBody);
        if (emailPattern && emailPattern !== 'urgent') {
            const quickReplies = {};
            const typesToGenerate = replyType ? 
                replyType.split(',').map(t => t.trim()) : 
                ['Direct & Concise', 'Professional', 'Detailed / Informative'];
            
            typesToGenerate.forEach(type => {
                if (quickTemplates[emailPattern] && quickTemplates[emailPattern][type]) {
                    quickReplies[type] = quickTemplates[emailPattern][type];
                }
            });

            if (Object.keys(quickReplies).length > 0) {
                // Cache the quick response
                responseCache.set(cacheKey, {
                    data: quickReplies,
                    timestamp: Date.now()
                });

                return res.json({
                    success: true,
                    replies: quickReplies,
                    quickTemplate: true,
                    responseTime: Date.now() - startTime
                });
            }
        }

        // Define optimized reply type configurations
        const replyTypeConfigs = {
            'Direct & Concise': {
                instruction: 'Write direct, concise email reply. Get straight to the point. Max 2-3 sentences.',
                maxTokens: 100,
                systemMessage: 'You write very short, direct email replies. Be extremely concise.'
            },
            'Professional': {
                instruction: 'Write professional email reply. Use proper business language but keep it brief.',
                maxTokens: 150,
                systemMessage: 'You write brief professional email replies. Balance formality with brevity.'
            },
            'Detailed / Informative': {
                instruction: 'Write informative email reply. Provide key details but be concise.',
                maxTokens: 200,
                systemMessage: 'You write concise but informative email replies. Include essential details only.'
            }
        };

        // Parse requested types
        const allReplyTypes = ['Direct & Concise', 'Professional', 'Detailed / Informative'];
        let typesToGenerate = [];
        
        if (replyType) {
            const requestedTypes = replyType.split(',').map(type => type.trim());
            for (const requestedType of requestedTypes) {
                const matchedType = allReplyTypes.find(validType => 
                    validType.toLowerCase().includes(requestedType.toLowerCase())
                );
                if (matchedType && !typesToGenerate.includes(matchedType)) {
                    typesToGenerate.push(matchedType);
                }
            }
        } else {
            typesToGenerate = [...allReplyTypes];
        }

        if (typesToGenerate.length === 0) {
            return res.status(400).json({
                success: false,
                error: `Invalid replyType. Valid types: "Direct & Concise", "Professional", "Detailed / Informative".`
            });
        }

        // **ULTRA-OPTIMIZED: Single API call for all reply types**
        if (typesToGenerate.length > 1) {
            const systemMessage = `Generate multiple email reply variations based on the user's request. Be extremely concise.`;
            
            const userPrompt = `Email: ${emailBody.substring(0, 500)} // [truncated if longer]

Generate these reply variations (MAX 2-3 sentences each):
${typesToGenerate.map(type => `${type}: ${replyTypeConfigs[type].instruction}`).join('\n')}

Format response as JSON: {"Direct & Concise": "...", "Professional": "...", "Detailed / Informative": "..."}`;

            try {
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemMessage },
                        { role: "user", content: userPrompt }
                    ],
                    max_tokens: 400,
                    temperature: 0.3,
                    stream: false
                });

                const content = completion.choices[0].message.content;
                
                // Simple JSON parsing with fallback
                let replies;
                try {
                    replies = JSON.parse(content);
                } catch (e) {
                    // Fallback: parse manually if JSON fails
                    replies = {};
                    typesToGenerate.forEach(type => {
                        const match = content.match(new RegExp(`${type}[\\s:]*([^\\n]+)`, 'i'));
                        replies[type] = match ? match[1].trim() : `Reply for ${type}`;
                    });
                }

                // Cache the response
                responseCache.set(cacheKey, {
                    data: replies,
                    timestamp: Date.now()
                });

                return res.json({
                    success: true,
                    replies,
                    batchProcessed: true,
                    responseTime: Date.now() - startTime
                });

            } catch (batchError) {
                console.log('Batch processing failed, falling back to individual calls');
                // Fall through to individual calls
            }
        }

        // **FALLBACK: Individual optimized calls with aggressive timeouts**
        const generateReply = async (type) => {
            const config = replyTypeConfigs[type];
            const prompt = `Email: ${emailBody.substring(0, 300)}\n\nWrite a ${type.toLowerCase()} reply: ${config.instruction}`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: config.systemMessage },
                    { role: "user", content: prompt }
                ],
                max_tokens: config.maxTokens,
                temperature: 0.3,
                stream: false
            });

            return {
                replyType: type,
                reply: completion.choices[0].message.content,
                usage: completion.usage
            };
        };

        // Individual calls with timeout
        const replyPromises = typesToGenerate.map(type => 
            Promise.race([
                generateReply(type),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error(`Timeout: ${type}`)), 8000)
                )
            ]).catch(error => ({
                replyType: type,
                reply: `Quick ${type} reply: Thank you for your email. I will respond shortly.`,
                error: error.message,
                fallback: true
            }))
        );

        const results = await Promise.all(replyPromises);
        
        const replies = {};
        results.forEach(result => {
            replies[result.replyType] = result.reply;
        });

        // Cache successful responses
        if (!results.some(result => result.fallback)) {
            responseCache.set(cacheKey, {
                data: replies,
                timestamp: Date.now()
            });
        }

        console.log(`Generated ${typesToGenerate.length} replies in ${Date.now() - startTime}ms`);
        
        res.json({
            success: true,
            replies,
            responseTime: Date.now() - startTime
        });

    } catch (error) {
        console.error('Error generating email reply:', error);
        
        // Provide fallback responses even on complete failure
        const fallbackReplies = {
            'Direct & Concise': 'Thank you for your email. I will respond shortly.',
            'Professional': 'Thank you for your message. I have received it and will reply as soon as possible.',
            'Detailed / Informative': 'I acknowledge receipt of your email. Thank you for reaching out. I will review your message and provide a response shortly.'
        };
        
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate email reply',
            fallbackReplies, // Always provide something usable
            responseTime: Date.now() - startTime
        });
    }
});

// Optimized summarize endpoint
router.post('/summarize', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { task, emailBody, emailSubject, userQuestion, chatHistory } = req.body;

        // Quick validation
        if (!task || !emailBody) {
            return res.status(400).json({
                success: false,
                error: 'task and emailBody are required'
            });
        }

        // Simple caching for summarize
        const summarizeCacheKey = generateCacheKey(`summarize-${task}-${emailBody}`, '');
        const cachedSummary = responseCache.get(summarizeCacheKey);
        if (cachedSummary && (Date.now() - cachedSummary.timestamp) < CACHE_TTL) {
            return res.json({
                ...cachedSummary.data,
                cached: true,
                responseTime: Date.now() - startTime
            });
        }

        if (task === 'summarize') {
            // Ultra-concise prompt
            const userPrompt = `Summarize briefly in bullet points:\nSubject: ${emailSubject || 'N/A'}\nEmail: ${emailBody.substring(0, 800)}`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { 
                        role: "system", 
                        content: "Provide very brief bullet point summaries. Maximum 3-4 bullet points. Be extremely concise." 
                    },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 200,
                temperature: 0.2
            });

            const summary = completion.choices[0].message.content;

            const response = {
                success: true,
                task: "summary",
                summary: summary
            };

            // Cache the summary
            responseCache.set(summarizeCacheKey, {
                data: response,
                timestamp: Date.now()
            });

            return res.json({
                ...response,
                responseTime: Date.now() - startTime
            });
        }

        if (task === 'chat') {
            if (!userQuestion) {
                return res.status(400).json({
                    success: false,
                    error: 'userQuestion is required for chat task'
                });
            }

            // Optimized chat prompt
            const systemMessage = `Answer based ONLY on this email. Be brief. If info not in email, say "This isn't mentioned in the email."

Email Subject: ${emailSubject || 'N/A'}
Email Body: ${emailBody.substring(0, 1000)}`;

            const messages = [
                { role: "system", content: systemMessage },
                ...(Array.isArray(chatHistory) ? chatHistory.slice(-4) : []), // Limit history
                { role: "user", content: userQuestion.substring(0, 300) }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                max_tokens: 150,
                temperature: 0.3
            });

            const answer = completion.choices[0].message.content;

            const updatedHistory = [
                ...(chatHistory || []),
                { role: "user", content: userQuestion },
                { role: "assistant", content: answer }
            ];

            return res.json({
                success: true,
                task: "chat",
                answer: answer,
                chatHistory: updatedHistory,
                responseTime: Date.now() - startTime
            });
        }

        return res.status(400).json({
            success: false,
            error: `Invalid task: "${task}". Must be "summarize" or "chat".`
        });

    } catch (error) {
        console.error('Error in summarize endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process request',
            responseTime: Date.now() - startTime
        });
    }
});

// Clear cache endpoint (optional, for maintenance)
router.delete('/cache', (req, res) => {
    const beforeSize = responseCache.size;
    responseCache.clear();
    res.json({
        success: true,
        message: `Cache cleared. Removed ${beforeSize} items.`
    });
});

module.exports = router;
