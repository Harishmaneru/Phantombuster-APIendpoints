

// require('dotenv').config();
// const express = require('express');
// const axios = require('axios');

// const router = express.Router();
// const ZOHO_BASE_URL = 'https://mail.zoho.com';


// async function getAccessToken() {
//     const params = new URLSearchParams();
//     params.append('refresh_token', process.env.ZOHO_REFRESH_TOKEN);
//     params.append('client_id', process.env.ZOHO_CLIENT_ID);
//     params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
//     params.append('grant_type', 'refresh_token');

//     const r = await axios.post(
//         'https://accounts.zoho.com/oauth/v2/token',
//         params
//     );
//     return r.data.access_token;
// }

// async function createZohoUser(localPart, domain, firstName, lastName, password) {
//     const accessToken = await getAccessToken();
//     const orgId = process.env.ZOHO_ORG_ID;
//     const url = `${ZOHO_BASE_URL}/api/organization/${orgId}/accounts`;
//     const payload = {
//         domain_name: domain,
//         user_name: localPart,
//         password: password,
//         first_name: firstName,
//         last_name: lastName
//     };

//     const res = await axios.post(url, payload, {
//         headers: {
//             'Authorization': `Zoho-oauthtoken ${accessToken}`,
//             'Content-Type': 'application/json'
//         }
//     });

//     return res.data;
// }

// // Route: POST /zoho/user/create
// // Body: { email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith', password: 'Str0ngP@ss!' }
// router.post('/zoho/user/create', async (req, res) => {
//     const { email, firstName, lastName, password } = req.body;
//     if (!email || !firstName || !lastName || !password) {
//         return res.status(400).json({ status: '-1', message: 'email, firstName, lastName, and password are required.' });
//     }

//     const [localPart, domain] = email.split('@');
//     if (!localPart || !domain) {
//         return res.status(400).json({ status: '-1', message: 'Invalid email format.' });
//     }

//     try {
//         const result = await createZohoUser(localPart, domain, firstName, lastName, password);
//         res.json({ status: '1', message: 'Zoho user created.', data: result });
//     } catch (err) {
//         console.error('Zoho create user error:', err.response?.data || err.message);
//         const errorMsg = err.response?.data?.message || err.message;
//         res.status(500).json({ status: '-1', message: errorMsg });
//     }
// });

// module.exports = router;
