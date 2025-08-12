const express = require('express');
const axios = require('axios');

class UniversalSlackLogger {
    constructor() {
        this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
        this.channel = process.env.SLACK_LOG_CHANNEL || '#api-logs';
        this.username = process.env.SLACK_BOT_USERNAME || 'API Logger Bot';
        this.iconEmoji = process.env.SLACK_BOT_ICON || ':robot_face:';
        this.enabled = process.env.SLACK_LOGGING_ENABLED !== 'false'; // Enabled by default

        if (!this.webhookUrl) {
            console.warn('[SlackLogger] SLACK_WEBHOOK_URL not configured. Slack logging disabled.');
            this.enabled = false;
        }
    }

    /**
     * Universal log method that accepts any JSON payload
     * @param {Object} payload - Any JSON structure from your backend services
     * @param {Object} options - { level: 'info'|'warn'|'error', service: string }
     */
    async log(payload, options = {}) {
        if (!this.enabled) {
            console.log('[SlackLogger] Slack logging disabled, skipping log:', payload);
            return;
        }

        try {
            const slackMessage = this._formatUniversalMessage(payload, options);
            await this._sendToSlack(slackMessage);
        } catch (error) {
            console.error('[SlackLogger] Failed to send log:', error.message);
        }
    }

    // ─── Domain/Email Logs ──────────────────────────────────────────
    async logDomainPurchase(domainData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [Domain]`,
            icon_emoji: ':globe_with_meridians:',
            attachments: [{
                color: this._getStatusColor(domainData.status),
                title: `🛒 Domain Purchase: ${domainData.domainName}`,
                text: `*Status*: ${domainData.status.toUpperCase()}\n*User*: ${domainData.userEmail}`,
                fields: this._buildDomainFields(domainData),
                footer: this._buildFooter(domainData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    async logEmailCreation(emailData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [Email]`,
            icon_emoji: ':envelope:',
            attachments: [{
                color: this._getStatusColor(emailData.status),
                title: `📧 Email Created: ${emailData.emailAddress}`,
                text: `*Status*: ${emailData.status.toUpperCase()}\n*Domain*: ${emailData.domain}`,
                fields: this._buildEmailFields(emailData),
                footer: this._buildFooter(emailData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    // ─── OnePgr Logs ──────────────────────────────────────────────
    async logOnePgrEvent(eventData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [OnePgr]`,
            icon_emoji: ':rocket:',
            attachments: [{
                color: this._getLevelColor(eventData.level || 'info'),
                title: `🚀 ${eventData.eventType || 'OnePgr Event'}`,
                text: this._buildOnePgrText(eventData),
                fields: this._buildOnePgrFields(eventData),
                footer: this._buildFooter(eventData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    async logOnePgrLead(leadData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [OnePgr]`,
            icon_emoji: ':rocket:',
            attachments: [{
                color: this._getLevelColor('info'),
                title: `🎯 New Lead: ${leadData.name || 'Unknown'}`,
                text: `*Company*: ${leadData.company || 'N/A'}\n*Email*: ${leadData.email || 'N/A'}`,
                fields: this._buildOnePgrLeadFields(leadData),
                footer: this._buildFooter(leadData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    // ─── Kampaign.ai Logs ─────────────────────────────────────────
    async logKampaignEvent(campaignData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [Kampaign]`,
            icon_emoji: ':megaphone:',
            attachments: [{
                color: this._getCampaignColor(campaignData.campaignStatus),
                title: `📢 Campaign: ${campaignData.campaignName || campaignData.campaignId}`,
                text: this._buildKampaignText(campaignData),
                fields: this._buildKampaignFields(campaignData),
                footer: this._buildFooter(campaignData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    // ─── Payment Logs ─────────────────────────────────────────────
    async logPaymentEvent(paymentData) {
        const message = {
            channel: this.channel,
            username: `${this.username} [Payment]`,
            icon_emoji: ':credit_card:',
            attachments: [{
                color: this._getPaymentColor(paymentData.status),
                title: `💳 Payment: ${paymentData.type || 'Transaction'}`,
                text: `*Amount*: ${paymentData.amount} ${paymentData.currency}\n*Status*: ${paymentData.status.toUpperCase()}`,
                fields: this._buildPaymentFields(paymentData),
                footer: this._buildFooter(paymentData),
                mrkdwn_in: ['text', 'fields']
            }]
        };
        return this._sendToSlack(message);
    }

    // ─── Helper Methods ────────────────────────────────────────────
    _buildDomainFields(data) {
        const fields = [];

        if (data.amount && data.currency) {
            fields.push({
                title: 'Purchase Details',
                value: `Amount: ${data.amount} ${data.currency}\nYears: ${data.registrationYears || 'N/A'}`,
                short: true
            });
        }

        if (data.contactInfo) {
            const contact = data.contactInfo;
            fields.push({
                title: 'Contact',
                value: `${contact.firstName || ''} ${contact.lastName || ''}\n${contact.phone || 'N/A'}`,
                short: true
            });
        }

        if (data.provider) {
            fields.push({
                title: 'Provider',
                value: data.provider,
                short: true
            });
        }

        return fields;
    }

    _buildEmailFields(data) {
        const fields = [];

        if (data.quota) {
            fields.push({
                title: 'Quota',
                value: data.quota,
                short: true
            });
        }

        if (data.storageUsed !== undefined) {
            fields.push({
                title: 'Storage Used',
                value: `${data.storageUsed} MB`,
                short: true
            });
        }

        if (data.suspended !== undefined) {
            fields.push({
                title: 'Suspended',
                value: data.suspended ? 'Yes' : 'No',
                short: true
            });
        }

        return fields;
    }

    _buildOnePgrText(data) {
        let text = `*${data.message || 'Event triggered'}*`;
        if (data.leadId) text += `\nLead: ${data.leadId}`;
        if (data.visitorId) text += `\nVisitor: ${data.visitorId}`;
        if (data.source) text += `\nSource: ${data.source}`;
        return text;
    }

    _buildOnePgrFields(data) {
        const fields = [];

        if (data.title) {
            fields.push({
                title: 'Title',
                value: data.title,
                short: true
            });
        }

        if (data.location) {
            fields.push({
                title: 'Location',
                value: data.location,
                short: true
            });
        }

        if (data.website) {
            fields.push({
                title: 'Website',
                value: data.website,
                short: true
            });
        }

        if (data.employees) {
            fields.push({
                title: 'Company Size',
                value: data.employees,
                short: true
            });
        }

        return fields;
    }

    _buildOnePgrLeadFields(data) {
        const fields = [];

        if (data.title) {
            fields.push({
                title: 'Job Title',
                value: data.title,
                short: true
            });
        }

        if (data.linkedin) {
            fields.push({
                title: 'LinkedIn',
                value: data.linkedin,
                short: true
            });
        }

        if (data.website) {
            fields.push({
                title: 'Website',
                value: data.website,
                short: true
            });
        }

        if (data.industry) {
            fields.push({
                title: 'Industry',
                value: data.industry,
                short: true
            });
        }

        return fields;
    }

    _buildKampaignText(data) {
        let text = `*Campaign Status: ${data.campaignStatus || 'Unknown'}*`;
        if (data.description) text += `\n${data.description}`;
        return text;
    }

    _buildKampaignFields(data) {
        const fields = [];

        if (data.sentCount !== undefined || data.openCount !== undefined || data.clickThroughRate !== undefined) {
            fields.push({
                title: 'Stats',
                value: `Sent: ${data.sentCount || 0}\nOpened: ${data.openCount || 0}\nCTR: ${data.clickThroughRate || '0%'}`,
                short: true
            });
        }

        if (data.startTime || data.endTime) {
            fields.push({
                title: 'Timing',
                value: `Start: ${data.startTime || 'N/A'}\nEnd: ${data.endTime || 'Ongoing'}`,
                short: true
            });
        }

        if (data.targetAudience) {
            fields.push({
                title: 'Target Audience',
                value: data.targetAudience,
                short: true
            });
        }

        return fields;
    }

    _buildPaymentFields(data) {
        const fields = [];

        if (data.stripeSessionId) {
            fields.push({
                title: 'Stripe Session',
                value: data.stripeSessionId,
                short: true
            });
        }

        if (data.paymentIntentId) {
            fields.push({
                title: 'Payment Intent',
                value: data.paymentIntentId,
                short: true
            });
        }

        if (data.customerId) {
            fields.push({
                title: 'Customer ID',
                value: data.customerId,
                short: true
            });
        }

        if (data.invoiceId) {
            fields.push({
                title: 'Invoice ID',
                value: data.invoiceId,
                short: true
            });
        }

        return fields;
    }

    _getStatusColor(status) {
        const colors = {
            completed: '#36a64f',
            pending: '#ffa500',
            failed: '#ff0000',
            success: '#36a64f',
            error: '#ff0000'
        };
        return colors[status?.toLowerCase()] || '#cccccc';
    }

    _getCampaignColor(status) {
        const colors = {
            active: '#2eb67d',
            paused: '#ecb22e',
            completed: '#e01e5a',
            draft: '#a5a5a5',
            running: '#2eb67d',
            stopped: '#ff6b6b'
        };
        return colors[status?.toLowerCase()] || '#36a64f';
    }

    _getPaymentColor(status) {
        const colors = {
            succeeded: '#36a64f',
            pending: '#ffa500',
            failed: '#ff0000',
            canceled: '#ff6b6b',
            refunded: '#ffa500'
        };
        return colors[status?.toLowerCase()] || '#cccccc';
    }

    _buildFooter(data) {
        let footer = `Event ID: ${data.id || 'N/A'}`;
        if (data.timestamp) footer += ` | ${new Date(data.timestamp).toLocaleString()}`;
        if (data.systemInfo?.ipAddress) footer += ` | IP: ${data.systemInfo.ipAddress}`;
        if (data.userId) footer += ` | User: ${data.userId}`;
        return footer;
    }

    _formatUniversalMessage(payload, options) {
        // Default values
        const level = options.level || 'info';
        const service = options.service || 'Unknown Service';
        const timestamp = new Date().toISOString();

        // Start building the Slack message
        const message = {
            channel: this.channel,
            username: `${this.username} [${service}]`,
            icon_emoji: this.iconEmoji,
            attachments: [{
                color: this._getLevelColor(level),
                title: `${level.toUpperCase()} from ${service}`,
                text: '', // Will be built dynamically
                fields: [],
                footer: `Timestamp: ${timestamp}`,
                mrkdwn_in: ['text', 'fields']
            }]
        };

        // Handle different payload structures
        if (typeof payload === 'string') {
            // Simple string message
            message.attachments[0].text = payload;
        } else if (payload.message) {
            // Structured log with message
            message.attachments[0].text = `*${payload.message}*`;

            // Add all other properties as fields
            Object.entries(payload).forEach(([key, value]) => {
                if (key !== 'message' && value !== undefined) {
                    message.attachments[0].fields.push({
                        title: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
                        value: this._stringifyValue(value),
                        short: key.length < 10
                    });
                }
            });
        } else {
            // Pure JSON data
            message.attachments[0].text = `*${service} Event*`;

            Object.entries(payload).forEach(([key, value]) => {
                message.attachments[0].fields.push({
                    title: key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
                    value: this._stringifyValue(value),
                    short: key.length < 10 && !this._isLongValue(value)
                });
            });
        }

        return message;
    }

    _stringifyValue(value) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'object') {
            try {
                return '```' + JSON.stringify(value, null, 2) + '```';
            } catch {
                return String(value);
            }
        }
        return String(value);
    }

    _isLongValue(value) {
        if (typeof value === 'object') return true;
        return String(value).length > 30;
    }

    _getLevelColor(level) {
        const colors = {
            error: '#ff0000',
            warn: '#ffa500',
            info: '#36a64f',
            debug: '#0000ff'
        };
        return colors[level?.toLowerCase()] || colors.info;
    }

    async _sendToSlack(message) {
        try {
            const response = await axios.post(this.webhookUrl, message, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });

            if (response.status === 200) {
                console.log(`[SlackLogger] Log sent successfully to Slack`);
            } else {
                console.warn(`[SlackLogger] Unexpected response from Slack: ${response.status}`);
            }
        } catch (error) {
            console.error('[SlackLogger] Failed to send to Slack:', error.message);
            throw error;
        }
    }

    async testConnection() {
        if (!this.enabled) {
            return { ok: false, error: 'Slack logging is disabled' };
        }

        try {
            const response = await axios.post(this.webhookUrl, {
                text: `✅ ${this.username} connection test successful`
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });

            return { ok: response.status === 200 };
        } catch (error) {
            return {
                ok: false,
                error: error.message,
                details: error.response?.data || null
            };
        }
    }
}

// Singleton instance
const slackLogger = new UniversalSlackLogger();

// Express router for direct webhook endpoint
const router = express.Router();
router.post('/log', express.json(), async (req, res) => {
    try {
        await slackLogger.log(req.body.payload || req.body, req.body.options || {});
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = { slackLogger, router };
