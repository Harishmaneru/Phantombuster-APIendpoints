require('dotenv').config();
const express = require('express');
const axios = require('axios');
const router = express.Router();

const RAPIDAPI_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const RAPIDAPI_KEY = '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'; //Rajiv Pro plan key
const RAPIDAPI_URL = 'https://fresh-linkedin-profile-data.p.rapidapi.com/get-company-by-linkedinurl';

const fetchCompanyInfo = async (linkedinUrl) => {
  console.log('Input parameters:', { linkedinUrl });

  if (!linkedinUrl) {
    console.log('Error: Missing LinkedIn URL');
    return {
      status: "-1",
      message: "LinkedIn URL is required.",
      data: {}
    };
  }
  try {
    const response = await axios.get(RAPIDAPI_URL, {
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': RAPIDAPI_KEY
      },
      params: {
        linkedin_url: linkedinUrl
      }
    });

    // console.log('API Response:', response.data);  

    // Check if we have a valid response
    if (response.data) {
      // Check for specific error indicators in response
      if (response.data.error) {
        return {
          status: "-1",
          message: response.data.error,
          Company_Profile: {}
        };
      }

      // Check if we have company data
      if (Object.keys(response.data).length > 0) {
        return {
          status: "1",
          message: "Successfully fetched company information.",
          Company_Profile: response.data
        };
      } else {
        return {
          status: "0",
          message: "No company information found.",
          Company_Profile: {}
        };
      }
    } else {
      console.log('Empty response from API');
      return {
        status: "0",
        message: "No company information found.",
        Company_Profile: {}
      };
    }
  } catch (error) {
    console.error('API Request Error:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });

    if (error.response) {
      console.error('API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        Company_Profile: error.response.data
      });

      return {
        status: "-1",
        message: error.response.data.message || error.response.statusText || "Failed to fetch company information",
        error: error.response.data,
        Company_Profile: {}
      };
    }

    return {
      status: "-1",
      message: error.message || "Failed to fetch company information.",
      error: error.message,
      Company_Profile: {}
    };
  }
};

router.post('/getCompanyInfo', async (req, res) => {
  console.log('Received GET request to /getCompanyInfo');
  console.log('Request Query:', req.query);

  const { linkedinUrl } = req.query;

  if (!linkedinUrl) {
    console.log('Bad Request: Missing LinkedIn URL');
    return res.status(400).json({
      status: "-1",
      message: "LinkedIn URL is required.",
      Company_Profile: {}
    });
  }

  try {
    console.log('Processing request for URL:', linkedinUrl);
    const response = await fetchCompanyInfo(linkedinUrl);

    console.log('Sending response:', {
      status: response.status,
      message: response.message,
      dataPresent: !!response.data
    });

    res.send(response);
  } catch (error) {
    console.error('Route Handler Error:', {
      message: error.message,
      stack: error.stack
    });

    res.status(500).json({
      status: "-1",
      message: error.message || "An error occurred while fetching company information.",
      Company_Profile: {},
      error: error.message
    });
  }
});

module.exports = {
  router,
  fetchCompanyInfo
};