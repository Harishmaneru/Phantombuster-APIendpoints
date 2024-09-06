const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const commentAgentId = '5900453882056051';
const likesAgentId = '4118839789269539';
const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function launchPhantombusterAgent(agentId, agentArgs) {
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
    return launchPhantombusterAgent(likesAgentId, args);
}

async function launchCommentsAgent(postUrl) {
    const args = {
        numberOfPostsPerLaunch: 1,
        numberOfCommentsPerPost: 20,
        postUrl: postUrl,
        sessionCookie: "AQEFARABAAAAABE1lMUAAAGRnXXh8gAAAZHCIwDtVgAAs3VybjpsaTplbnRlcnByaXNlQXV0aFRva2VuOmVKeGpaQUFDN3RYMkppQmFaRUVxUDRqbWwrRzl3d2hpUlArV2F3SXpJdDl2UHNUQUNBQ09IQWdkXnVybjpsaTplbnRlcnByaXNlUHJvZmlsZToodXJuOmxpOmVudGVycHJpc2VBY2NvdW50OjE5NTc3MjIxMiwzNDYwNTU5NTEpXnVybjpsaTptZW1iZXI6NjA3NTU1MDA4Y_vDMXQrWKPRIaGks3aMqw2TMs85hYZsWnfYCiDVDpdlHhTqZqHe1AEH_gVGWIS_2u9wkW-DMOzxv5rjo95Fe6KMz7RO9ypbqsoWYE7HSs5G--vKA1Y7mnECpQ7-qZf-x2XvccRi3C1KP7JEZ84J1jJ9GhlxSTtM0UCAKOphMeq-gvSg3tGMK_-FKNEkzuB-pUpVRg",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(commentAgentId, args);
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
        console.error('Error getting agent results:', error.message);
        throw error;
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
        return response.data.output;
    } catch (error) {
        console.error(`Error fetching container output for ${containerId}:`, error.message);
        return null;
    }
}

async function getAllContainers(agentId) {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { agentId }
        });
        return response.data.containers;
    } catch (error) {
        console.error('Error fetching containers:', error.message);
        throw error;
    }
}

async function findPreviousScrapedData(agentId, postUrl) {
    const containers = await getAllContainers(agentId);
    console.log(`Checking ${containers.length} containers for previously scraped data...`);

    if (containers.length === 0) {
        console.log("No containers found or error occurred while fetching containers.");
        return null;
    }

    for (const container of containers) {
        try {
            const output = await getContainerOutput(container.id);
            
           
            if (agentId === likesAgentId && output && output.includes(postUrl)) {
                console.log(`Found previously scraped likes data in container ${container.id}`);
                return await getAgentResults(container.id);
            }

           
            if (agentId === commentAgentId && output && output.includes(postUrl)) {
                console.log(`Found previously scraped comments data in container ${container.id}`);
                return await getAgentResults(container.id);
            }
        } catch (error) {
            console.error(`Error processing container ${container.id}:`, error.message);
        }
    }
    console.log("No previously scraped data found.");
    return null;
}


async function saveToMongoDB(collectionName, data) {
    const client = new MongoClient(mongoUri);
    try {
        await client.connect();
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

router.post('/LinkedInlikescomments', async (req, res) => {
    const { postUrl } = req.body;

    try {
        const [previousComments, previousLikes] = await Promise.all([
            findPreviousScrapedData(commentAgentId, postUrl),
            findPreviousScrapedData(likesAgentId, postUrl)
        ]);

        if (previousComments && previousLikes) {
            return res.json({
                comments: previousComments.resultObject,
                likes: previousLikes.resultObject
            });
        }

        const [commentContainerId, likesContainerId] = await Promise.all([
            launchCommentsAgent(postUrl),
            launchLikesAgent(postUrl)
        ]);

       
        console.log(`Agents launched: Comments container ID ${commentContainerId}\nLikes container ID ${likesContainerId}`);
       await new Promise(resolve => setTimeout(resolve, 50000)); 

        const [commentResults, likesResults] = await Promise.all([
            getAgentResults(commentContainerId),
            getAgentResults(likesContainerId)
        ]);

        // console.log('Comment Results:', JSON.stringify(commentResults, null, 2));
        // console.log('Likes Results:', JSON.stringify(likesResults, null, 2));

        const combinedResults = {
            postUrl,
            comments: commentResults,
            likes: likesResults,
            timestamp: new Date().toISOString([])
        };

        // Save the combined data into the "Results" collection
       // console.log(combinedResults)
        await saveToMongoDB('Likes-Comments', combinedResults);

        res.json({
            Comments: commentResults,
            Likes: likesResults
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;