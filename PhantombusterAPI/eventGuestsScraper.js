const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const eventGuestsExportAgentId = '6971819843380010';  // LinkedIn Event Guests Export agent ID

const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function findExistingEventData(eventUrl) {
    try {
        // Fetch all containers for this agent
        const containersResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: {
                agentId: eventGuestsExportAgentId
            }
        });

        const containers = containersResponse.data.containers;
        console.log(`Checking ${containers.length} containers for matching event URL...`);

        // Iterate through containers to find a match
        for (const container of containers) {
            try {
                // Fetch result object for each container
                const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                    headers: {
                        'X-Phantombuster-Key': phantombusterApiKey,
                        'accept': 'application/json'
                    },
                    params: { id: container.id }
                });

                // Parse the result object
                const resultObject = resultResponse.data.resultObject 
                    ? JSON.parse(resultResponse.data.resultObject) 
                    : null;

                // Check if any result in the object matches the event URL
                if (resultObject) {
                    const matchingResult = resultObject.find(result => 
                        result.query && result.query.includes(eventUrl)
                    );

                    if (matchingResult) {
                        console.log(`Existing data found for event URL in container ${container.id}`);
                        return {
                            resultObject,
                            containerId: container.id
                        };
                    }
                }
            } catch (resultError) {
                console.error(`Error processing container ${container.id}:`, resultError.message);
            }
        }

        console.log("No existing data found for the event URL.");
        return null;
    } catch (error) {
        console.error('Error finding existing event data:', error.message);
        throw error;
    }
}

async function launchEventGuestsExportAgent(agentId, eventUrl, sessionCookie) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: {
                numberOfLinesPerLaunch: 10,
                sessionCookie: sessionCookie,
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                queries: eventUrl,
                numberOfResultsPerLaunch: 100
            }
        }, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'Content-Type': 'application/json'
            }
        });
        return response.data.containerId;
    } catch (error) {
        console.error(`Error launching LinkedIn Event Guests Export agent ${agentId}:`, error.message);
        throw error;
    }
}

async function processEventGuestsExportData(containerId) {
    const MAX_RETRIES = 10; // Number of times to retry
    const RETRY_INTERVAL = 10000; // Wait time between retries in ms

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`Attempt ${attempt} to fetch data for container ID ${containerId}...`);

            const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                headers: {
                    'X-Phantombuster-Key': phantombusterApiKey,
                    'accept': 'application/json'
                },
                params: { id: containerId }
            });

            const containerOutputResponse = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`, {
                headers: {
                    'X-Phantombuster-Key': phantombusterApiKey,
                    'accept': 'application/json'
                }
            });

            if (resultResponse.data.resultObject) {
                console.log('Data found, processing...');
                return {
                    resultObject: JSON.parse(resultResponse.data.resultObject),
                    containerOutput: {
                        output: containerOutputResponse.data.output,
                        alreadyScrapedMessage: containerOutputResponse.data.output.split('\n').find(line => 
                            line.includes("This event has already been processed")
                        )
                    }
                };
            } else {
                console.log('No data available yet, retrying...');
            }
        } catch (error) {
            console.error(`Error on attempt ${attempt}:`, error.message);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }

    throw new Error(`Data not available after ${MAX_RETRIES} attempts for container ID ${containerId}`);
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

router.post('/EventGuestsScrap', async (req, res) => {
    const { eventUrl, sessionCookie } = req.body;
    
    try {
        // First, check for existing data
        const existingData = await findExistingEventData(eventUrl);
        
        let exportData;
        if (existingData) {
            console.log('Using existing data from previous container');
            exportData = {
                resultObject: existingData.resultObject,
                containerOutput: null
            };
        } else {
            // If no existing data, launch a new agent
            console.log(`Launching event guests export agent for ${eventUrl}`);
            const containerId = await launchEventGuestsExportAgent(eventGuestsExportAgentId, eventUrl, sessionCookie);
            console.log(`Event guests export agent launched with container ID ${containerId}`);

            // Wait a bit for the agent to process
            await new Promise(resolve => setTimeout(resolve, 50000));

            // Process the new export data
            exportData = await processEventGuestsExportData(containerId);
        }

        // Save data to MongoDB if result object exists
        if (exportData && exportData.resultObject) {
            console.log("Saving exported data to MongoDB...");
            await saveToMongoDB('EventGuests', exportData.resultObject);
            console.log("Data saved successfully.");
        } else {
            console.log("No data found for the provided event URL.");
        }

        res.json({
            guests: exportData?.resultObject || null,
            containerOutput: exportData?.containerOutput || null
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;