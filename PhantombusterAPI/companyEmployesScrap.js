const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

// Configuration Constants
const CONFIG = {
    PHANTOMBUSTER: {
        API_KEY: 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c',
        AGENT_ID: '6132479558213522'
    },
    MONGODB: {
        URI: 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true',
        DB_NAME: 'Phantombuster',
        COLLECTION_NAME: 'CompanyEmployees'
    },
    POLLING: {
        MAX_ATTEMPTS: 10,
        BASE_WAIT_TIME: 1000 // 1 second base wait time
    }
};


async function getAllContainers() {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-all', {
            headers: {
                'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
                'accept': 'application/json'
            },
            params: {
                agentId: CONFIG.PHANTOMBUSTER.AGENT_ID
            }
        });
        return response.data.containers || [];
    } catch (error) {
        console.error('Error fetching containers:', error.message);
        throw error;
    }
}


async function processEmployeesExportData(containerId) {
    try {
        const [resultData, outputData] = await Promise.all([
            getEmployeesExportResults(containerId),
            getContainerOutput(containerId)
        ]);

        return {
            resultObject: resultData && resultData.resultObject 
                ? JSON.parse(resultData.resultObject) 
                : null,
            containerOutput: outputData
        };
    } catch (error) {
        console.error(`Error processing export data for container ${containerId}:`, error.message);
        throw error;
    }
}


async function getEmployeesExportResults(containerId) {
    try {
        const response = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
            headers: {
                'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
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


async function getContainerOutput(containerId) {
    try {
        const response = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
                'accept': 'application/json'
            }
        });
        return {
            output: response.data.output,
            alreadyScrapedMessage: response.data.output.split('\n').find(line => 
                line.includes("⚠️ The provided company list is already scraped.")
            )
        };
    } catch (error) {
        console.error(`Error fetching container output for ${containerId}:`, error.message);
        return null;
    }
}


async function launchEmployeesExportAgent(agentId, companyUrl, sessionCookie, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs || {
                numberOfResultsPerCompany: 100,
                numberOfCompaniesPerLaunch: 1,
                spreadsheetUrl: companyUrl,
                sessionCookie: sessionCookie,
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            }
        }, {
            headers: {
                'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
                'Content-Type': 'application/json'
            }
        });
        return response.data.containerId;
    } catch (error) {
        console.error(`Error launching LinkedIn Company Employees Export agent ${agentId}:`, error.message);
        throw error;
    }
}

/**
 * Check if the company URL has been previously scraped
 * @param {string} companyUrl - Company URL to check
 * @returns {Promise<Array|null>} Previously scraped data or null
 */
async function checkPreviousScrapedData(companyUrl) {
    try {
        const containers = await getAllContainers();
        console.log(`Checking ${containers.length} containers for previously scraped data...`);

        for (const container of containers) {
            const data = await processEmployeesExportData(container.id);
            
            // Check if the container output contains the company URL and has a result object
            if (data.containerOutput && 
                data.containerOutput.output.includes(companyUrl) && 
                data.resultObject) {
                console.log(`Found previously scraped data for ${companyUrl}`);
                return data.resultObject;
            }
        }
        
        console.log("No previously scraped data found.");
        return null;
    } catch (error) {
        console.error('Error checking previous scraped data:', error.message);
        throw error;
    }
}

/**
 * Check if data already exists in MongoDB
 * @param {string} companyUrl - Company URL to check
 * @returns {Promise<boolean>} Whether data exists in database
 */
async function checkDataInDatabase(companyUrl) {
    const client = new MongoClient(CONFIG.MONGODB.URI);

    try {
        await client.connect();
        const db = client.db(CONFIG.MONGODB.DB_NAME);
        const collection = db.collection(CONFIG.MONGODB.COLLECTION_NAME);

        // Check if any document contains the company URL
        const existingData = await collection.findOne({ 
            $or: [
                { companyUrl: companyUrl },
                { 'companyUrls': { $in: [companyUrl] } }
            ]
        });

        return !!existingData;
    } catch (error) {
        console.error('Error checking data in database:', error.message);
        throw error;
    } finally {
        await client.close();
    }
}

/**
 * Save scraped data to MongoDB
 * @param {Array} data - Data to save
 * @param {string} companyUrl - Company URL associated with the data
 */
