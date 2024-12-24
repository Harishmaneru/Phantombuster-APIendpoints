const express = require('express');
const axios = require('axios');
const router = express.Router();

const API_URL = 'https://api.trestleiq.com/3.1/person';

router.post('/findPerson', async (req, res) => {
  const {
    name,
    address_city,
    address_state_code,
    street_line_1,
    address_postal_code,
  } = req.body;

  const apiKey = req.headers['x-api-key'];  

  console.log('Request Body:', req.body);
 
  if (!apiKey) {
    return res.status(400).json({
      error: 'API key is required. Please provide a valid API key in the "x-api-key" header.',
    });
  }

  if (!name) {
    return res.status(400).json({
      error: 'Name is a required field. Please provide the name.',
    });
  }

  try {
    
    const params = new URLSearchParams();
    params.append('name', name);
    if (address_city) params.append('address.city', address_city);
    if (address_state_code) params.append('address.state_code', address_state_code);
    if (street_line_1) params.append('street_line_1', street_line_1);
    if (address_postal_code) params.append('address.postal_code', address_postal_code);

   
    const response = await axios.get(`${API_URL}?${params.toString()}`, {
      headers: {
        'x-api-key': apiKey,
        'accept': 'application/json',
      },
    });

    
    res.status(200).json(response.data);
    console.log('API Response:', response.data);
  } catch (error) {
    console.error('Error calling Trestle API:', error.message);

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
