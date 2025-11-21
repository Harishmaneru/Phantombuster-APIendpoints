const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Unified API endpoint for email reply generation
// Returns reply types based on replyType parameter
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

//         // Define reply type instructions
//         const replyTypeInstructions = {
//             'Direct & Concise': {
//                 instruction: 'Write a direct and concise email reply. Get straight to the point without unnecessary formalities or filler words. Keep it brief and action-oriented. Focus on the essential information only.',
//                 maxTokens: 300,
//                 systemMessage: 'You are an expert at writing concise, direct email replies that get straight to the point.'
//             },
//             'Professional': {
//                 instruction: 'Write a professional, formal email reply. Use proper business language, complete sentences, and maintain a respectful, professional tone. Include appropriate greetings and closing. Balance formality with clarity.',
//                 maxTokens: 500,
//                 systemMessage: 'You are an expert email writer who creates perfect professional email replies for business contexts.'
//             },
//             'Detailed / Informative': {
//                 instruction: 'Write a detailed and informative email reply. Provide comprehensive information, context, and explanations. Include all relevant details that might be helpful. Use clear structure and organization. Ensure the recipient has all the information they need.',
//                 maxTokens: 800,
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

//         // Generate reply function
//         const generateReply = async (type) => {
//             const typeConfig = replyTypeInstructions[type];
//             const prompt = `
// ORIGINAL EMAIL:
// ${emailBody}

// TASK: Generate a ${type} email reply based on the original email above.

// INSTRUCTIONS:
// ${typeConfig.instruction}
// - Keep the reply relevant to the original email
// - Include proper email etiquette
// - If the email contains questions, make sure to answer them
// - If it requires action, be clear about next steps
// - Maintain appropriate tone and formatting

// EMAIL REPLY:
// `;

//             const completion = await openai.chat.completions.create({
//                 model: "gpt-3.5-turbo",
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
//                 max_tokens: typeConfig.maxTokens,
//                 temperature: 0.7
//             });

//             return {
//                 replyType: type,
//                 reply: completion.choices[0].message.content,
//                 usage: completion.usage
//             };
//         };

//         // Generate only the requested reply types in parallel
//         const replies = await Promise.all(
//             typesToGenerate.map(type => generateReply(type))
//         );

//         // Calculate total usage
//         const totalUsage = replies.reduce((acc, reply) => {
//             return {
//                 prompt_tokens: acc.prompt_tokens + reply.usage.prompt_tokens,
//                 completion_tokens: acc.completion_tokens + reply.usage.completion_tokens,
//                 total_tokens: acc.total_tokens + reply.usage.total_tokens
//             };
//         }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        
//         console.log('AI reply totalUsage', totalUsage);
        
//         // Build clean response structure with only requested types
//         const responseReplies = {};
//         replies.forEach(reply => {
//             responseReplies[reply.replyType] = reply.reply;
//         });

