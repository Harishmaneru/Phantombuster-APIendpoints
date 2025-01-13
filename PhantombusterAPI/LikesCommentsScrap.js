// const express = require('express');
// const axios = require('axios');
// const { MongoClient } = require('mongodb');

// const router = express.Router();

// const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
// const commentAgentId = '7382122378061727';
// const likesAgentId = '8317656565599206';         
// const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
// const dbName = 'Phantombuster';

// async function launchPhantombusterAgent(agentId, agentArgs) {
//     try {
//         const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
//             id: agentId,
//             argument: agentArgs
//         }, {
//             headers: {
//                 'X-Phantombuster-Key': phantombusterApiKey,
//                 'Content-Type': 'application/json'
//             }
//         });
//         return response.data.containerId;
//     } catch (error) {
//         console.error(`Error launching Phantombuster agent ${agentId}:`, error.message);
//         throw error;
//     }
// }

// async function launchLikesAgent(postUrl, sessionCookie) {
//     if (!sessionCookie) {
//         throw new Error('Session cookie is required for launching likes agent');
//     }
//     const args = {
//         removeDuplicate: true,
//         numberOfPostsPerLaunch: 1,
//         postUrl: postUrl,
//         sessionCookie: sessionCookie,
//         userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
//     };
//     return launchPhantombusterAgent(likesAgentId, args);
// }

// async function launchCommentsAgent(postUrl, sessionCookie) {
//     if (!sessionCookie) {
//         throw new Error('Session cookie is required for launching comments agent');
//     }
//     const args = {
//         numberOfPostsPerLaunch: 1,
//         numberOfCommentsPerPost: 20,
//         postUrl: postUrl,
//         sessionCookie: sessionCookie,
//         userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
//     };
//     return launchPhantombusterAgent(commentAgentId, args);
// }

// async function getAgentResults(containerId) {
//     try {
//         const [resultResponse, outputResponse] = await Promise.all([
//             axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
//                 headers: {
//                     'X-Phantombuster-Key': phantombusterApiKey,
//                     'accept': 'application/json'
//                 },
//                 params: { id: containerId }
//             }),
//             axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output`, {
//                 headers: {
//                     'X-Phantombuster-Key': phantombusterApiKey,
//                     'accept': 'application/json'
//                 },
//                 params: { id: containerId }
//             })
//         ]);

//         return {
//             resultObject: resultResponse.data,
//             containerOutput: outputResponse.data.output
//         };
//     } catch (error) {
//         console.error('Error getting agent results:', error.message);
//         throw error;
//     }
// }

// async function getAllContainers(agentId) {
//     try {
//         const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
//             headers: {
//                 'X-Phantombuster-Key': phantombusterApiKey,
//                 'accept': 'application/json'
//             },
//             params: { agentId }
//         });
//         return response.data.containers;
//     } catch (error) {
//         console.error('Error fetching containers:', error.message);
//         throw error;
//     }
// }

// async function findPreviousScrapedData(agentId, postUrl) {
//     const containers = await getAllContainers(agentId);
//     console.log(`Checking ${containers.length} containers for previously scraped data...`);

//     if (containers.length === 0) {
//         console.log("No containers found or error occurred while fetching containers.");
//         return null;
//     }

//     for (const container of containers) {
//         try {
//             const results = await getAgentResults(container.id);
            
//             if (results.containerOutput && results.containerOutput.includes(postUrl)) {
//                 console.log(`Found previously scraped data in container ${container.id}`);
//                 return results;
//             }
//         } catch (error) {
//             console.error(`Error processing container ${container.id}:`, error.message);
//         }
//     }
//     console.log("No previously scraped data found.");
//     return null;
// }

// async function saveToMongoDB(collectionName, data) {
//     const client = new MongoClient(mongoUri);
//     try {
//         await client.connect();
//         const db = client.db(dbName);
//         const collection = db.collection(collectionName);

//         const result = await collection.insertOne(data);
//         console.log(`Data inserted into ${collectionName}:`, result.insertedId);
//     } catch (error) {
//         console.error(`Error inserting data into ${collectionName}:`, error.message);
//     } finally {
//         await client.close();
//     }
// }

// router.post('/LinkedInlikescomments', async (req, res) => {
//     const { postUrl, sessionCookie } = req.body;
   
//     if (!postUrl || !sessionCookie) {
//         return res.status(400).json({ error: 'Post URL and session cookie are required' });
//     }

//     try {
//         console.log(`Processing request for post URL: ${postUrl}`);

//         const [previousComments, previousLikes] = await Promise.all([
//             findPreviousScrapedData(commentAgentId, postUrl),
//             findPreviousScrapedData(likesAgentId, postUrl)
//         ]);

//         if (previousComments && previousLikes) {
//             console.log('Returning previously scraped data');
//             return res.json({
//                 comments: {
//                     resultObject: previousComments.resultObject,
//                     containerOutput: previousComments.containerOutput
//                 },
//                 likes: {
//                     resultObject: previousLikes.resultObject,
//                     containerOutput: previousLikes.containerOutput
//                 }
//             });
//         }

