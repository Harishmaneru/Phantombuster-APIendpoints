const express = require('express');
const OpenAI = require('openai');
const router = express.Router();

// Initialize OpenAI with optimized settings
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 15000,
    maxRetries: 2
});

// Enhanced cache with LRU-like behavior
const responseCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 500;

const generateCacheKey = (emailBody, replyType) => {
    return `${Buffer.from(emailBody).toString('base64').substring(0, 80)}-${replyType}`;
};

// Cache cleanup
const cleanupCache = () => {
    if (responseCache.size > MAX_CACHE_SIZE) {
        const entries = Array.from(responseCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        entries.slice(0, 100).forEach(([key]) => responseCache.delete(key));
    }
};



// **BACKWARD COMPATIBLE EMAIL REPLY GENERATOR**
router.post('/generate-email-reply', async (req, res) => {
    const startTime = Date.now();

    try {
        // Handle both old and new payload structures
        const {
            emailBody,
            // Old parameter name (backward compatible)
            replyType,
            // New parameter names
            replyTypes,
            tone = 'neutral',
            recipientName = '',
            senderName = '',
            additionalInstructions = ''
        } = req.body;

        // Validate required fields
        if (!emailBody || typeof emailBody !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Valid emailBody is required',
                details: 'emailBody must be a non-empty string'
            });
        }

        // Determine reply types (support both old and new formats)
        let typesToGenerate;

        // Priority: 1. replyTypes (new), 2. replyType (old), 3. default
        if (replyTypes && Array.isArray(replyTypes) && replyTypes.length > 0) {
            // Handle "all" in array
            if (replyTypes.includes('all')) {
                typesToGenerate = ['Direct & Concise', 'Professional', 'Detailed / Informative'];
            } else {
                const validReplyTypes = ['Direct', 'Professional', 'Detailed', 'Friendly', 'Formal', 'Casual'];
                typesToGenerate = replyTypes.filter(type => validReplyTypes.includes(type));

                // Map to old format names if needed for backward compatibility
                typesToGenerate = typesToGenerate.map(type => {
                    if (type === 'Direct') return 'Direct & Concise';
                    if (type === 'Detailed') return 'Detailed / Informative';
                    return type;
                });
            }
        }
        // Old format: comma-separated string
        else if (replyType) {
            // Handle "all" special case
            if (replyType.toLowerCase() === 'all') {
                typesToGenerate = ['Direct & Concise', 'Professional', 'Detailed / Informative'];
            } else {
                const requestedTypes = replyType.split(',').map(type => type.trim());
                const allReplyTypes = ['Direct & Concise', 'Professional', 'Detailed / Informative'];

                typesToGenerate = [];
                for (const requestedType of requestedTypes) {
                    // Handle partial matches
                    if (requestedType.toLowerCase() === 'direct' ||
                        requestedType.toLowerCase() === 'concise' ||
                        requestedType.toLowerCase() === 'direct & concise') {
                        typesToGenerate.push('Direct & Concise');
                    }
                    else if (requestedType.toLowerCase() === 'professional') {
                        typesToGenerate.push('Professional');
                    }
                    else if (requestedType.toLowerCase() === 'detailed' ||
                        requestedType.toLowerCase() === 'informative' ||
                        requestedType.toLowerCase() === 'detailed / informative') {
                        typesToGenerate.push('Detailed / Informative');
                    }
                    else {
                        // Try to match
                        const matchedType = allReplyTypes.find(validType =>
                            validType.toLowerCase().includes(requestedType.toLowerCase())
                        );
                        if (matchedType && !typesToGenerate.includes(matchedType)) {
                            typesToGenerate.push(matchedType);
                        }
                    }
                }
            }
        }
        // Default to all three
        else {
            typesToGenerate = ['Direct & Concise', 'Professional', 'Detailed / Informative'];
        }

        // Remove duplicates
        typesToGenerate = [...new Set(typesToGenerate)];

        if (typesToGenerate.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid reply types specified',
                validTypes: ['Direct & Concise', 'Professional', 'Detailed / Informative', 'all'],
                examples: [
                    'replyType: "all"',
                    'replyType: "Direct & Concise,Professional"',
                    'replyType: "direct"',
                    'replyType: "detailed"'
                ]
            });
        }

        // Check cache (use old-style cache key for backward compatibility)
        const cacheKey = generateCacheKey(emailBody, typesToGenerate.join(','));
        const cached = responseCache.get(cacheKey);

        if (cached) {
            return res.json({
                success: true,
                replies: cached.replies,
                cached: true,
                responseTime: Date.now() - startTime
            });
        }

        // Generate replies
        const trimmedEmailBody = emailBody.substring(0, 2000);

        // Prepare system message
        const systemMessage = `You are an expert email composer. Generate high-quality email replies.

GENERATION RULES:
1. Create COMPLETE emails with proper structure
2. Include appropriate greeting and closing
3. Address all key points from the original email
4. Match the tone and formality level
5. Be professional, clear, and actionable
6. Use natural, conversational language

REPLY STYLES:
- Direct & Concise: Brief, to the point, minimal pleasantries (2-3 sentences max)
- Professional: Balanced, business-appropriate, well-structured (4-6 sentences)
- Detailed / Informative: Comprehensive, addresses all aspects thoroughly (6+ sentences)

${recipientName ? `RECIPIENT: ${recipientName}` : ''}
${senderName ? `SENDER: ${senderName}` : ''}
${additionalInstructions ? `ADDITIONAL INSTRUCTIONS: ${additionalInstructions}` : ''}`;

        // Prepare user prompt
        let styleDescriptions = '';
        const styleMapping = {
            'Direct & Concise': 'Direct & Concise (brief, 2-3 sentences, straight to the point)',
            'Professional': 'Professional (formal business tone, 4-6 sentences, complete structure)',
            'Detailed / Informative': 'Detailed / Informative (comprehensive, 6+ sentences, full explanations)'
        };

        typesToGenerate.forEach(type => {
            if (styleMapping[type]) {
                styleDescriptions += `- ${styleMapping[type]}\n`;
            }
        });

        const userPrompt = `ORIGINAL EMAIL TO REPLY TO:
${trimmedEmailBody}

Generate email replies in these specific styles:
${styleDescriptions}

For each style, generate a COMPLETE EMAIL ready to send, including:
- Appropriate greeting (use ${recipientName ? `"Dear ${recipientName}"` : '"Hi" or "Hello"'} for greeting)
- Clear body addressing the email content
- Professional closing (use ${senderName ? `"Best regards,\n${senderName}"` : '"Best regards"'} for closing)
- Proper formatting with line breaks between paragraphs

IMPORTANT: Make each reply DISTINCT and appropriate for its style.

Return as JSON with each requested style as a key containing the full email.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userPrompt }
            ],
            max_tokens: typesToGenerate.length === 3 ? 1500 : 1000,
            temperature: 0.7,
            response_format: { type: "json_object" },
            stream: false
        });

        const content = completion.choices[0].message.content;
        let replies;

        try {
            replies = JSON.parse(content);

            // Validate and ensure all requested types are present
            const validatedReplies = {};
            const missingTypes = [];

            typesToGenerate.forEach(type => {
                if (replies[type] && typeof replies[type] === 'string' && replies[type].trim().length > 20) {
                    validatedReplies[type] = replies[type].trim();
                } else {
                    missingTypes.push(type);
                }
            });

            // Generate fallbacks for missing types
            if (missingTypes.length > 0) {
                const greeting = recipientName ? `Dear ${recipientName},` : 'Hello,';
                const closing = senderName ? `\n\nBest regards,\n${senderName}` : '\n\nBest regards';

                missingTypes.forEach(type => {
                    if (type === 'Direct & Concise') {
                        validatedReplies[type] = `${greeting}\n\nThanks for your email. I'll review and get back to you soon.${closing}`;
                    } else if (type === 'Professional') {
                        validatedReplies[type] = `${greeting}\n\nThank you for your message. I have received it and will provide a detailed response shortly.${closing}`;
                    } else if (type === 'Detailed / Informative') {
                        validatedReplies[type] = `${greeting}\n\nThank you for reaching out. I acknowledge receipt of your email and will carefully review all the points mentioned. I'll provide a comprehensive response addressing each aspect you've raised.${closing}`;
                    }
                });
            }

            // Cache the result
            responseCache.set(cacheKey, {
                replies: validatedReplies,
                timestamp: Date.now()
            });

            return res.json({
                success: true,
                replies: validatedReplies,
                generatedTypes: typesToGenerate,
                responseTime: Date.now() - startTime
            });

        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            throw new Error('Failed to parse AI response');
        }

    } catch (error) {
        console.error('Email reply generation error:', error);

        // Backward compatible fallback replies
        const fallbackReplies = {
            'Direct & Concise': 'Hi,\n\nThanks for your email. I will review this and respond shortly.\n\nBest regards',
            'Professional': 'Dear Sender,\n\nThank you for your message. I have received it and will provide a detailed response as soon as possible.\n\nBest regards',
            'Detailed / Informative': 'Dear Sender,\n\nThank you for taking the time to reach out. I acknowledge receipt of your email and have noted all the details you have shared.\n\nI will carefully review your message and provide a comprehensive response within the next 24-48 hours. If there is anything urgent that requires immediate attention, please let me know.\n\nBest regards'
        };

        const errorResponse = {
            success: false,
            error: error.message || 'Failed to generate email replies',
            fallbackReplies,
            responseTime: Date.now() - startTime
        };

        if (error instanceof OpenAI.APIError) {
            errorResponse.apiError = {
                code: error.code,
                type: error.type
            };
        }

        res.status(500).json(errorResponse);
    }
});

