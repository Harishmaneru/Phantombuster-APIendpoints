//new code
const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const profileAgentId = '7688980058172742';
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function checkExistingProfile(profileUrl) {
    console.log('Fetching recent containers...');
    try {
        const containersResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            params: { agentId: profileAgentId },
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            }
        });

        const containers = containersResponse.data.containers || [];
        console.log(`Found ${containers.length} containers to check`);

        containers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const normalizedProfileUrl = profileUrl.toLowerCase().replace(/\/$/, '');

        for (const container of containers.slice(0, 5)) {
            console.log(`Checking container: ${container.id}`);
            try {
                const [resultResponse, outputResponse] = await Promise.all([
                    axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                        params: { id: container.id },
                        headers: {
                            'X-Phantombuster-Key': phantombusterApiKey,
                            'accept': 'application/json'
                        }
                    }),
                    axios.get('https://api.phantombuster.com/api/v2/containers/fetch-output', {
                        params: { id: container.id },
                        headers: {
                            'X-Phantombuster-Key': phantombusterApiKey,
                            'accept': 'application/json'
                        }
                    })
                ]);

                if (resultResponse.data?.resultObject) {
                    const matchedProfile = await processProfileData(
                        resultResponse.data.resultObject,
                        outputResponse.data.output,
                        normalizedProfileUrl
                    );
                    if (matchedProfile) return matchedProfile;
                }
            } catch (error) {
                console.error(`Error checking container ${container.id}:`, error.message);
                continue;
            }
        }
        console.log('No matching profile found in recent containers');
        return null;
    } catch (error) {
        console.error('Error fetching containers:', error.message);
        return null;
    }
}

async function checkContainerOutput(containerId) {
    try {
        console.log('Checking container output...');
        const outputResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-output', {
            params: { id: containerId },
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            }
        });

        const output = outputResponse.data.output || '';
        console.log('Received output:', output);

        // Check for session cookie error first
        if (output.includes('Session cookie not valid anymore') || 
            output.includes("Can't connect to LinkedIn with this session cookie")) {
            console.log('⚠️ Invalid session cookie detected');
            throw new Error('SESSION_INVALID');
        }

        // Check for successful completion
        if (output.includes('✅ Data successfully saved') && 
            output.includes('Process finished successfully')) {
            console.log('✅ Scraping completed successfully');
            return { status: 'SUCCESS' };
        }

        // Check for process failure
        if (output.includes('Process finished with an error')) {
            console.log(' Process finished with error');
            throw new Error('SCRAPING_FAILED');
        }

        // Still in progress
        console.log(' Scraping still in progress');
        return { status: 'IN_PROGRESS' };
    } catch (error) {
        if (error.message === 'SESSION_INVALID' || 
            error.message === 'SCRAPING_FAILED') {
            throw error;
        }
        console.error('Error checking container output:', error);
        throw new Error('OUTPUT_CHECK_FAILED');
    }
}

async function waitForScrapingCompletion(containerId) {
    console.log('Starting scraping completion check...');
    const startTime = Date.now();
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes maximum wait time
    const checkInterval = 5000; // 5 seconds between checks

    while (Date.now() - startTime < maxWaitTime) {
        try {
            const result = await checkContainerOutput(containerId);

            if (result.status === 'SUCCESS') {
                console.log(' Scraping completed successfully, fetching results...');
                
                const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                    params: { id: containerId },
                    headers: {
                        'X-Phantombuster-Key': phantombusterApiKey,
                        'accept': 'application/json'
                    }
                });

                if (resultResponse.data?.resultObject) {
                    return resultResponse.data;
                } else {
                    throw new Error('NO_RESULT_DATA');
                }
            }

            // Wait before next check only if we're still in progress
            await new Promise(resolve => setTimeout(resolve, checkInterval));

        } catch (error) {
            switch (error.message) {
                case 'SESSION_INVALID':
                    console.error(' Session cookie is invalid, stopping process');
                    throw new Error('Invalid session cookie. Please log in to LinkedIn to get a new one.');
                    
                case 'SCRAPING_FAILED':
                    console.error(' Scraping process failed');
                    throw new Error('Profile scraping failed. Please try again later.');
                    
                case 'NO_RESULT_DATA':
                    console.error(' No result data available');
                    throw new Error('Failed to retrieve profile data after successful scrape.');
                    
                case 'OUTPUT_CHECK_FAILED':
                    console.error('Failed to check container output');
                    // Continue checking if it's just a temporary error
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    break;
                    
                default:
                    console.error('Unexpected error:', error.message);
                    throw error;
            }
        }
    }
    
    throw new Error('Timeout: Profile scraping took too long to complete.');
}

