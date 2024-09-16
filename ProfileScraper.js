const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const profileAgentId = '6878586369358734';
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function launchPhantombusterAgent(agentId, profileUrl, sessionCookie, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs || {
                numberOfLinesPerLaunch: 5,
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
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`No result object found for container ID: ${containerId}`);
            return null;
        }
        console.error('Error getting agent results:', error.message);
        throw error;
    }
}

async function processScrapedData(containerId) {
    const result = await getAgentResults(containerId);
    if (result && result.resultObject) {
        return JSON.parse(result.resultObject);
    } else {
        console.log(`No data available for container ID: ${containerId}`);
        return null;
    }
}

async function isAgentComplete(containerId) {
    try {
        const response = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch?id=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            }
        });
        return response.data.status === "finished"; 
    } catch (error) {
        console.error('Error fetching container status:', error.message);
        throw error;
    }
}

async function waitForResults(containerId) {
    const maxRetries = 10;
    let retries = 0;
    let isComplete = false;

    while (!isComplete && retries < maxRetries) {
        retries++;
        console.log(`Checking agent status... attempt ${retries}`);
        isComplete = await isAgentComplete(containerId);

        if (isComplete) {
            console.log("Agent has finished scraping.");
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
    }

    if (!isComplete) {
        console.log('Agent did not finish within the maximum retries.');
    }
}

async function saveToMongoDB(collectionName, data) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to Database');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        console.log('Collection: ', collection.collectionName);
        const result = await collection.insertMany(Array.isArray(data) ? data : [data]);
        console.log(`Data inserted into ${collectionName}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

async function getContainerOutput(containerId) {
    try {
        const response = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            }
        });
        const output = response.data.output;

        const scrapedMessage = output.split('\n').find(line => line.includes("⚠️ We've already scraped this profile.."));

        if (scrapedMessage) {
            console.log(scrapedMessage);
        } 

        return response.data.output;
    } catch (error) {
        console.error(`Error fetching container output for ${containerId}:`, error.message);
        return null;
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
            agentId: profileAgentId
          }
        });
        return response.data.containers;
      } catch (error) {
        console.error('Error fetching containers:', error.message);
        throw error;
      }
}

async function findPreviousScrapedData(profileUrl) {
    const containers = await getAllContainers();
    console.log(`Checking ${containers.length} containers for previously scraped data...`);

    if (containers.length === 0) {
        console.log("No containers found or error occurred while fetching containers.");
        return null;
    }

    for (const container of containers) {
        try {
            const output = await getContainerOutput(container.id);
            if (output && output.includes(profileUrl)) {
                console.log(`Found previously scraped data in container ${container.id}`);
                return await processScrapedData(container.id);
            }
        } catch (error) {
            console.error(`Error processing container ${container.id}:`, error.message);
        }
    }
    console.log("No previously scraped data found.");
    return null;
}

router.post('/LinkedInprofileurl', async (req, res) => {
    const { profileUrl, sessionCookie } = req.body;
    console.log(sessionCookie);
    try {
        console.log(`Launching profile scraping agent for ${profileUrl}`);
        
        const containerId = await launchPhantombusterAgent(profileAgentId, profileUrl, sessionCookie); // Pass sessionCookie
        console.log(`Profile scraping agent launched with container ID ${containerId}`);
        
        await waitForResults(containerId);

        let profileResults = await processScrapedData(containerId);

        if (!profileResults) {
            console.log("No new data scraped. Checking container output...");
            const output = await getContainerOutput(containerId);

            // Check for session cookie error in the output
            if (output && output.includes("Can't connect to LinkedIn with this session cookie")) {
                console.log("Session cookie is invalid. Sending error message to frontend.");
                return res.status(400).json({
                    error: "Can't connect to LinkedIn with this session cookie. Please check and provide a valid session cookie."
                });
            }

            if (output && output.includes("⚠️ We've already scraped this profile")) {
                console.log("Profile URL already scraped. Searching for previous data...");

                profileResults = await findPreviousScrapedData(profileUrl);

                if (profileResults) {
                    console.log("Found previously scraped data.");
                } else {
                    console.log("No previous data found for this profile URL.");
                }
            } else {
                console.log("Unexpected output from container:", output);
                return res.status(500).json({
                    error: `Unexpected output from container: ${output}`
                });
            }
        }

        if (profileResults) {
            await saveToMongoDB('SalesNavigatorProfiles', profileResults);
        } else {
            console.log("No data found for the provided profile URL.");
            return res.status(404).json({
                error: "No data found for the provided profile URL"
            });
        }

        res.json({
            SalesNavigatorProfiles: profileResults || "No data found for the provided profile URL"
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});


module.exports = router;
