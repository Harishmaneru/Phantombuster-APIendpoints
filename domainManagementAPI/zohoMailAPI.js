const express = require('express');
const axios = require('axios');
require('dotenv').config();

const router = express.Router();
// Zoho Mail API base URLs by region:
// Global (default): https://mail.zoho.com/api/organization
// EU: https://mail.zoho.eu/api/organization
// Australia: https://mail.zoho.com.au/api/organization
// China: https://mail.zoho.com.cn/api/organization
// You may need to update this URL based on your Zoho Mail region
const ZOHO_BASE_URL = 'https://mail.zoho.com/api/organization';

class ZohoMailAPI {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    async getAccessToken() {
        console.log('[ZohoMailAPI] Getting access token...');
        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('client_id', process.env.ZOHO_CLIENT_ID);
            params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
            params.append('refresh_token', process.env.ZOHO_REFRESH_TOKEN);

            const { data } = await axios.post(
                'https://accounts.zoho.com/oauth/v2/token',
                params
            );
            
            console.log('[ZohoMailAPI] Access token received.');
            this.accessToken = data.access_token;
            this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
            
            return this.accessToken;
        } catch (error) {
            console.error('[ZohoMailAPI] Failed to get access token', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Zoho');
        }
    }

    async ensureAuthenticated() {
        if (!this.accessToken || Date.now() >= this.tokenExpiry) {
            await this.getAccessToken();
        }
    }

    async createEmailAccount(email, password, displayName, role = 'USER') {
        await this.ensureAuthenticated();

        // Extract domain and username from email
        const [username, domain] = email.split('@');
        if (!domain) {
            throw new Error('Invalid email format. Must contain @ symbol');
        }

        console.log(`[ZohoMailAPI] Creating email account for: ${email}`);
        const url = `${ZOHO_BASE_URL}/${domain}/accounts`;
        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };

        const data = {
            primaryEmailAddress: email,
            password: password,
            displayName: displayName,
            role: role
        };

        console.log('[ZohoMailAPI] Sending request to Zoho', { url, data });
        try {
            const response = await axios.post(url, data, { headers });
            console.log('[ZohoMailAPI] Email account created successfully', response.data);
            return response.data;
        } catch (error) {
            console.error('[ZohoMailAPI] Full error response:', error.response?.data);
            
            // Check for specific error conditions
            if (error.response?.data?.errorCode === 'URL_RULE_NOT_CONFIGURED') {
                const errorMessage = `Domain '${domain}' is not configured in Zoho Mail or the API URL is incorrect. ` +
                    `Verify the domain in Zoho Admin Console and check the API base URL for your region. ` +
                    `You may need to use a region-specific URL like: mail.zoho.eu, mail.zoho.com.au, or mail.zoho.com.cn`;
                console.error('[ZohoMailAPI] Domain configuration error:', errorMessage);
                throw new Error(errorMessage);
            }
            
            if (error.response?.status === 401) {
                console.log('[ZohoMailAPI] Token might be expired, trying to refresh...');
                await this.getAccessToken();
                headers.Authorization = `Bearer ${this.accessToken}`;
                try {
                    const retryResponse = await axios.post(url, data, { headers });
                    return retryResponse.data;
                } catch (retryError) {
                    console.error('[ZohoMailAPI] Retry failed:', retryError.response?.data || retryError.message);
                    throw new Error(`Failed to create email account after token refresh: ${retryError.response?.data?.message || retryError.message}`);
                }
            }
            
            throw new Error(`Failed to create email account: ${error.response?.data?.message || error.message}`);
        }
    }
}

const zohoMailAPI = new ZohoMailAPI();

router.post('/api/email/create', async (req, res) => {
    const { email, password, displayName, role } = req.body;

    if (!email || !password || !displayName) {
        return res.status(400).json({
            status: 'error',
            message: 'email, password, and displayName are required'
        });
    }

    try {
        const result = await zohoMailAPI.createEmailAccount(
            email,
            password,
            displayName,
            role
        );
        res.json({ 
            status: 'success', 
            message: 'Email account created successfully', 
            data: result 
        });
    } catch (error) {
        console.error('Error creating email account:', error.message);
        
        // Handle specific error cases
        let statusCode = 500;
        if (error.message.includes('Domain') && error.message.includes('not configured')) {
            statusCode = 400; // Bad request is more appropriate for configuration issues
        }
        
        res.status(statusCode).json({ 
            status: 'error', 
            message: error.message,
            details: error.response?.data || null
        });
    }
});

module.exports = router;