async function launchPhantombusterAgent(profileUrl, sessionCookie) {
    console.log('Launching new profile scrape...');
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: profileAgentId,
            argument: {
                numberOfLinesPerLaunch: 1,
                saveImg: false,
                takeScreenshot: false,
                spreadsheetUrl: profileUrl,
                sessionCookie: sessionCookie,
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            }
        }, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'Content-Type': 'application/json'
            }
        });
        console.log('Agent launched successfully:', response.data.containerId);
        return response.data.containerId;
    } catch (error) {
        console.error('Error launching agent:', error.message);
        throw error;
    }
}

async function processProfileData(resultObject, containerOutput, normalizedProfileUrl) {
    try {
        const parsedResult = JSON.parse(resultObject);
        
        if (Array.isArray(parsedResult)) {
            const matchingProfile = parsedResult.find(profile =>
                profile.query?.toLowerCase().replace(/\/$/, '') === normalizedProfileUrl
            );
            if (matchingProfile) {
                console.log('Found matching profile in array');
                return { resultObject: matchingProfile, containerOutput };
            }
        } else if (parsedResult.query?.toLowerCase().replace(/\/$/, '') === normalizedProfileUrl) {
            console.log('Found matching single profile');
            return { resultObject: parsedResult, containerOutput };
        }
        return null;
    } catch (error) {
        console.error('Error processing profile data:', error.message);
        return null;
    }
}

async function saveToMongoDB(data) {
    console.log('Saving profile to MongoDB...');
    const client = new MongoClient(mongoUri);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection('LinkedInProfiles');
        const result = await collection.insertOne({
            ...data,
            timestamp: new Date().toISOString()
        });
        console.log('Profile saved successfully:', result.insertedId);
    } catch (error) {
        console.error('MongoDB save error:', error.message);
    } finally {
        await client.close();
    }
}

router.post('/LinkedInprofileurl', async (req, res) => {
    console.log('Received new profile request');
    const { profileUrl, sessionCookie } = req.body;

    if (!profileUrl || !sessionCookie) {
        console.log('Missing required parameters');
        return res.status(400).json({ error: 'Profile URL and session cookie are required' });
    }

    try {
        const existingProfile = await checkExistingProfile(profileUrl);

        if (existingProfile) {
            console.log('Using existing profile data');
            await saveToMongoDB(existingProfile);
            return res.json({
                profile: existingProfile.resultObject,
                cached: true
            });
        }

        console.log('No existing profile found, launching new scrape');
        const containerId = await launchPhantombusterAgent(profileUrl, sessionCookie);
        
        console.log('Waiting for profile data...');
        const scrapedData = await waitForScrapingCompletion(containerId);
        
        if (!scrapedData) {
            throw new Error('Failed to get profile data');
        }

        const normalizedProfileUrl = profileUrl.toLowerCase().replace(/\/$/, '');
        const processedProfile = await processProfileData(
            scrapedData.resultObject,
            scrapedData.output,
            normalizedProfileUrl
        );

        if (!processedProfile) {
            throw new Error('Failed to process profile data');
        }

        console.log('Successfully retrieved new profile');
        await saveToMongoDB(processedProfile);

        res.json({
            profile: processedProfile.resultObject,
            cached: false
        });

    } catch (error) {
        console.error('Request processing error:', error.message);
        if (error.message.includes('Invalid session cookie')) {
            return res.status(401).json({
                error: 'Session cookie is invalid',
                details: 'Please log in to LinkedIn to get a new session cookie'
            });
        }
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message
        });
    }
});

module.exports = router;