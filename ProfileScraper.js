const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const profileAgentId = '7688980058172742';

const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';
async function checkExistingProfile(profileUrl) {
    try {
        // Fetch all containers for the profile scraping agent
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            params: {
                agentId: profileAgentId
            },
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            }
        });

        const containers = response.data.containers || [];
        const normalizedProfileUrl = profileUrl.toLowerCase().replace(/\/$/, '');

        // Sort containers by date to get the most recent result first
        containers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Iterate over each container and fetch result object
        for (const container of containers) {
            try {
                const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                    params: { id: container.id },
                    headers: {
                        'X-Phantombuster-Key': phantombusterApiKey,
                        'accept': 'application/json'
                    }
                });

                if (resultResponse.data && resultResponse.data.resultObject) {
                    let resultObject;

                    try {
                        resultObject = JSON.parse(resultResponse.data.resultObject);

                        // Handle both array and single object responses
                        if (Array.isArray(resultObject)) {
                            const matchingProfile = resultObject.find(profile =>
                                profile.query &&
                                profile.query.toLowerCase().replace(/\/$/, '') === normalizedProfileUrl
                            );
                            if (matchingProfile) {
                                return {
                                    resultObject: matchingProfile,
                                    containerOutput: resultResponse.data.output
                                };
                            }
                        } else if (resultObject.query &&
                            resultObject.query.toLowerCase().replace(/\/$/, '') === normalizedProfileUrl) {
                            return {
                                resultObject: resultObject,
                                containerOutput: resultResponse.data.output
                            };
                        }
                    } catch (error) {
                        console.error('Error parsing container result:', error);
                    }
                }
            } catch (error) {
                console.error(`Error fetching result for container ${container.id}:`, error.message);
                // Continue to the next container if this one fails
                continue;
            }
        }

        // If no matching profile found, return null
        return null;

    } catch (error) {
        console.error('Error checking existing profile:', error.message);
        throw error;
    }
}


async function launchPhantombusterAgent(agentId, profileUrl, sessionCookie) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
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
        return response.data.containerId;
    } catch (error) {
        console.error(`Error launching Phantombuster agent ${agentId}:`, error.message);
        throw error;
    }
}

async function getAgentResults(containerId) {
    try {
        const [resultResponse, outputResponse] = await Promise.all([
            axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                headers: {
                    'X-Phantombuster-Key': phantombusterApiKey,
                    'accept': 'application/json'
                },
                params: { id: containerId }
            }),
            axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output`, {
                headers: {
                    'X-Phantombuster-Key': phantombusterApiKey,
                    'accept': 'application/json'
                },
                params: { id: containerId }
            })
        ]);

        return {
            resultObject: resultResponse.data,
            containerOutput: outputResponse.data.output
        };
    } catch (error) {
        console.error('Error getting agent results:', error.message);
        throw error;
    }
}

async function waitForResults() {
    await new Promise(resolve => setTimeout(resolve, 50000));
}

async function saveToMongoDB(collectionName, data) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to Database');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const result = await collection.insertOne(data);
        console.log(`Data inserted into ${collectionName}:`, result.insertedId);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

async function processScrapedData(containerId, requestedProfileUrl) {
    const data = await getAgentResults(containerId);
    if (data && data.resultObject && data.resultObject.resultObject) {
        let resultObject;
        try {
            resultObject = JSON.parse(data.resultObject.resultObject);
        } catch (parseError) {
            console.error('Error parsing result object JSON:', parseError);
            return null;
        }

        if (Array.isArray(resultObject)) {
            const normalizedRequestedUrl = requestedProfileUrl.toLowerCase().replace(/\/$/, '');

            for (let i = resultObject.length - 1; i >= 0; i--) {
                const profile = resultObject[i];
                if (profile.query) {
                    const normalizedQueryUrl = profile.query.toLowerCase().replace(/\/$/, '');
                    if (normalizedQueryUrl === normalizedRequestedUrl) {
                        console.log('Found matching profile');
                        return {
                            resultObject: profile,
                            containerOutput: data.containerOutput
                        };
                    }
                }
            }
            console.log('No matching profile found in results');
            return null;
        } else if (resultObject.query &&
            resultObject.query.toLowerCase().replace(/\/$/, '') ===
            requestedProfileUrl.toLowerCase().replace(/\/$/, '')) {
            return {
                resultObject: resultObject,
                containerOutput: data.containerOutput
            };
        }

        console.log('No matching profile found');
        return null;
    } else {
        console.log(`No data available for container ID: ${containerId}`);
        return null;
    }
}

router.post('/LinkedInprofileurl', async (req, res) => {
    const { profileUrl, sessionCookie } = req.body;

    if (!profileUrl || !sessionCookie) {
        return res.status(400).json({ error: 'Profile URL and session cookie are required' });
    }

    try {
        console.log(`Processing request for profile URL: ${profileUrl}`);

        // First, check if we already have this profile in existing containers
        console.log('Checking for existing profile data...');
        const existingProfile = await checkExistingProfile(profileUrl);

        if (existingProfile) {
            console.log('Found existing profile data');

            // Save to MongoDB with current timestamp
            await saveToMongoDB('LinkedInProfiles', {
                ...existingProfile,
                timestamp: new Date().toISOString()
            });

            return res.json({
                profile: existingProfile.resultObject,
                cached: true
            });
        }

        // If no existing profile found, proceed with scraping
        console.log('No existing profile found. Launching profile scraping agent');
        const containerId = await launchPhantombusterAgent(profileAgentId, profileUrl, sessionCookie);
        console.log(`Profile scraping agent launched with container ID ${containerId}`);

        console.log('Waiting for agent to complete...');
        await waitForResults();

        // Process scraped data for the requested profile URL
        console.log('Processing scraped data...');
        const scrapedProfile = await processScrapedData(containerId, profileUrl);

        if (!scrapedProfile) {
            return res.status(500).json({
                error: "Scraping failed or profile not found",
                containerOutput: `No matching profile found for container ID: ${containerId}`
            });
        }

        console.log('Saving scraped data to MongoDB');
        await saveToMongoDB('LinkedInProfiles', {
            ...scrapedProfile,
            timestamp: new Date().toISOString()
        });

        console.log('Sending response');
        res.json({
            profile: scrapedProfile.resultObject,
            cached: false
        });

    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;