//         const response = {
//             success: true,
//             // originalEmail: emailBody,
//             replies: responseReplies
//             // usage: totalUsage
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
router.post('/generate-email-reply', async (req, res) => {
    try {
        const { emailBody, replyType } = req.body;

        // Validate required fields
        if (!emailBody) {
            return res.status(400).json({
                success: false,
                error: 'emailBody is required in the payload'
            });
        }

        // Define reply type instructions (optimized for speed)
        const replyTypeInstructions = {
            'Direct & Concise': {
                instruction: 'Write a direct and concise email reply. Get straight to the point without unnecessary formalities or filler words. Keep it brief and action-oriented. Focus on the essential information only.',
                maxTokens: 200, // Reduced for faster responses
                systemMessage: 'You are an expert at writing concise, direct email replies that get straight to the point.'
            },
            'Professional': {
                instruction: 'Write a professional, formal email reply. Use proper business language, complete sentences, and maintain a respectful, professional tone. Include appropriate greetings and closing. Balance formality with clarity.',
                maxTokens: 300, // Reduced for faster responses
                systemMessage: 'You are an expert email writer who creates perfect professional email replies for business contexts.'
            },
            'Detailed / Informative': {
                instruction: 'Write a detailed and informative email reply. Provide comprehensive information, context, and explanations. Include all relevant details that might be helpful. Use clear structure and organization. Ensure the recipient has all the information they need.',
                maxTokens: 400, // Reduced for faster responses
                systemMessage: 'You are an expert at writing detailed, informative email replies that provide comprehensive information and context.'
            }
        };

        // All valid reply types
        const allReplyTypes = ['Direct & Concise', 'Professional', 'Detailed / Informative'];

        // Parse replyType to determine which types to generate
        let typesToGenerate = [];
        
        if (replyType) {
            // Split by comma and clean up the types
            const requestedTypes = replyType.split(',').map(type => type.trim());
            
            // Validate and match types (case-insensitive, handles whitespace)
            for (const requestedType of requestedTypes) {
                // Find matching type (case-insensitive comparison)
                const matchedType = allReplyTypes.find(validType => {
                    // Normalize both strings for comparison
                    const normalize = (str) => str.toLowerCase().trim().replace(/\s+/g, ' ');
                    return normalize(requestedType) === normalize(validType);
                });
                
                if (matchedType && !typesToGenerate.includes(matchedType)) {
                    typesToGenerate.push(matchedType);
                }
            }

            // If no valid types found, return error
            if (typesToGenerate.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid replyType. Valid types are: "Direct & Concise", "Professional", "Detailed / Informative". You can request one or all three (comma-separated).`
                });
            }
        } else {
            // If no replyType provided, default to all three
            typesToGenerate = [...allReplyTypes];
        }

        // **OPTIMIZATION: Create all API calls at once for true parallel processing**
        const generateReply = (type) => {
            const typeConfig = replyTypeInstructions[type];
            // Shorter, more efficient prompt for faster processing
            const prompt = `Email: ${emailBody}\n\nGenerate a ${type} reply. ${typeConfig.instruction}`;

            // Add timeout wrapper (30 seconds max per request)
            const apiCall = openai.chat.completions.create({
                model: "gpt-4o-mini", // Faster and cheaper than gpt-3.5-turbo
                messages: [
                    {
                        role: "system",
                        content: typeConfig.systemMessage
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: typeConfig.maxTokens, // Already optimized values
                temperature: 0.5, // Lower temp for faster, more deterministic responses
                stream: false
            });

            // Timeout wrapper - 30 seconds max
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Timeout: ${type} reply generation took too long`)), 30000)
            );

            return Promise.race([apiCall, timeoutPromise]).then(completion => ({
                replyType: type,
                reply: completion.choices[0].message.content,
                usage: completion.usage
            }));
        };

        // **OPTIMIZATION: Use Promise.all for true parallel execution**
        const replyPromises = typesToGenerate.map(type => generateReply(type));
        
        const replies = await Promise.all(replyPromises);

        // **OPTIMIZATION: Calculate total usage more efficiently**
        const totalUsage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        };

        const responseReplies = {};
        
        replies.forEach(reply => {
            responseReplies[reply.replyType] = reply.reply;
            totalUsage.prompt_tokens += reply.usage.prompt_tokens;
            totalUsage.completion_tokens += reply.usage.completion_tokens;
            totalUsage.total_tokens += reply.usage.total_tokens;
        });

        console.log('AI reply totalUsage', totalUsage);
        
        const response = {
            success: true,
            replies: responseReplies
        };

        res.json(response);

    } catch (error) {
        console.error('Error generating email reply:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate email reply'
        });
    }
});



