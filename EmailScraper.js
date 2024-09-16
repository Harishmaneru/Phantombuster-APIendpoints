const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const profileAgentId = '1195272623267090';
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function launchPhantombusterAgent(agentId, querieURL, sessionCookie, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs || {
                numberOfResultsPerSearch: 50,
                numberOfCredits: 10,
                chooseSecondTeam: false,
                sessionCookie: sessionCookie,
               // sessionCookie: "AQEFARABAAAAABE1lMUAAAGRnXXh8gAAAZHCIwDtVgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDN3RYMkppQmFaRUVxUDRqbWwrRzl3d2hpUlArV2F3SXpJdDl2UHNUQUNBQ09IQWdkXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjE5NTc3MjIxMiwzNDYwNTU5NTEpXnVybjpsaTptZW1iZXI6NjA3NTU1MDA4Y_vDMXQrWKPRIaGks3aMqw2TMs85hYZsWnfYCiDVDpdlHhTqZqHe1AEH_gVGWIS_2u9wkW-DMOzxv5rjo95Fe6KMz7RO9ypbqsoWYE7HSs5G--vKA1Y7mnECpQ7-qZf-x2XvccRi3C1KP7JEZ84J1jJ9GhlxSTtM0UCAKOphMeq-gvSg3tGMK_-FKNEkzuB-pUpVRg",
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                queries: querieURL
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

async function getContainerOutput(containerId) {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-output', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });
        return response.data.output;
    } catch (error) {
        console.error(`Error fetching container output for ${containerId}:`, error.message);
        return null;
    }
}

async function getResultObject(containerId) {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });
        return response.data.resultObject;
    } catch (error) {
        console.error(`Error fetching result object for ${containerId}:`, error.message);
        return null;
    }
}

async function saveToMongoDB(collectionName, data) {
    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('Connected to Database');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Save data to MongoDB
        const result = await collection.insertMany(Array.isArray(data) ? data : [data]);
        console.log(`Data inserted into ${collectionName}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

async function waitForResults() {
    await new Promise(resolve => setTimeout(resolve, 50000));
}

router.post('/LinkedInquerieURL', async (req, res) => {
    const { querieURL, sessionCookie } = req.body;

    try {
        console.log(`Launching email scraping agent for ${querieURL}`);
        const containerId = await launchPhantombusterAgent(profileAgentId, querieURL, sessionCookie);
        console.log(`Email scraping agent launched with container ID ${containerId}`);

        await waitForResults();

        const output = await getContainerOutput(containerId);

        if (output) {
            if (output.includes("✅ Data successfully saved!") && output.includes("ℹ️ Leads found:")) {
                try {
                    const resultObject = await getResultObject(containerId);
                    if (resultObject) {
                        let dataToSave;
                        
                        if (typeof resultObject === 'string') {
                            try {
                                dataToSave = JSON.parse(resultObject);
                            } catch (error) {
                                console.error('Error parsing resultObject:', error);
                                return res.status(400).json({ error: 'Invalid data format' });
                            }
                        } else {
                            dataToSave = resultObject;
                        }
                        
                        // Ensure dataToSave is an array
                        if (!Array.isArray(dataToSave)) {
                            dataToSave = [dataToSave];
                        }
            
                        // Add timestamp to each item
                        const dataWithTimestamp = dataToSave.map(item => ({
                            ...item,
                            timestamp: new Date()
                        }));
            
                        // Save data to MongoDB
                        console.log("Saving scraped data to MongoDB...");
                        await saveToMongoDB('ScrapedEmails', dataWithTimestamp);
                        
                        res.json({
                            ScrapedEmails: dataWithTimestamp
                        });
                    } else {
                        console.log("No data found for the provided URL.");
                        res.json({
                            ScrapedEmails: []
                        });
                    }
                } catch (error) {
                    console.error('Error processing or saving data:', error);
                    res.status(500).json({ error: 'Error processing or saving data' });
                }
            } else {
                console.log("Not a valid Sales Navigator People Search Link.");
                res.status(400).json({ error: 'Not a valid Sales Navigator People Search Link' });
            }
        } else {
            console.log("No output available.");
            res.status(404).json({ error: "No data found for this URL" });
        }
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;