//         console.log('Launching new agents for scraping');
//         const [commentContainerId, likesContainerId] = await Promise.all([
//             launchCommentsAgent(postUrl, sessionCookie),
//             launchLikesAgent(postUrl, sessionCookie)
//         ]);

//         console.log(`Agents launched: Comments container ID ${commentContainerId}, Likes container ID ${likesContainerId}`);
//         console.log('Waiting for 50 seconds for agents to complete...');
//         await new Promise(resolve => setTimeout(resolve, 50000)); 

//         console.log('Fetching agent results');
//         const [commentResults, likesResults] = await Promise.all([
//             getAgentResults(commentContainerId),
//             getAgentResults(likesContainerId)
//         ]);

//         const combinedResults = {
//             postUrl,
//             comments: {
//                 resultObject: commentResults.resultObject,
//                 containerOutput: commentResults.containerOutput
//             },
//             likes: {
//                 resultObject: likesResults.resultObject,
//                 containerOutput: likesResults.containerOutput
//             },
//             timestamp: new Date().toISOString()
//         };

//         console.log('Saving combined results to MongoDB');
//         await saveToMongoDB('Likes-Comments', combinedResults);

//         console.log('Sending response');
//         res.json({
//             comments: {
//                 resultObject: commentResults.resultObject,
//                 containerOutput: commentResults.containerOutput
//             },
//             likes: {
//                 resultObject: likesResults.resultObject,
//                 containerOutput: likesResults.containerOutput
//             }
//         });
//     } catch (error) {
//         console.error('An error occurred:', error.message);
//         res.status(500).json({ error: 'Internal server error', details: error.message });
//     }
// });

// module.exports = router;


// --------------------------------------------------------------new code--------------------------------------------------------------


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
    console.log('Starting Phantombuster agent launch');
    console.log('Agent ID:', agentId);
    
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
        console.log('Agent launched successfully');
        console.log('Container ID:', response.data.containerId);
        return response.data.containerId;
    } catch (error) {
        console.log('Agent launch failed');
        console.log('Error message:', error.message);
        throw error;
    }
}

