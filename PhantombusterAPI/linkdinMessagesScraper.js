const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const inboxScraperAgentId = '7637162051289667';
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'LinkedInInbox';

async function launchInboxScraperAgent(agentId, sessionCookie, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs || {
                sessionCookie: sessionCookie,
                inboxFilter: all,
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

async function getInboxAgentResults(containerId) {
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
        if (error.response && error.response.status === 404) {
            console.log(`No result object found for container ID: ${containerId}`);
            return null;
        }
        console.error('Error getting inbox agent results:', error.message);
        throw error;
    }
}

async function processInboxScrapedData(containerId) {
    const data = await getInboxAgentResults(containerId);
    if (data && data.resultObject && data.resultObject.resultObject) {
        return {
            resultObject: JSON.parse(data.resultObject.resultObject),
            containerOutput: data.containerOutput
        };
    } else {
        console.log(`No data available for container ID: ${containerId}`);
        return null;
    }
}

async function waitForResults() {
    await new Promise(resolve => setTimeout(resolve, 50000)); // 50 seconds wait time
}

async function saveToMongoDB(collectionName, data) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to Database');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const result = await collection.insertMany(Array.isArray(data) ? data : [data]);
        console.log(`Data inserted into ${collectionName}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

async function getAllContainers() {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: {
                agentId: inboxScraperAgentId
            }
        });
        return response.data.containers;
    } catch (error) {
        console.error('Error fetching containers:', error.message);
        throw error;
    }
}

async function findPreviousScrapedInboxData() {
    const containers = await getAllContainers();
    console.log(`Checking ${containers.length} containers for previously scraped inbox data...`);

    if (containers.length === 0) {
        console.log("No previously scraped containers found.");
        return null;
    }

    for (const container of containers) {
        try {
            const data = await processInboxScrapedData(container.id);
            if (data && data.resultObject && data.resultObject.length > 0) {
                console.log(`Found previously scraped inbox data in container ${container.id}`);
                return data;
            }
        } catch (error) {
            console.error(`Error processing container ${container.id}:`, error.message);
        }
    }
    console.log("No previously scraped inbox data found.");
    return null;
}

router.post('/scrapeinbox', async (req, res) => {
    const { sessionCookie } = req.body;
    
    if (!sessionCookie) {
        return res.status(400).json({ error: 'LinkedIn session cookie is required' });
    }

    try {
        console.log('Processing LinkedIn Inbox scraping request');

        // Check for previously scraped data first
        const previousData = await findPreviousScrapedInboxData();
        
        if (previousData) {
            console.log('Returning previously scraped inbox data');
            return res.json({
                inboxData: {
                    resultObject: previousData.resultObject,
                    containerOutput: previousData.containerOutput
                }
            });
        }

        console.log('Launching LinkedIn Inbox scraping agent');
        const containerId = await launchInboxScraperAgent(inboxScraperAgentId, sessionCookie);
        console.log(`Inbox scraping agent launched with container ID ${containerId}`);

        console.log('Waiting for agent to complete...');
        await waitForResults();

        console.log('Fetching agent results');
        const inboxData = await processInboxScrapedData(containerId);
        console.log(inboxData);

        if (!inboxData) {
            console.log("No data scraped. Checking container output...");
            const data = await getInboxAgentResults(containerId);

            if (data && data.containerOutput) {
                if (data.containerOutput.includes("Can't connect to LinkedIn with this session cookie")) {
                    return res.status(400).json({
                        error: "Invalid session cookie. Please provide a valid LinkedIn session cookie."
                    });
                }
                return res.status(500).json({
                    error: "Inbox scraping failed",
                    containerOutput: data.containerOutput
                });
            }
            
            return res.status(404).json({
                error: "No inbox data found"
            });
        }

        console.log('Saving scraped inbox data to MongoDB');
        await saveToMongoDB('LinkedInInboxMessages', {
            resultObject: inboxData.resultObject,
            containerOutput: inboxData.containerOutput,
            timestamp: new Date().toISOString()
        });

        console.log('Sending response');
        res.json({
            inboxData: {
                resultObject: inboxData.resultObject,
                containerOutput: inboxData.containerOutput
            }
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;