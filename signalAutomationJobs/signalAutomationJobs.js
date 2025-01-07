const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const { fetchLatestFiling } = require('../secFilings/filingController.js');
const { getComapnyInsights } = require('../pressFundingAnnounements/CompanyInsightsModule.js');
const { fetchAdzunaJobListings } = require('../pressFundingAnnounements/jobSignals.js');
const { fetchYouTubeVideos } = require('../socialSignals/youtubeData.js');
const { fetchTwitterMentions } = require('../socialSignals/twitterMentions.js');

const { OpenAI } = require('openai');


const url = "mongodb://onepgrdb:onepgrdb123@pages.onepgr.com:27017/?authSource=admin";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const signalAutomationJobsSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    contact_id: { type: String, required: true },
    contact_name: { type: String },
    contact_company: { type: String },
    contact_company_url: { type: String },
    contact_email: { type: String },
    contact_details: { type: mongoose.Schema.Types.Mixed },
    signal_flag: { type: String, required: true },
    signal_list_id: { type: String, required: true },
    signal_prompt: { type: String, required: true },
    job_status: { type: String, enum: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "FAILED"], default: "NOT_STARTED", required: true },
    job_id: { type: String, required: true, unique: true },
    job_created_at: { type: Date, default: Date.now, required: true },
    signal_data: { type: mongoose.Schema.Types.Mixed },
    signal_data_summary: { type: String },
    job_error: { type: mongoose.Schema.Types.Mixed },
    job_body: { type: String }
});

const onepgrDB = mongoose.createConnection(url, { dbName: 'onepgr' });
const SignalAutomationJob = onepgrDB.model('signalAutomationJobs', signalAutomationJobsSchema);

async function fetchJobsByStatus(req, res) {
    try {
        const { user_id, job_status } = req.query;
        console.log('Received:', { user_id, job_status });

        // Validate inputs
        if (!user_id) {
            console.error('Error: Missing user_id in request');
            return res.status(400).json({ message: 'user_id is required' });
        }

        if (!job_status || !["NOT_STARTED", "IN_PROGRESS", "FAILED"].includes(job_status)) {
            console.error('Error: Invalid job_status provided');
            return res.status(400).json({ message: 'Valid job_status is required (NOT_STARTED, IN_PROGRESS, FAILED)' });
        }

        // Fetch jobs from the database
        const jobs = await SignalAutomationJob.find({ job_status, user_id });
        console.log(`Found ${jobs.length} jobs with status ${job_status}`);

        // Handle no jobs found case
        if (jobs.length === 0) {
            console.warn(`No jobs found for user_id: ${user_id} with status: ${job_status}`);
            return res.status(200).json({ message: `No jobs with status ${job_status} found for this user.` });
        }

        console.log(`Fetched jobs successfully. Job IDs: ${jobs.map(job => job.job_id).join(', ')}`);
        // Process jobs if status is 'NOT_STARTED'
        if (job_status === 'NOT_STARTED') {
            for (const job of jobs) {
                try {
                    let response;
                    switch (job.signal_flag) {
                        case 'financial_information':
                            const response10K = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-K' });
                            const response10Q = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-Q' });
                            response = { form10K: response10K, form10Q: response10Q };
                            break;
                        case 'press_announcements':
                            response = await getComapnyInsights({ companyName: job.contact_company });
                            break;
                        case 'job_openings':
                            response = await fetchAdzunaJobListings({ companyName: job.contact_company });
                            break;
                        case 'youtube_marketing_videos':
                            response = await fetchYouTubeVideos({ companyName: job.contact_company });
                            break;
                        case 'twitter_brand_mentions':
                            response = await fetchTwitterMentions({ companyName: job.contact_company });
                            break;
                        default:
                            console.warn(`Unknown signal_flag for job ID: ${job.job_id}`);
                            continue;
                    }

                    // Error check based on the response
                    const hasError = (response.form10K && response.form10K.status === "-1") ||
                                     (response.form10Q && response.form10Q.status === "-1") ||
                                     (response.status === "-1");

                    if (hasError) {
                        console.error(`Error processing job: ${job.job_id}`);
                        await SignalAutomationJob.updateOne({ _id: job._id }, {
                            signal_data: response,
                            job_status: 'FAILED',
                            job_error: response.message || "Error in signal processing"
                        });
                    } else {
                        await SignalAutomationJob.updateOne({ _id: job._id }, {
                            signal_data: response,
                            job_status: 'IN_PROGRESS'
                        });
                        console.log(`Job ${job.job_id} updated to IN_PROGRESS successfully`);
                    }
                } catch (jobError) {
                    console.error(`Error occurred while processing job ID: ${job.job_id}`, jobError);
                    await SignalAutomationJob.updateOne({ _id: job._id }, {
                        job_status: 'FAILED',
                        job_error: {
                            message: jobError.message,
                            timestamp: new Date()
                        }
                    });
                }
            }
        }

        // Send success response
        res.json({ jobs, message: `${jobs.length} jobs processed successfully` });

    } catch (error) {
        console.error('Critical Error in fetchJobsByStatus:', error);
        res.status(500).json({ 
            error: 'An error occurred while fetching the jobs.', 
            details: error.message 
        });
    }
}

