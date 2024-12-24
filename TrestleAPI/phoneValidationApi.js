const express = require('express');
const axios = require('axios');
const router = express.Router();
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const API_URL = 'https://api.trestleiq.com/3.0/phone_intel';

router.post('/phoneValidation', async (req, res) => {
  const { phone } = req.body;
  const apiKey = req.headers['x-api-key']; 
  console.log('Input Phone:', phone);

 
  if (!apiKey) {
    return res.status(400).json({
      error: 'API key is required. Please provide a valid API key in the "x-api-key" header.',
    });
  }

 
  if (!phone) {
    return res.status(400).json({
      error: 'Phone number is required. Please provide a phone number.',
    });
  }

  try {
 
    let country_hint = null;
    let parsedPhoneNumber = null;

    try {
      parsedPhoneNumber = phoneUtil.parse(phone);
      country_hint = phoneUtil.getRegionCodeForNumber(parsedPhoneNumber);
    } catch (error) {
      if (!phone.startsWith('+')) {
        return res.status(400).json({
          error: 'Invalid phone number format. Please include a country code (e.g., +1 for the US).',
        });
      }
      return res.status(400).json({ error: 'Invalid phone number format.' });
    }

    if (!country_hint) {
      return res.status(400).json({
        error: 'Unable to determine country from the provided phone number.',
      });
    }

 
    const response = await axios.get(
      `${API_URL}?phone=${encodeURIComponent(phone)}&phone.country_hint=${encodeURIComponent(country_hint)}`,
      {
        headers: {
          'x-api-key': apiKey,  
          Accept: 'application/json',
        },
      }
    );

 
    res.status(200).json(response.data);
    console.log('Received Response:', response.data);
  } catch (error) {
    console.error('Error calling TrestleIQ API:', error.message);

    if (error.response) {
 
      res.status(error.response.status).json({
        error: 'Error from external API.',
        details: error.response.data,
      });
    } else {
 
      res.status(500).json({
        error: 'An error occurred while processing the request.',
        message: error.message,
      });
    }
  }
});

module.exports = router;