async function launchLikesAgent(postUrl, sessionCookie) {
    console.log('Preparing to launch likes agent');
    console.log('Post URL:', postUrl);
    
    if (!sessionCookie) {
        console.log('Launch failed: Missing session cookie');
        throw new Error('Session cookie is required');
    }
    
    const args = {
        removeDuplicate: true,
        numberOfPostsPerLaunch: 1,
        postUrl: postUrl,
        sessionCookie: sessionCookie,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    
    console.log('Launching likes agent with configured arguments');
    return launchPhantombusterAgent(likesAgentId, args);
}

async function launchCommentsAgent(postUrl, sessionCookie) {
    console.log('Preparing to launch comments agent');
    console.log('Post URL:', postUrl);
    
    if (!sessionCookie) {
        console.log('Launch failed: Missing session cookie');
        throw new Error('Session cookie is required for launching comments agent');
    }
    
    const args = {
        numberOfPostsPerLaunch: 1,
        numberOfCommentsPerPost: 20,
        postUrl: postUrl,
        sessionCookie: sessionCookie,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    
    console.log('Launching comments agent with configured arguments');
    return launchPhantombusterAgent(commentAgentId, args);
}

async function checkContainerStatus(containerId) {
    try {
        const response = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output`, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });

        // Check if response and output exist
        if (!response.data || !response.data.output) {
            // console.log('Container output is empty or undefined');
            return {
                status: 'running',
                output: ''
            };
        }

        const output = response.data.output;
        // console.log('Container output received:');

        // Check for session cookie error
        if (output?.includes("Can't connect to LinkedIn with this session cookie")) {
          
            return { 
                status: 'error',
                message: 'Invalid LinkedIn session cookie',
                output
            };
        }

        // Check if process has finished
        if (output?.includes("Process finished successfully")) {
            return {
                status: 'success',
                output
            };
        }

        if (output?.includes("Process finished with an error")) {
            return {
                status: 'error',
                message: 'Scraping process failed',
                output
            };
        }

        return {
            status: 'running',
            output: output || ''
        };
    } catch (error) {
        console.log('Error checking container status:', error.message);
        return {
            status: 'error',
            message: 'Failed to check container status',
            output: '',
            error: error.message
        };
    }
}

async function waitForContainerCompletion(containerId, maxAttempts = 20) {
    // console.log('Waiting for container completion:', containerId);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // console.log(`Attempt ${attempt + 1} of ${maxAttempts}`);
        const result = await checkContainerStatus(containerId);
        
        if (result.status === 'success' || result.status === 'error') {
            // console.log('Container finished with status:', result.status);
            return result;
        }
        
        // console.log('Container still running...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return {
        status: 'error',
        message: 'LinkedIn scraping process is taking longer than expected. This might be due to high server load or network issues. Please try again..',
        output: ''
    };
}

async function getAgentResults(containerId) {
    // console.log('Fetching agent results for container:', containerId);
    try {
        const statusResult = await waitForContainerCompletion(containerId);
        
        if (statusResult.status === 'error') {
            console.log('Container finished with error:', statusResult.message);
            return {
                success: false,
                error: statusResult.message,
                containerOutput: statusResult.output
            };
        }

        // Only fetch result object if scraping was successful
        const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });

        return {
            success: true,
            resultObject: resultResponse.data,
            containerOutput: statusResult.output
        };
    } catch (error) {
        console.log('Failed to fetch agent results');
        console.log('Error message:', error.message);
        return {
            success: false,
            error: error.message,
            containerOutput: ''
        };
    }
}

async function getAgentResults(containerId) {
    // console.log('Fetching agent results for container:', containerId);
    
    try {
        const statusResult = await waitForContainerCompletion(containerId);
        
        if (statusResult.status === 'error') {
            return {
                success: false,
                error: statusResult.message,
                containerOutput: statusResult.output
            };
        }

        // Only fetch result object if scraping was successful
        const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { id: containerId }
        });

        return {
            success: true,
            resultObject: resultResponse.data,
            containerOutput: statusResult.output
        };
    } catch (error) {
        console.log('Failed to fetch agent results');
        console.log('Error message:', error.message);
        throw error;
    }
}

async function getAllContainers(agentId) {
    console.log('Fetching all containers');
    // console.log('Agent ID:', agentId);
    
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'accept': 'application/json'
            },
            params: { agentId }
        });
        console.log('Successfully retrieved containers');
        console.log('Number of containers:', response.data.containers.length);
        return response.data.containers;
    } catch (error) {
        console.log('Failed to fetch containers');
        console.log('Error message:', error.message);
        throw error;
    }
}

async function findPreviousScrapedData(agentId, postUrl) {
    console.log('Searching for previously scraped data');
    // console.log('Agent ID:', agentId);
    // console.log('Post URL:', postUrl);
    
    const containers = await getAllContainers(agentId);
    console.log('Total containers to check:', containers.length);

    if (containers.length === 0) {
        console.log('No containers found');
        return null;
    }

    for (const container of containers) {
        // console.log('Checking container:', container.id);
        try {
            const results = await getAgentResults(container.id);
            
            if (results.containerOutput && results.containerOutput.includes(postUrl)) {
                console.log('Found matching data in container:', container.id);
                return results;
            }
        } catch (error) {
            console.log('Error checking container:', container.id);
            console.log('Error message:', error.message);
        }
    }
    console.log('No matching data found in any container');
    return null;
}

async function saveToMongoDB(collectionName, data) {
    console.log('Starting MongoDB save operation');
    // console.log('Collection name:', collectionName);
    
    const client = new MongoClient(mongoUri);
    try {
        console.log('Connecting to MongoDB');
        await client.connect();
        console.log('Connected successfully');
        
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const result = await collection.insertOne(data);
        console.log('Data saved successfully');
        console.log('Inserted document ID:', result.insertedId);
    } catch (error) {
        console.log('MongoDB save operation failed');
        console.log('Error message:', error.message);
    } finally {
     
        await client.close();
    }
}

router.post('/LinkedInlikescomments', async (req, res) => {
    console.log('Received new request for LinkedIn likes and comments');
    const { postUrl, sessionCookie } = req.body;
   
    if (!postUrl || !sessionCookie) {
        console.log('Request validation failed: Missing required fields');
        return res.status(400).json({ error: 'Post URL and session cookie are required' });
    }

    try {
        console.log('Starting data processing');
        console.log('Post URL:', postUrl);

        console.log('Checking for previously scraped data');
        const [previousComments, previousLikes] = await Promise.all([
            findPreviousScrapedData(commentAgentId, postUrl),
            findPreviousScrapedData(likesAgentId, postUrl)
        ]);

        if (previousComments && previousLikes) {
            console.log('Found existing data for both comments and likes');
            return res.json({
                comments: previousComments,
                likes: previousLikes
            });
        }

        console.log('Starting new data scraping process');
        const [commentContainerId, likesContainerId] = await Promise.all([
            launchCommentsAgent(postUrl, sessionCookie),
            launchLikesAgent(postUrl, sessionCookie)
        ]);

        console.log('Both agents launched successfully');
        console.log('Comments container ID:', commentContainerId);
        console.log('Likes container ID:', likesContainerId);

        const [commentResults, likesResults] = await Promise.all([
            getAgentResults(commentContainerId),
            getAgentResults(likesContainerId)
        ]);

        // Check for errors in either result
        if (!commentResults.success || !likesResults.success) {
            return res.status(400).json({
                error: 'Scraping failed',
                comments: commentResults,
                likes: likesResults
            });
        }

        console.log('Successfully retrieved results from both agents');

        const combinedResults = {
            postUrl,
            comments: commentResults,
            likes: likesResults,
            timestamp: new Date().toISOString()
        };

        console.log('Saving results to database');
        await saveToMongoDB('Likes-Comments', combinedResults);

        console.log('Sending response to client');
        res.json({
            comments: commentResults,
            likes: likesResults
        });
    } catch (error) {
        console.log('Request processing failed');
        console.log('Error message:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;