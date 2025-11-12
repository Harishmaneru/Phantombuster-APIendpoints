const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Unified API endpoint for email reply generation
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

        if (!replyType) {
            return res.status(400).json({
                success: false,
                error: 'replyType is required. Valid types: "Direct & Concise", "Professional", "Detailed / Informative"'
            });
        }

        // Define reply type instructions
        const replyTypeInstructions = {
            'Direct & Concise': {
                instruction: 'Write a direct and concise email reply. Get straight to the point without unnecessary formalities or filler words. Keep it brief and action-oriented. Focus on the essential information only.',
                maxTokens: 300,
                systemMessage: 'You are an expert at writing concise, direct email replies that get straight to the point.'
            },
            'Professional': {
                instruction: 'Write a professional, formal email reply. Use proper business language, complete sentences, and maintain a respectful, professional tone. Include appropriate greetings and closing. Balance formality with clarity.',
                maxTokens: 500,
                systemMessage: 'You are an expert email writer who creates perfect professional email replies for business contexts.'
            },
            'Detailed / Informative': {
                instruction: 'Write a detailed and informative email reply. Provide comprehensive information, context, and explanations. Include all relevant details that might be helpful. Use clear structure and organization. Ensure the recipient has all the information they need.',
                maxTokens: 800,
                systemMessage: 'You are an expert at writing detailed, informative email replies that provide comprehensive information and context.'
            }
        };

        // Check if replyType is valid
        const typeConfig = replyTypeInstructions[replyType];
        if (!typeConfig) {
            return res.status(400).json({
                success: false,
                error: `Invalid replyType. Valid types are: "Direct & Concise", "Professional", "Detailed / Informative"`
            });
        }

        // Build the prompt
        const prompt = `
ORIGINAL EMAIL:
${emailBody}

TASK: Generate a ${replyType} email reply based on the original email above.

INSTRUCTIONS:
${typeConfig.instruction}
- Keep the reply relevant to the original email
- Include proper email etiquette
- If the email contains questions, make sure to answer them
- If it requires action, be clear about next steps
- Maintain appropriate tone and formatting

EMAIL REPLY:
`;

        // Generate reply using OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
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
            max_tokens: typeConfig.maxTokens,
            temperature: 0.7
        });

        const generatedReply = completion.choices[0].message.content;

        res.json({
            success: true,
            replyType,
            originalEmail: emailBody,
            generatedReply,
            usage: completion.usage
        });

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
                summary: summary,
                usage: completion.usage
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
                chatHistory: updatedHistory, // Send back the full history
                usage: completion.usage
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