/**
 * @route   POST /api/email/process
 * @desc    Unified endpoint for email AI features (Summarize or Chat).
 * @access  Private (assuming auth middleware)
 *
 * @body    {
 * "task": "summarize" | "chat", // REQUIRED: The action to perform
 * "emailBody": "...",           // REQUIRED: The full body of the email
 * "emailSubject": "...",        // Optional: Subject for better context
 * "userQuestion": "...",        // REQUIRED only if task is "chat"
 * "chatHistory": [              // Optional: For multi-turn chat context
 * { "role": "user", "content": "..." },
 * { "role": "assistant", "content": "..." }
 * ]
 * }
 */
router.post('/summarize', async (req, res) => {
    const { task, emailBody, emailSubject, userQuestion, chatHistory } = req.body;

    // --- 1. Basic Payload Validation ---
    if (!task) {
        return res.status(400).json({
            success: false,
            error: 'Payload must include a "task" field ("summarize" or "chat")'
        });
    }

    if (!emailBody) {
        return res.status(400).json({
            success: false,
            error: 'Payload must include an "emailBody" field'
        });
    }

    try {
        // --- 2. Task: Summarize ---
        if (task === 'summarize') {
            const systemMessage = "You are an expert analysis AI. Your job is to read an email and extract the most essential points, action items, and key information. Format the output as a concise, easy-to-read bulleted list using Markdown.";

            const userPrompt = `
                Please provide a point-wise summary of the following email.
                Focus on:
                1.  The main purpose or topic.
                2.  Any specific questions asked of the recipient.
                3.  Any action items or deadlines mentioned.

                --- EMAIL START ---
                Subject: ${emailSubject || 'N/A'}
                
                Body:
                ${emailBody}
                --- EMAIL END ---
            `;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Using a cost-effective but smart model
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 500,
                temperature: 0.3 // Lower temp for factual summarization
            });

            const summary = completion.choices[0].message.content;

            return res.json({
                success: true,
                task: "summary",
                summary: summary
            });
        }

        // --- 3. Task: Chat ---
        if (task === 'chat') {
            if (!userQuestion) {
                return res.status(400).json({
                    success: false,
                    error: 'Payload must include "userQuestion" for "chat" task'
                });
            }

            // This system message is CRITICAL. It "pins" the email context for the AI.
            const systemMessage = `
                You are a helpful AI assistant. Your purpose is to help a user discuss and understand a specific email.
                You must answer the user's questions based *ONLY* on the content of the email provided below.
                If the answer is not in the email, state clearly that the information is not available in the email.
                Do not make up information. Be concise and direct.

                --- FULL EMAIL CONTEXT ---
                Subject: ${emailSubject || 'N/A'}
                
                Body:
                ${emailBody}
                --- END EMAIL CONTEXT ---
            `;

            // Build the message history
            let messageHistory = [{ role: "system", content: systemMessage }];

            // Add existing chat history if provided and valid
            if (Array.isArray(chatHistory) && chatHistory.length > 0) {
                messageHistory = [...messageHistory, ...chatHistory];
            }

            // Add the new user question
            messageHistory.push({ role: "user", content: userQuestion });

            // Generate the chat reply
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Good model for chat
                messages: messageHistory,
                max_tokens: 500,
                temperature: 0.5 // A bit more creative for natural chat
            });

            const answer = completion.choices[0].message.content;

            // Create the new history entry for the assistant's reply
            const newHistoryEntry = { role: "assistant", content: answer };

            // Send back the *updated* history so the client can store it
            const updatedHistory = [
                ...(chatHistory || []),
                { role: "user", content: userQuestion },
                newHistoryEntry
            ];

            return res.json({
                success: true,
                task: "chat",
                answer: answer,
                chatHistory: updatedHistory // Send back the full history
            
            });
        }

        // --- 4. Handle Invalid Task ---
        return res.status(400).json({
            success: false,
            error: `Invalid task: "${task}". Must be "summarize" or "chat".`
        });

    } catch (error) {
        console.error('Error processing email feature:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process email request'
        });
    }
});



module.exports = router;