async function saveToMongoDB(data, companyUrl) {
    const client = new MongoClient(CONFIG.MONGODB.URI);

    try {
        // Check if data already exists in database before saving
        const dataExists = await checkDataInDatabase(companyUrl);
        
        if (dataExists) {
            console.log(`Data for ${companyUrl} already exists in database. Skipping insertion.`);
            return;
        }

        await client.connect();
        console.log('Connected to Database');
        const db = client.db(CONFIG.MONGODB.DB_NAME);
        const collection = db.collection(CONFIG.MONGODB.COLLECTION_NAME);

        // Add company URL to the data for tracking
        const dataWithUrl = Array.isArray(data) ? 
            data.map(item => ({ ...item, companyUrl })) : 
            { ...data, companyUrl };

        const result = await collection.insertMany(Array.isArray(dataWithUrl) ? dataWithUrl : [dataWithUrl]);
        console.log(`Data inserted into ${CONFIG.MONGODB.COLLECTION_NAME}:`, result.insertedIds);
    } catch (error) {
        console.error(`Error inserting data into ${CONFIG.MONGODB.COLLECTION_NAME}:`, error.message);
    } finally {
        await client.close();
    }
}

async function pollForResults(containerId, maxDuration = 5 * 60 * 1000, interval = 3000) {
    const startTime = Date.now();

    // Wrap the polling logic in a retry function to handle potential null responses
    const checkResults = async () => {
        try {
            // Safely fetch container output with null check
            const outputResponse = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`, {
                headers: {
                    'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
                    'accept': 'application/json'
                }
            });

            // Safe output processing
            const output = outputResponse?.data?.output || '';

            // Check if output indicates already scraped or contains an error
            if (output.includes("⚠️ The provided company list is already scraped")) {
                console.log('Company URL already scraped. Stopping polling.');
                return null;
            }

            // Fetch results object
            const resultResponse = await axios.get('https://api.phantombuster.com/api/v2/containers/fetch-result-object', {
                headers: {
                    'X-Phantombuster-Key': CONFIG.PHANTOMBUSTER.API_KEY,
                    'accept': 'application/json'
                },
                params: { id: containerId }
            });

            // Check if result object exists and can be parsed
            if (resultResponse?.data?.resultObject) {
                try {
                    const parsedResults = JSON.parse(resultResponse.data.resultObject);
                    return {
                        resultObject: parsedResults,
                        containerOutput: { output }
                    };
                } catch (parseError) {
                    console.error('Error parsing result object:', parseError);
                }
            }

            return null;
        } catch (error) {
            // Log specific error details for debugging
            console.error('Error in polling iteration:', error.message);
            return null;
        }
    };

    // Continuous polling loop
    while (Date.now() - startTime < maxDuration) {
        const result = await checkResults();
        
        // If results found, return immediately
        if (result) {
            return result;
        }

        // Wait for next polling interval
        await new Promise(resolve => setTimeout(resolve, interval));
    }

    // Timeout reached
    console.log('Maximum polling duration exceeded');
    return null;
}
/**
 * Route handler for company employees scraping
 */
router.post('/CompanyEmployeesScrap', async (req, res) => {
    const { companyUrl, sessionCookie } = req.body;

    try {
        // First, check if data is already scraped in previous containers
        const previousScrapedData = await checkPreviousScrapedData(companyUrl);
        
        if (previousScrapedData) {
            console.log('Returning previously scraped data');
            return res.json({
                employees: previousScrapedData,
                message: 'Data retrieved from previous scrape',
                source: 'previous_container'
            });
        }

        // Launch the agent
        console.log(`Launching employees export agent for ${companyUrl}`);
        const containerId = await launchEmployeesExportAgent(
            CONFIG.PHANTOMBUSTER.AGENT_ID, 
            companyUrl, 
            sessionCookie
        );
        console.log(`Employees export agent launched with container ID ${containerId}`);

        // Poll for results with exponential backoff
        const exportData = await pollForResults(containerId);

        if (exportData && exportData.resultObject) {
            // Save to MongoDB only if not already in database
            await saveToMongoDB(exportData.resultObject, companyUrl);

            res.json({
                employees: exportData.resultObject,
                message: 'New data scraped and saved',
                source: 'new_scrape'
            });
        } else {
            res.status(404).json({ 
                error: 'No data found', 
                message: 'Could not retrieve employee data for the given company URL' 
            });
        }

    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message 
        });
    }
});

module.exports = router;