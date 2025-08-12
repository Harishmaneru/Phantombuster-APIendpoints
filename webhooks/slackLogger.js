const express = require('express');
const axios = require('axios');

class UniversalSlackLogger {
    constructor() {
        // Multiple webhook URLs for different services
        this.webhooks = {
            'domain': process.env.SLACK_DOMAIN_EMAIL_LOGGER_WEBHOOK,
            'onepgr': process.env.SLACK_ONEPGR_LOGGER_WEBHOOK,
            'kampaign': process.env.SLACK_KAMPAIGNAI_LOGGER_WEBHOOK
        };
        
        this.channel = process.env.SLACK_LOG_CHANNEL || '#api-logs';
        this.username = process.env.SLACK_BOT_USERNAME || 'API Logger Bot';
        this.iconEmoji = process.env.SLACK_BOT_ICON || ':robot_face:';
        this.enabled = process.env.SLACK_LOGGING_ENABLED !== 'false';
        
        // Check if any webhooks are configured
        const hasWebhooks = Object.values(this.webhooks).some(url => url);
        if (!hasWebhooks) {
            console.warn('[SlackLogger] No webhook URLs configured. Slack logging disabled.');
            this.enabled = false;
        } else {
            console.log('[SlackLogger] Configured webhooks:', Object.keys(this.webhooks).filter(key => this.webhooks[key]));
        }
    }

    /**
     * Universal log method that accepts any JSON payload and automatically formats it
     * @param {Object} payload - Any JSON structure from your backend services
     * @param {Object} options - { service: string, customTitle?: string, customIcon?: string }
     */
    async log(payload, options = {}) {
        if (!this.enabled) {
            console.log('[SlackLogger] Slack logging disabled, skipping log:', payload);
            return;
        }

        try {
            const slackMessage = this._formatUniversalMessage(payload, options);
            // Pass the service name for proper webhook routing
            const serviceName = options.service || 'domain';
            await this._sendToSlack(slackMessage, serviceName);
        } catch (error) {
            console.error('[SlackLogger] Failed to send log:', error.message);
        }
    }

