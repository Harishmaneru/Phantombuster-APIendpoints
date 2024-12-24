const express = require('express');
const axios = require('axios');
const router = express.Router();

const API_URL = 'https://api.trestleiq.com/1.0/phone_feedback';

router.post('/phoneFeedback', async (req, res) => {
  const { response_id, phone, name, phone_status, phone_right_party_contact } = req.body;
  const apiKey = req.headers['x-api-key'];  

  console.log('Request Body:', req.body);

 
  if (!apiKey) {
    console.error('Missing API Key');
    return res.status(400).json({
      error: 'API key is required. Please provide a valid API key in the "x-api-key" header.',
    });
  }

 
  if (!response_id || !phone || !name || !phone_status) {
    console.error('Missing Required Fields');
    return res.status(400).json({
      error: 'response_id, phone, name, and phone_status are required fields.',
    });
  }

  try {
   
    const requestData = {
      response_id,
      phone,
      name,
      phone_status,
      phone_right_party_contact,
    };

    console.log('Sending Data to Trestle API:', requestData);

  
    const response = await axios.post(API_URL, requestData, {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    console.log('API Response:', response.data);

 
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error calling TrestleIQ API:', error.message);

    if (error.response) {
 
      res.status(error.response.status).json({
        error: 'Error from TrestleIQ API.',
        details: error.response.data,
      });
    } else {
      
      res.status(500).json({
        error: 'An internal server error occurred.',
        message: error.message,
      });
    }
  }
});

module.exports = router;