// **OPTIMIZED SUMMARIZE ENDPOINT**
router.post('/summarize', async (req, res) => {
    const startTime = Date.now();

    try {
        const { task, emailBody, emailSubject, userQuestion, chatHistory } = req.body;

        if (!task || !emailBody) {
            return res.status(400).json({
                success: false,
                error: 'task and emailBody are required'
            });
        }

        // **SUMMARIZE TASK (Non-streaming)**
        if (task === 'summarize') {
            // Check cache first
            const summarizeCacheKey = generateCacheKey(`summarize-${emailBody}`, emailSubject || '');
            const cachedSummary = responseCache.get(summarizeCacheKey);

            if (cachedSummary && (Date.now() - cachedSummary.timestamp) < CACHE_TTL) {
                return res.json({
                    success: true,
                    task: "summary",
                    summary: cachedSummary.data.summary,
                    cached: true,
                    responseTime: Date.now() - startTime
                });
            }

            const systemMessage = `You are an expert at summarizing emails concisely. Create clear, actionable bullet points.

Rules:
- Maximum 4-5 bullet points
- Each point should be clear and specific
- Focus on key information, action items, and important details
- Use professional language
- Be concise but informative`;

            const userPrompt = `Summarize this email in bullet points:

Subject: ${emailSubject || 'No subject'}

Email Body:
${emailBody.substring(0, 1500)}

Provide a concise bullet-point summary.`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: userPrompt }
                ],
                max_tokens: 300,
                temperature: 0.3,
                stream: false
            });

            const summary = completion.choices[0].message.content;

            // Cache the complete summary
            responseCache.set(summarizeCacheKey, {
                data: { summary },
                timestamp: Date.now()
            });
            cleanupCache();

            return res.json({
                success: true,
                task: "summary",
                summary: summary,
                responseTime: Date.now() - startTime
            });
        }

        // **CHAT TASK (Non-streaming)**
        if (task === 'chat') {
            if (!userQuestion) {
                return res.status(400).json({
                    success: false,
                    error: 'userQuestion is required for chat task'
                });
            }

            const systemMessage = `You are an AI assistant helping users understand an email. Answer questions based ONLY on the email content provided.

Email Subject: ${emailSubject || 'No subject'}
Email Body: ${emailBody.substring(0, 2000)}

Rules:
- Answer only based on the email content above
- Be concise and direct
- If information is not in the email, clearly state: "This information is not mentioned in the email."
- Provide specific references when possible`;

            const messages = [
                { role: "system", content: systemMessage },
                ...(Array.isArray(chatHistory) ? chatHistory.slice(-6) : []),
                { role: "user", content: userQuestion.substring(0, 500) }
            ];

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: messages,
                max_tokens: 200,
                temperature: 0.4
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

// Clear cache endpoint
router.delete('/cache', (req, res) => {
    const beforeSize = responseCache.size;
    responseCache.clear();
    res.json({
        success: true,
        message: `Cache cleared. Removed ${beforeSize} items.`
    });
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        success: true,
        cacheSize: responseCache.size,
        uptime: process.uptime()
    });
});

module.exports = router;