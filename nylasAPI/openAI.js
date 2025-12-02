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

// Enhanced quick templates with proper email formatting
const quickTemplates = {
    'acknowledgment': {
        'Direct & Concise': "Hi,\n\nThanks for your email. I'll review this and get back to you soon.\n\nBest regards",
        'Professional': "Dear Sender,\n\nThank you for reaching out. I have received your message and will review the details carefully. I will respond with a comprehensive reply shortly.\n\nBest regards",
        'Detailed / Informative': "Dear Sender,\n\nThank you for your email. I appreciate you taking the time to share these details with me.\n\nI have carefully noted all the points you've mentioned and will provide a thorough response after reviewing everything in detail. You can expect to hear back from me within the next 24-48 hours.\n\nIf there's anything urgent that requires immediate attention, please feel free to let me know.\n\nBest regards"
    },
    'confirmation': {
        'Direct & Concise': "Hi,\n\nConfirmed. I'll proceed as discussed.\n\nBest regards",
        'Professional': "Dear Sender,\n\nThis email confirms that I have received your instructions and understood the requirements. I will proceed accordingly and keep you updated on the progress.\n\nBest regards",
        'Detailed / Informative': "Dear Sender,\n\nI am writing to confirm receipt of your message and acknowledge the details you have outlined.\n\nI have reviewed all the points mentioned and will ensure that each item is addressed according to your specifications. I will follow the timeline discussed and provide regular updates as we progress.\n\nPlease don't hesitate to reach out if you have any questions or need clarification on any aspect.\n\nBest regards"
    }
};

const detectEmailPattern = (emailBody) => {
    const body = emailBody.toLowerCase();
    if (body.length < 50 && (body.includes('thank') || body.includes('thanks') || body.includes('appreciate'))) {
        return 'acknowledgment';
    }
    if (body.length < 50 && (body.includes('confirm') || body.includes('acknowledge'))) {
        return 'confirmation';
    }
    return null;
};

// **OPTIMIZED EMAIL GENERATION ENDPOINT**
router.post('/generate-email-reply', async (req, res) => {
    const startTime = Date.now();

    try {
        const { emailBody, replyType } = req.body;

        if (!emailBody) {
            return res.status(400).json({
                success: false,
                error: 'emailBody is required in the payload'
            });
        }

        // Check cache
        const cacheKey = generateCacheKey(emailBody, replyType);
        const cached = responseCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            return res.json({
                success: true,
                replies: cached.data,
                cached: true,
                responseTime: Date.now() - startTime
            });
        }

        // Quick pattern matching
        const emailPattern = detectEmailPattern(emailBody);
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

        // Use quick templates if pattern detected
        if (emailPattern) {
            const quickReplies = {};
            typesToGenerate.forEach(type => {
                if (quickTemplates[emailPattern] && quickTemplates[emailPattern][type]) {
                    quickReplies[type] = quickTemplates[emailPattern][type];
                }
            });

            if (Object.keys(quickReplies).length === typesToGenerate.length) {
                responseCache.set(cacheKey, { data: quickReplies, timestamp: Date.now() });
                cleanupCache();

                return res.json({
                    success: true,
                    replies: quickReplies,
                    quickTemplate: true,
                    responseTime: Date.now() - startTime
                });
            }
        }

        // **SINGLE OPTIMIZED API CALL WITH PROPER EMAIL FORMATTING**
        const systemMessage = `You are an expert email writer. Generate professional email replies in proper email format.

CRITICAL FORMATTING RULES:
1. Start with appropriate greeting (Hi/Hello for casual, Dear [Sender] for formal)
2. Write clear paragraphs with proper spacing
3. End with professional closing (Best regards/Sincerely/Kind regards)
4. Use proper email structure with line breaks
5. Be natural and conversational while maintaining professionalism

Generate responses that match the exact tone and length for each style requested.`;

        const styleGuides = {
            'Direct & Concise': 'Brief and to the point. Casual greeting. Address main points quickly without unnecessary details. Efficient communication.',
            'Professional': 'Professional business tone. Formal greeting. Address all key points with appropriate detail. Well-structured and clear.',
            'Detailed / Informative': 'Thorough and comprehensive. Formal greeting. Address all aspects mentioned in the email with full context and explanations. Include relevant background and next steps where appropriate.'
        };

        const userPrompt = `Original Email to Reply To:
---
${emailBody.substring(0, 800)}
---

Generate ${typesToGenerate.length} email reply variation(s) in PROPER EMAIL FORMAT with these exact styles:

${typesToGenerate.map(type => `**${type}**: ${styleGuides[type]}`).join('\n')}

IMPORTANT INSTRUCTIONS:
- Adapt the reply length based on the complexity and content of the original email
- For simple emails (thank you, confirmation, etc.), keep replies concise regardless of style
- For complex emails with multiple questions or topics, provide appropriate depth
- Maintain the specified tone and style, but let content dictate length
- Always include proper greeting and closing

Return ONLY valid JSON in this exact format:
{
  "Direct & Concise": "full email reply with greeting and closing",
  "Professional": "full email reply with greeting and closing",
  "Detailed / Informative": "full email reply with greeting and closing"
}

Include only the styles requested: ${typesToGenerate.join(', ')}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userPrompt }
            ],
            max_tokens: 1200, // Increased to allow AI to decide appropriate length
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content;
        let replies = JSON.parse(content);

        // Filter to only requested types
        const filteredReplies = {};
        typesToGenerate.forEach(type => {
            if (replies[type]) {
                filteredReplies[type] = replies[type];
            }
        });

        // Cache response
        responseCache.set(cacheKey, {
            data: filteredReplies,
            timestamp: Date.now()
        });
        cleanupCache();

        console.log(`Generated ${typesToGenerate.length} replies in ${Date.now() - startTime}ms`);

        res.json({
            success: true,
            replies: filteredReplies,
            responseTime: Date.now() - startTime
        });

    } catch (error) {
        console.error('Error generating email reply:', error);

        const fallbackReplies = {
            'Direct & Concise': 'Hi,\n\nThanks for your email. I will review this and respond shortly.\n\nBest regards',
            'Professional': 'Dear Sender,\n\nThank you for your message. I have received it and will provide a detailed response as soon as possible.\n\nBest regards',
            'Detailed / Informative': 'Dear Sender,\n\nThank you for taking the time to reach out. I acknowledge receipt of your email and have noted all the details you have shared.\n\nI will carefully review your message and provide a comprehensive response within the next 24-48 hours. If there is anything urgent that requires immediate attention, please let me know.\n\nBest regards'
        };

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate email reply',
            fallbackReplies,
            responseTime: Date.now() - startTime
        });
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