async function summarizeSignalData(req, res) {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ message: 'user_id is required' });
        }

        console.log('Starting summarizeSignalData for user:', user_id);
        const jobs = await SignalAutomationJob.find({ job_status: 'IN_PROGRESS', user_id });

        if (jobs.length === 0) {
            return res.json({ message: `No IN_PROGRESS jobs found for user ${user_id}.` });
        }

        console.log(`Found ${jobs.length} jobs to summarize for user ${user_id}`);

        for (const job of jobs) {
            try {
                if (!job.signal_data || Object.keys(job.signal_data).length === 0) {
                    console.log(`Skipping job ${job.job_id} - no signal data`);
                    continue;
                }

                let promptTemplate;
                switch (job.signal_flag) {
                    case 'financial_information':
                        promptTemplate = `Analyze the following financial data for ${job.contact_company}. Focus on key metrics from 10-K and 10-Q filings, including revenue, profit, and significant changes: `;
                        break;
                    case 'press_announcements':
                        promptTemplate = `Summarize the latest press announcements and funding rounds for ${job.contact_company}. Highlight major events, funding amounts, and key developments: `;
                        break;
                    case 'job_openings':
                        promptTemplate = `Analyze the job market activity for ${job.contact_company}. Include total openings, key departments hiring, and notable positions: `;
                        break;
                    case 'youtube_marketing_videos':
                        promptTemplate = `Summarize the recent YouTube content from ${job.contact_company}. Focus on video engagement, key themes, and notable metrics: `;
                        break;
                    case 'twitter_brand_mentions':
                        promptTemplate = `Analyze Twitter engagement for ${job.contact_company}. Include mention volume, sentiment trends, and notable interactions: `;
                        break;
                    default:
                        promptTemplate = `Summarize the following data for ${job.contact_company}: `;
                }

                const promptData = promptTemplate + JSON.stringify(job.signal_data, null, 2);
                console.log(`Generating summary for job ${job.job_id}`);

                // Calling OpenAI API for summarization
                const completion = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: promptData }],
                    max_tokens: 2000,
                    temperature: 0.7
                });

                const summary = completion.choices[0]?.message?.content;

                if (!summary) {
                    throw new Error(`No summary generated for job ${job.job_id}`);
                }

                // Storing the summary in the database
                await SignalAutomationJob.updateOne(
                    { _id: job._id },
                    {
                        signal_data_summary: summary,
                        job_status: 'IN_PROGRESS'
                    }
                );

                console.log(`Successfully summarized job ${job.job_id}`);

            } catch (error) {
                console.error(`Error processing job ${job.job_id}:`, error.message);
                await SignalAutomationJob.updateOne(
                    { _id: job._id },
                    {
                        job_status: 'FAILED',
                        job_error: {
                            message: error.message,
                            timestamp: new Date(),
                            details: 'Error during summarization'
                        }
                    }
                );
            }
        }

        res.json({ message: `Signal data summarization completed successfully for user ${user_id}.`, processed: jobs.length });

    } catch (error) {
        console.error('Error in summarizeSignalData:', error.message);
        res.status(500).json({ error: 'An error occurred while summarizing the signal data.', details: error.message });
    }
}


async function changeJobStatusToNotStarted(req, res) {
    try {
        const { user_id, job_ids } = req.body;

        if (!user_id || !Array.isArray(job_ids) || job_ids.length === 0) {
            return res.status(400).json({ message: 'user_id and an array of job_ids are required' });
        }

        const updatedJobs = await SignalAutomationJob.updateMany(
            { user_id, job_id: { $in: job_ids }, job_status: 'FAILED' },
            {
                job_status: 'NOT_STARTED',
                signal_data: null,
                signal_data_summary: null,
                job_error: null
            }
        );

        if (updatedJobs.modifiedCount === 0) {
            return res.status(404).json({ message: 'No jobs updated. Ensure job IDs exist and are in FAILED status.' });
        }

        console.log(`Updated job statuses to NOT_STARTED for job IDs: ${job_ids.join(', ')}`);
        res.json({ message: 'Jobs status updated to NOT_STARTED successfully.', updatedCount: updatedJobs.modifiedCount });

    } catch (error) {
        console.error('Error updating job status:', error);
        res.status(500).json({ error: 'An error occurred while updating the job status.' });
    }
}

// async function resetAllJobsToNotStarted(req, res) {
//     try {
//         const result = await SignalAutomationJob.updateMany(
//             {},
//             {
//                 job_status: 'NOT_STARTED',
//                 signal_data: null,
//                 signal_data_summary: null,
//                 job_error: null
//             }
//         );

//         if (result.modifiedCount === 0) {
//             return res.status(404).json({ message: 'No jobs were updated to NOT_STARTED status.' });
//         }

//         res.json({ message: `${result.modifiedCount} jobs have been reset to NOT_STARTED.` });

//     } catch (error) {
//         res.status(500).json({ error: 'An error occurred while resetting the jobs.' });
//     }
// }
// router.post('/resetAllJobsToNotStarted', resetAllJobsToNotStarted);


router.get('/fetchJobsByStatus', fetchJobsByStatus);
router.get('/summarizeSignalData', summarizeSignalData);
router.post('/changeJobStatusToNotStarted', changeJobStatusToNotStarted);


module.exports = {
    router,
    fetchJobsByStatus,
    summarizeSignalData,
    changeJobStatusToNotStarted
    // resetAllJobsToNotStarted
};
