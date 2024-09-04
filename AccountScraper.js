const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
const port = 3000;

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const profileAgentId = '3183235071854652';  
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function launchPhantombusterAgent(agentId, _profileUrl, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs
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

async function launchProfileAgent(profileUrl) {
    const args = {
        numberOfLinesPerLaunch: 5,
        saveImg: false,
        takeScreenshot: false,
        spreadsheetUrl: profileUrl,
        sessionCookie: "AQEFARABAAAAABE1lMUAAAGRnXXh8gAAAZHCIwDtVgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDN3RYMkppQmFaRUVxUDRqbWwrRzl3d2hpUlArV2F3SXpJdDl2UHNUQUNBQ09IQWdkXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjE5NTc3MjIxMiwzNDYwNTU5NTEpXnVybjpsaTptZW1iZXI6NjA3NTU1MDA4Y_vDMXQrWKPRIaGks3aMqw2TMs85hYZsWnfYCiDVDpdlHhTqZqHe1AEH_gVGWIS_2u9wkW-DMOzxv5rjo95Fe6KMz7RO9ypbqsoWYE7HSs5G--vKA1Y7mnECpQ7-qZf-x2XvccRi3C1KP7JEZ84J1jJ9GhlxSTtM0UCAKOphMeq-gvSg3tGMK_-FKNEkzuB-pUpVRg",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(profileAgentId, profileUrl, args);
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

        
        const result = await collection.insertMany(data);
        console.log(`Data inserted into ${collectionName}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

app.use(express.json());

app.post('/scrape-profile', async (req, res) => {
    const { profileUrl } = req.body;

    try {
        const containerId = await launchProfileAgent(profileUrl);

        console.log(`Profile scraping agent launched with container ID ${containerId}`);

        await waitForResults();

        const profileResults = await processScrapedData(containerId);

        // Save results to MongoDB
        if (profileResults) {
            await saveToMongoDB('Profiles', profileResults);
        }

        res.json({
            profile: profileResults
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