    /**
     * Send log to the appropriate webhook based on service
     */
    async _sendToSlack(message, service = 'domain') {
        // Determine which webhook to use based on service
        let webhookUrl = this.webhooks.domain; // default
        let selectedService = 'domain';
        
        // Normalize service name for matching
        const serviceLower = (service || '').toLowerCase();
        
        // Check for exact matches first
        if (this.webhooks[serviceLower]) {
            webhookUrl = this.webhooks[serviceLower];
            selectedService = serviceLower;
        }
        // Check for partial matches
        else if (serviceLower.includes('onepgr') && this.webhooks.onepgr) {
            webhookUrl = this.webhooks.onepgr;
            selectedService = 'onepgr';
        }
        else if (serviceLower.includes('kampaign') && this.webhooks.kampaign) {
            webhookUrl = this.webhooks.kampaign;
            selectedService = 'kampaign';
        }
        else if (serviceLower.includes('email') || serviceLower.includes('domain')) {
            webhookUrl = this.webhooks.domain;
            selectedService = 'domain';
        }

        if (!webhookUrl) {
            console.warn(`[SlackLogger] No webhook configured for service: ${service}, using default`);
            webhookUrl = this.webhooks.domain;
            selectedService = 'domain';
        }

        console.log(`[SlackLogger] Routing to ${selectedService} webhook for service: ${service}`);

        try {
            const response = await axios.post(webhookUrl, message, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 5000
            });

            if (response.status === 200) {
                console.log(`[SlackLogger] Log sent successfully to Slack via ${selectedService} webhook`);
            } else {
                console.warn(`[SlackLogger] Unexpected response from Slack: ${response.status}`);
            }
        } catch (error) {
            console.error(`[SlackLogger] Failed to send to Slack via ${service} webhook:`, error.message);
            throw error;
        }
    }

    // ─── Domain/Email Logs ──────────────────────────────────────────
    async logDomainPurchase(domainData) {
        // Use universal formatter for flexible payload handling
        return this.log(domainData, { 
            service: 'domain',
            customTitle: `🛒 Domain Purchase: ${domainData.domainName || 'New Domain'}`,
            customIcon: ':globe_with_meridians:'
        });
    }

    async logEmailCreation(emailData) {
        // Use universal formatter for flexible payload handling
        return this.log(emailData, { 
            service: 'domain',
            customTitle: `📧 Email Created: ${emailData.emailAddress || 'New Email'}`,
            customIcon: ':envelope:'
        });
    }

    // ─── OnePgr Logs ──────────────────────────────────────────────
    async logOnePgrEvent(eventData) {
        // Use universal formatter for flexible payload handling
        return this.log(eventData, { 
            service: 'onepgr',
            customTitle: `🚀 ${eventData.eventType || 'OnePgr Event'}`,
            customIcon: ':rocket:'
        });
    }

    async logOnePgrLead(leadData) {
        // Use universal formatter for flexible payload handling
        return this.log(leadData, { 
            service: 'onepgr',
            customTitle: `🎯 New Lead: ${leadData.name || leadData.leadName || leadData.title || 'Unknown'}`,
            customIcon: ':rocket:'
        });
    }

    // ─── Kampaign.ai Logs ─────────────────────────────────────────
    async logKampaignEvent(campaignData) {
        // Use universal formatter for flexible payload handling
        return this.log(campaignData, { 
            service: 'kampaign',
            customTitle: `📢 Campaign: ${campaignData.campaignName || campaignData.campaignId || campaignData.name || 'New Campaign'}`,
            customIcon: ':megaphone:'
        });
    }

    // ─── Payment Logs ─────────────────────────────────────────────
    async logPaymentEvent(paymentData) {
        // Use universal formatter for flexible payload handling
        return this.log(paymentData, { 
            service: 'domain', // Payments go to domain webhook
            customTitle: `💳 Payment: ${paymentData.type || 'Transaction'}`,
            customIcon: ':credit_card:'
        });
    }

    // ─── Helper Methods ────────────────────────────────────────────
    // All hardcoded formatters removed - now using universal formatter
    // that automatically detects and formats any JSON payload structure

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
        const service = options.service || 'Unknown Service';
        const timestamp = new Date().toISOString();
        
        // SUPER SIMPLE: Just post the raw payload as JSON
        let payloadText;
        try {
            payloadText = JSON.stringify(payload, null, 2);
        } catch (error) {
            // If JSON.stringify fails, just convert to string
            payloadText = String(payload);
        }
        
        const message = {
            channel: this.channel,
            username: `${this.username} [${service}]`,
            icon_emoji: options.customIcon || this.iconEmoji,
            text: `*${options.customTitle || `Event from ${service}`}*\n\`\`\`${payloadText}\`\`\`\n\n*Timestamp:* ${timestamp}`
        };

        return message;
    }

    // These methods are no longer needed with the simple JSON approach

    _getLevelColor(level) {
        const colors = {
            error: '#ff0000',
            warn: '#ffa500',
            info: '#36a64f',
            debug: '#0000ff'
        };
        return colors[level?.toLowerCase()] || colors.info;
    }

    async testConnection() {
        if (!this.enabled) {
            return { ok: false, error: 'Slack logging is disabled' };
        }

        const results = {};
        
        for (const [service, webhookUrl] of Object.entries(this.webhooks)) {
            if (webhookUrl) {
                try {
                    const response = await axios.post(webhookUrl, {
                        text: `✅ ${this.username} [${service}] connection test successful`
                    }, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 5000
                    });

                    results[service] = { ok: response.status === 200 };
                } catch (error) {
                    results[service] = { 
                        ok: false, 
                        error: error.message,
                        details: error.response?.data || null 
                    };
                }
            } else {
                results[service] = { ok: false, error: 'No webhook configured' };
            }
        }

        return results;
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
