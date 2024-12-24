const express = require('express');
const axios = require('axios');
const router = express.Router();

const API_URL = 'https://api.trestleiq.com/1.1/real_contact';

 
router.post('/realContact', async (req, res) => {
  const {
    name,
    business_name,
    phone,
    email,
    ip_address,
    address_street_line_1,
    address_city,
    address_state_code,
    address_postal_code,
    address_country_code,
  } = req.body;

  const apiKey = req.headers['x-api-key'];  

  console.log('Input Data:', req.body);

 
  if (!apiKey) {
    return res.status(400).json({
      error: 'API key is missing. Please include it in the "x-api-key" header.',
    });
  }

  if (!name || !phone) {
    return res.status(400).json({
      error: 'Name and phone are required fields.',
    });
  }

  try {
 
    const params = new URLSearchParams();
    params.append('name', name);
    if (business_name) params.append('business.name', business_name);
    params.append('phone', phone);
    if (email) params.append('email', email);
    if (ip_address) params.append('ip_address', ip_address);
    if (address_street_line_1) params.append('address.street_line_1', address_street_line_1);
    if (address_city) params.append('address.city', address_city);
    if (address_state_code) params.append('address.state_code', address_state_code);
    if (address_postal_code) params.append('address.postal_code', address_postal_code);
    if (address_country_code) params.append('address.country_code', address_country_code);

 
    const response = await axios.get(`${API_URL}?${params.toString()}`, {
      headers: {
        'x-api-key': apiKey,
        'accept': 'application/json',
      },
    });

 
    console.log('Real Contact API Response:', response.data);
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
        error: 'Internal server error.',
        message: error.message,
      });
    }
  }
});

module.exports = router;
