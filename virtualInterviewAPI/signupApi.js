const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const router = express.Router();

// Configure axios with timeout and retry settings
const apiClient = axios.create({
  timeout: 30000, // 30 seconds timeout
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Recorded-Interview-API/1.0'
  }
});

// Retry function for network requests
async function retryRequest(requestFn, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[signup_api] Attempt ${attempt}/${maxRetries} to call OnePGR API`);
      return await requestFn();
    } catch (error) {
      console.error(`[signup_api] Attempt ${attempt} failed:`);
      console.error(`[signup_api] Error code: ${error.code}`);
      console.error(`[signup_api] Error message: ${error.message}`);
      console.error(`[signup_api] Error cause: ${error.cause}`);
      console.error(`[signup_api] Full error:`, JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        address: error.address,
        port: error.port
      }, null, 2));
      
      if (attempt === maxRetries) {
        throw error; // Last attempt failed, throw the error
      }
      
      // Wait before next attempt
      console.log(`[signup_api] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}


router.post('/api/createnewuser', async (req, res) => {
  console.log('[signup_api] POST /api/createnewuser - Request received');
  console.log('[signup_api] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      clientname,
      clientappid,
      clientappkey,
      name,
      password,
      email,
      phone_mobile,
      phone  // Also accept 'phone' as fallback
    } = req.body;

    // Use phone_mobile if provided, otherwise use phone
    const phoneNumber = phone_mobile || phone;

    console.log('[signup_api] Extracted user data:', {
      clientname,
      clientappid,
      clientappkey: clientappkey ? '***masked***' : undefined,
      name,
      password: password ? '***masked***' : undefined,
      email,
      phone_mobile: phoneNumber
    });

    // Validate required fields
    if (!clientname || !clientappid || !clientappkey || !name || !password || !email || !phoneNumber) {
      console.error('[signup_api] Missing required fields');
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['clientname', 'clientappid', 'clientappkey', 'name', 'password', 'email', 'phone_mobile or phone']
      });
    }

    // 1) Build the multipart form
    console.log('[signup_api] Building multipart form data');
    const form = new FormData();
    form.append('clientname',    clientname);
    form.append('clientappid',   clientappid);
    form.append('clientappkey',  clientappkey);
    form.append('name',          name);
    form.append('password',      password);
    form.append('email',         email);
    form.append('phone_mobile',  phoneNumber);

    console.log('[signup_api] Form data prepared with boundary:', form.getBoundary());

    // 2) Send to the legacy OnePGR endpoint with retry logic
    console.log('[signup_api] Preparing to send request to OnePGR API...');
    console.log('[signup_api] Target URL: https://onepgr.com/users/create_api?onepgr_apicall=1&xhr_flag=1');
    
    const requestFn = () => {
      const headers = form.getHeaders();
      console.log('[signup_api] Request headers:', headers);
      
      return apiClient.post(
        'https://onepgr.com/users/create_api?onepgr_apicall=1&xhr_flag=1',
        form,
        {
          headers: headers,
          timeout: 30000 // 30 seconds timeout for this specific request
        }
      );
    };

    const onepgrRes = await retryRequest(requestFn, 3, 2000);

    console.log('[signup_api] OnePGR API response received:', {
      status: onepgrRes.status,
      statusText: onepgrRes.statusText,
      data: onepgrRes.data
    });

    // 3) Proxy back the response
    console.log('[signup_api] Sending successful response to client');
    res
      .status(onepgrRes.status)
      .json(onepgrRes.data);

  } catch (err) {
    console.error('[signup_api] Final error occurred:');
    console.error('[signup_api] Error name:', err.name);
    console.error('[signup_api] Error message:', err.message);
    console.error('[signup_api] Error code:', err.code);
    console.error('[signup_api] Error stack:', err.stack);
    
    // Handle specific network errors
    if (err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH' || err.code === 'ECONNREFUSED') {
      console.error('[signup_api] Network connectivity issue with OnePGR API');
      return res.status(503).json({ 
        error: 'Service temporarily unavailable',
        message: 'Unable to connect to user creation service. Please try again later.',
        code: err.code,
        details: err.message
      });
    }
    
    // If OnePGR responded with an error payload, forward that
    if (err.response) {
      console.error('[signup_api] OnePGR API error response:', {
        status: err.response.status,
        statusText: err.response.statusText,
        data: err.response.data
      });
      
      return res
        .status(err.response.status)
        .json(err.response.data);
    }
    
    // Otherwise it's a local/network error
    console.error('[signup_api] Local/Network error details:', {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    });
    res
      .status(500)
      .json({ 
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing your request.',
        details: err.message
      });
  }
});

module.exports = {
  router
};
