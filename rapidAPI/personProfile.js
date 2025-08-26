const express = require('express');
const axios = require('axios');
const router = express.Router();

const getLinkedInProfileData = async (profileUrl) => {
    try {
        const apiUrl = 'https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead';

        console.log('Requesting LinkedIn profile data for URL:', profileUrl);

        const response = await axios.get(apiUrl, {
            params: {
                linkedin_url: profileUrl,
                include_skills: true,
                include_certifications: true,
                include_publications: true,
                include_honors: true,
                include_volunteers: true,
                include_projects: true,
                include_patents: true,
                include_courses: true,
                include_organizations: true,
                include_profile_status: true,
                include_company_public_url: true
            },
            headers: {
                'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com',
                'x-rapidapi-key': '9844a765dbmsh2921a4931f5e3acp19930bjsneb132c95f806'
                // 'x-rapidapi-key': '555f39d567mshd3b5b5ed67da326p10603djsnc5e2e27c7423'  //temparary  key
            }
        });

        console.log('Response received:', response.data.message);
        if (Object.keys(response.data).length === 0) {
            return { status: 0, message: 'No data found for the provided profile URL.' };
        }

        return { status: 1, data: response.data };
    } catch (error) {
        console.error('Error fetching LinkedIn profile data:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
            throw new Error(`API Error: ${error.response.data.message || 'Unknown error'}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from the API');
        } else {
            console.error('Error setting up the request:', error.message);
            throw new Error(`Request Setup Error: ${error.message}`);
        }
    }
};

const getProfileData = async (url) => {
    if (!url) {
        return { status: -1, message: 'Profile URL is required to fetch LinkedIn data.' };
    }

    try {
        return await getLinkedInProfileData(url);
    } catch (error) {
        return { status: -1, message: error.message };
    }
};

router.post('/getProfileData', async (req, res) => {
    const { url } = req.query;
    const startTime = Date.now();

    console.log('Received request for LinkedIn profile data', { url });

    const result = await getProfileData(url);
    const responseTime = Date.now() - startTime;

    res.status(result.status === -1 ? 400 : 200).json({
        status: result.status,
        message: result.message,
        data: result.status === 1 ? result.data : null,
        metadata: {
            responseTime,
            timestamp: new Date().toISOString()
        }
    });
});

module.exports = {
    router,
    getProfileData
};
