const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const router = express.Router();

const phantombusterApiKey = 'ZJNIKxvLxe7xmiOnaBlNQNlGqIeDdLquL69ajMg111c';
const employeesExportAgentId = '6132479558213522';  // LinkedIn Company Employees Export agent ID

const mongoUri = 'mongodb+srv://harishmaneru:Xe2Mz13z83IDhbPW@cluster0.bu3exkw.mongodb.net/?retryWrites=true&w=majority&tls=true';
const dbName = 'Phantombuster';

async function launchEmployeesExportAgent(agentId, companyUrl, sessionCookie, agentArgs) {
    try {
        const response = await axios.post('https://api.phantombuster.com/api/v2/agents/launch', {
            id: agentId,
            argument: agentArgs || {
                numberOfResultsPerCompany: 50,
                numberOfCompaniesPerLaunch: 1,
                spreadsheetUrl: companyUrl,
                sessionCookie: sessionCookie,
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            }
        }, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
                'Content-Type': 'application/json'
            }
        });
        return response.data.containerId;
    } catch (error) {
        console.error(`Error launching LinkedIn Company Employees Export agent ${agentId}:`, error.message);
        throw error;
    }
}

async function getEmployeesExportResults(containerId) {
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

async function getContainerOutput(containerId) {
    try {
        const response = await axios.get(`https://api.phantombuster.com/api/v2/containers/fetch-output?id=${containerId}`, {
            headers: {
                'X-Phantombuster-Key': phantombusterApiKey,
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

async function processEmployeesExportData(containerId) {
    const [resultData, outputData] = await Promise.all([
        getEmployeesExportResults(containerId),
        getContainerOutput(containerId)
    ]);

    return {
        resultObject: resultData && resultData.resultObject ? JSON.parse(resultData.resultObject) : null,
        containerOutput: outputData
    };
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
                agentId: employeesExportAgentId
            }
        });
        return response.data.containers;
    } catch (error) {
        console.error('Error fetching containers:', error.message);
        throw error;
    }
}

async function findPreviousExportedData(companyUrl) {
    const containers = await getAllContainers();
    console.log(`Checking ${containers.length} containers for previously exported data...`);

    if (containers.length === 0) {
        console.log("No containers found or error occurred while fetching containers.");
        return null;
    }

    for (const container of containers) {
        try {
            const data = await processEmployeesExportData(container.id);
            
            if (data.containerOutput && data.containerOutput.output.includes(companyUrl)) {
                console.log(`Found previously exported data in container ${container.id}`);
                return data;
            }
        } catch (error) {
            console.error(`Error processing container ${container.id}:`, error.message);
        }
    }
    
    console.log("No previously exported data found.");
    return null;
}

router.post('/CompanyEmployeesScrap', async (req, res) => {
    const { companyUrl, sessionCookie } = req.body;
    console.log(sessionCookie);
    try {
        console.log(`Launching employees export agent for ${companyUrl}`);
        const containerId = await launchEmployeesExportAgent(employeesExportAgentId, companyUrl, sessionCookie);
        console.log(`Employees export agent launched with container ID ${containerId}`);

        await waitForResults();

        let exportData = await processEmployeesExportData(containerId);

        if (!exportData.resultObject) {
            console.log("No new data scraped. Checking container output...");
            
            if (exportData.containerOutput && 
                exportData.containerOutput.output.includes("The provided company list is already scraped")) {
                console.log("Company URL already exported. Searching for previous data...");
                exportData = await findPreviousExportedData(companyUrl);
            } else {
                console.log("Unexpected output from container:", exportData.containerOutput);
            }
        }

        if (exportData && exportData.resultObject) {
            console.log("Saving exported data to MongoDB...");
            await saveToMongoDB('CompanyEmployees', exportData.resultObject);
            console.log("Data saved successfully.");
        } else {
            console.log("No data found for the provided company URL.");
        }

        res.json({
            employees: exportData?.resultObject || null,
            containerOutput: exportData?.containerOutput || null
        });
    } catch (error) {
        console.error('An error occurred:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

module.exports = router;
