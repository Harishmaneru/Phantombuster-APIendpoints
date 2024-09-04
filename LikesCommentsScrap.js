const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const fs = require('fs');  
const https = require('https');  
const http = require('http');  
const cors = require('cors');  

const app = express();
const port = 3000;

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const commentAgentId = '3764598866836521';  // Comments scraper agent ID
const likesAgentId = '7246285351294436';    // Likes scraper agent ID
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

 
app.use(cors());
app.use(express.json());

async function launchPhantombusterAgent(agentId, postUrl, agentArgs) {
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

async function launchLikesAgent(postUrl) {
    const args = {
        removeDuplicate: true,
        numberOfPostsPerLaunch: 1,
        postUrl: postUrl,
        sessionCookie: "AQEFARABAAAAABE1lMUAAAGRnXXh8gAAAZHCIwDtVgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDN3RYMkppQmFaRUVxUDRqbWwrRzl3d2hpUlArV2F3SXpJdDl2UHNUQUNBQ09IQWdkXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjE5NTc3MjIxMiwzNDYwNTU5NTEpXnVybjpsaTptZW1iZXI6NjA3NTU1MDA4Y_vDMXQrWKPRIaGks3aMqw2TMs85hYZsWnfYCiDVDpdlHhTqZqHe1AEH_gVGWIS_2u9wkW-DMOzxv5rjo95Fe6KMz7RO9ypbqsoWYE7HSs5G--vKA1Y7mnECpQ7-qZf-x2XvccRi3C1KP7JEZ84J1jJ9GhlxSTtM0UCAKOphMeq-gvSg3tGMK_-FKNEkzuB-pUpVRg",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(likesAgentId, postUrl, args);
}

async function launchCommentsAgent(postUrl) {
    const args = {
        numberOfPostsPerLaunch: 1,
        numberOfCommentsPerPost: 20,
        postUrl: postUrl,
        sessionCookie: "AQEFARABAAAAABE1lMUAAAGRnXXh8gAAAZHCIwDtVgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDN3RYMkppQmFaRUVxUDRqbWwrRzl3d2hpUlArV2F3SXpJdDl2UHNUQUNBQ09IQWdkXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjE5NTc3MjIxMiwzNDYwNTU5NTEpXnVybjpsaTptZW1iZXI6NjA3NTU1MDA4Y_vDMXQrWKPRIaGks3aMqw2TMs85hYZsWnfYCiDVDpdlHhTqZqHe1AEH_gVGWIS_2u9wkW-DMOzxv5rjo95Fe6KMz7RO9ypbqsoWYE7HSs5G--vKA1Y7mnECpQ7-qZf-x2XvccRi3C1KP7JEZ84J1jJ9GhlxSTtM0UCAKOphMeq-gvSg3tGMK_-FKNEkzuB-pUpVRg",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(commentAgentId, postUrl, args);
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

        // Insert the data into the collection
        const result = await collection.insertMany(data);
        console.log(`Data inserted into ${collectionName}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${collectionName}:`, error.message);
    } finally {
        await client.close();
    }
}

app.post('/LinkedInlikescomments', async (req, res) => {
    const { postUrl } = req.body;

    try {
        const [commentContainerId, likesContainerId] = await Promise.all([
            launchCommentsAgent(postUrl),
            launchLikesAgent(postUrl)
        ]);

        console.log(`Agents launched: Comments container ID ${commentContainerId}, Likes container ID ${likesContainerId}`);

        await waitForResults();

        const [commentResults, likesResults] = await Promise.all([
            processScrapedData(commentContainerId),
            processScrapedData(likesContainerId)
        ]);

        // Save results to MongoDB
        if (commentResults) {
            await saveToMongoDB('Comments', commentResults);
        }
        if (likesResults) {
            await saveToMongoDB('Likes', likesResults);
        }

        res.json({
            comments: commentResults,
            likes: likesResults
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const options = {
    key: fs.readFileSync('./onepgr.com.key', 'utf8'),
    cert: fs.readFileSync('./STAR_onepgr_com.crt', 'utf8'),
    ca: fs.readFileSync('./STAR_onepgr_com.ca-bundle', 'utf8')
};

const likesCommentsScraperServer = https.createServer(options, app);

likesCommentsScraperServer.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});
