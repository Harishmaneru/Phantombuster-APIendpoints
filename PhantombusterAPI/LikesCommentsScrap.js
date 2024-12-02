const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const commentAgentId = '7382122378061727';
const likesAgentId = '8317656565599206';         
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

async function launchLikesAgent(postUrl, sessionCookie) {
    if (!sessionCookie) {
        throw new Error('Session cookie is required for launching likes agent');
    }
    const args = {
        removeDuplicate: true,
        numberOfPostsPerLaunch: 1,
        postUrl: postUrl,
        sessionCookie: sessionCookie,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(likesAgentId, args);
}

async function launchCommentsAgent(postUrl, sessionCookie) {
    if (!sessionCookie) {
        throw new Error('Session cookie is required for launching comments agent');
    }
    const args = {
        numberOfPostsPerLaunch: 1,
        numberOfCommentsPerPost: 20,
        postUrl: postUrl,
        sessionCookie: sessionCookie,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    return launchPhantombusterAgent(commentAgentId, args);
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
            const results = await getAgentResults(container.id);
            
            if (results.containerOutput && results.containerOutput.includes(postUrl)) {
                console.log(`Found previously scraped data in container ${container.id}`);
                return results;
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
    const { postUrl, sessionCookie } = req.body;
   
    if (!postUrl || !sessionCookie) {
        return res.status(400).json({ error: 'Post URL and session cookie are required' });
    }

    try {
        console.log(`Processing request for post URL: ${postUrl}`);

        const [previousComments, previousLikes] = await Promise.all([
            findPreviousScrapedData(commentAgentId, postUrl),
            findPreviousScrapedData(likesAgentId, postUrl)
        ]);

        if (previousComments && previousLikes) {
            console.log('Returning previously scraped data');
            return res.json({
                comments: {
                    resultObject: previousComments.resultObject,
                    containerOutput: previousComments.containerOutput
                },
                likes: {
                    resultObject: previousLikes.resultObject,
                    containerOutput: previousLikes.containerOutput
                }
            });
        }

        console.log('Launching new agents for scraping');
        const [commentContainerId, likesContainerId] = await Promise.all([
            launchCommentsAgent(postUrl, sessionCookie),
            launchLikesAgent(postUrl, sessionCookie)
        ]);

        console.log(`Agents launched: Comments container ID ${commentContainerId}, Likes container ID ${likesContainerId}`);
        console.log('Waiting for 50 seconds for agents to complete...');
        await new Promise(resolve => setTimeout(resolve, 50000)); 

        console.log('Fetching agent results');
        const [commentResults, likesResults] = await Promise.all([
            getAgentResults(commentContainerId),
            getAgentResults(likesContainerId)
        ]);

        const combinedResults = {
            postUrl,
            comments: {
                resultObject: commentResults.resultObject,
                containerOutput: commentResults.containerOutput
            },
            likes: {
                resultObject: likesResults.resultObject,
                containerOutput: likesResults.containerOutput
            },
            timestamp: new Date().toISOString()
        };

        console.log('Saving combined results to MongoDB');
        await saveToMongoDB('Likes-Comments', combinedResults);

        console.log('Sending response');
        res.json({
            comments: {
                resultObject: commentResults.resultObject,
                containerOutput: commentResults.containerOutput
            },
            likes: {
                resultObject: likesResults.resultObject,
                containerOutput: likesResults.containerOutput
            }
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;