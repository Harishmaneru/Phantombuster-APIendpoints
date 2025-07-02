const express = require('express');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const router = express.Router();

// Environment variables
const {
    CPANEL_MAIL_SERVER,
    SMTP_PORT,
    MAX_ATTACHMENT_SIZE,
    MAX_ATTACHMENTS,
    RATE_LIMIT_WINDOW,
    RATE_LIMIT_MAX
} = process.env;

// Rate limiting
const emailLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW * 60 * 1000,
    max: RATE_LIMIT_MAX,
    message: {
        success: false,
        error: 'Too many requests, please try again later.'
    }
});

// Validation middleware
const validateEmailRequest = [
    body('fromEmail').isEmail().normalizeEmail(),
    body('toEmail').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('subject').trim().isLength({ min: 1, max: 200 }),
    body('message').trim().isLength({ min: 1, max: 10000 }),
    body('isHtml').optional().isBoolean(),
    body('replyTo').optional().isEmail().normalizeEmail(),
    body('cc').optional().isArray(),
    body('cc.*').optional().isEmail(),
    body('bcc').optional().isArray(),
    body('bcc.*').optional().isEmail()
];

// Security middleware
router.use(helmet());

// Email sending endpoint
router.post('/send-email', emailLimiter, validateEmailRequest, async (req, res) => {
    console.log('[EMAIL] Starting email send request');

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('[EMAIL] Validation failed:', errors.array());
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }

    const {
        fromEmail,
        password,
        toEmail,
        subject,
        message,
        isHtml = false,
        replyTo,
        cc,
        bcc,
        attachments = []
    } = req.body;

    console.log(`[EMAIL] Processing email from ${fromEmail} to ${toEmail}, subject: ${subject}`);

    try {
        console.log('[EMAIL] Creating SMTP transporter');

        // Create transporter with connection pooling
        const transporter = nodemailer.createTransport({
            host: CPANEL_MAIL_SERVER,
            port: SMTP_PORT,
            secure: true,
            auth: {
                user: fromEmail,
                pass: password
            },
            pool: true,
            maxConnections: 5,
            tls: {
                rejectUnauthorized: process.env.NODE_ENV === 'production'
            }
        });

        // Verify connection
        await transporter.verify();
        console.log('[EMAIL] SMTP connection verified successfully');

        // Send email
        const info = await transporter.sendMail({
            from: `"${fromEmail.split('@')[0]}" <${fromEmail}>`,
            to: toEmail,
            subject: subject,
            text: isHtml ? undefined : message,
            html: isHtml ? message : undefined,
            replyTo: replyTo,
            cc: cc,
            bcc: bcc,
            attachments: attachments.map(attach => ({
                filename: attach.originalname,
                content: attach.buffer
            }))
        });

        console.log(`[EMAIL] Email sent successfully, messageId: ${info.messageId}`);
        res.json({
            success: true,
            messageId: info.messageId
        });

    } catch (error) {
        console.error('[EMAIL] Error occurred:', error.message, 'Code:', error.code);

        let status = 500;
        let message = 'Failed to send email';

        if (error.code === 'EAUTH') {
            status = 401;
            message = 'Invalid email credentials';
        } else if (error.code === 'EENVELOPE') {
            status = 400;
            message = 'Invalid recipient address';
        }

        console.log(`[EMAIL] Returning error response: ${status} - ${message}`);
        res.status(status).json({
            success: false,
            error: message
        });
    }
});

module.exports = router;