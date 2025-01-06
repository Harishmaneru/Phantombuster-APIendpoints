const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const { fetchLatestFiling } = require('../secFilings/filingController.js');
const { getCompanyInsights } = require('../pressFundingAnnounements/CompanyInsightsModule.js');
const { fetchAdzunaJobListings } = require('../pressFundingAnnounements/jobSignals.js');
const { fetchYouTubeVideos } = require('../socialSignals/youtubeData.js');
const { fetchTwitterMentions } = require('../socialSignals/twitterMentions.js');

const { OpenAI } = require('openai');


const url = "mongodb://onepgrdb:onepgrdb123@pages.onepgr.com:27017/?authSource=admin";

const openai = new OpenAI({ apiKey: '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' });

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
        if (!user_id) {
            return res.status(400).json({ message: 'user_id is required' });
        }

        if (!job_status || !["NOT_STARTED", "IN_PROGRESS", "FAILED"].includes(job_status)) {
            return res.status(400).json({ message: 'Valid job_status is required (NOT_STARTED, IN_PROGRESS, FAILED)' });
        }

        const jobs = await SignalAutomationJob.find({ job_status, user_id });

        if (jobs.length === 0) {
            return res.json({ message: `No jobs with status ${job_status} found for this user.` });
        }

        if (job_status === 'NOT_STARTED') {
            for (const job of jobs) {
                let response;
                switch (job.signal_flag) {
                    case 'financial_information':
                        const response10K = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-K' });
                        const response10Q = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-Q' });
                        response = { form10K: response10K, form10Q: response10Q };
                        break;
                    case 'press_announcements':
                        response = await getCompanyInsights({ companyName: job.contact_company });
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
                        continue;
                }

                const hasError = (response.form10K && response.form10K.status === "-1") ||
                                 (response.form10Q && response.form10Q.status === "-1") ||
                                 (response.status === "-1");

                if (hasError) {
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
                }
            }
        }

        res.json({ jobs });

    } catch (error) {
        res.status(500).json({ error: 'An error occurred while fetching the jobs.' });
    }
}


async function summarizeSignalData(req, res) {
    try {
        console.log('Starting summarizeSignalData');
        const jobs = await SignalAutomationJob.find({ job_status: 'IN_PROGRESS' });
        console.log(`Found ${jobs.length} jobs to summarize`);

        for (const job of jobs) {
            try {
                if (!job.signal_data) {
                    console.log(`Skipping job ${job.job_id} - no signal data`);
                    continue;
                }
                let promptTemplate = '';
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

                const promptData = promptTemplate + JSON.stringify(job.signal_data);
                console.log(`Processing summary for job ${job.job_id}`);

                const completion = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ 
                        role: "user", 
                        content: promptData
                    }],
                    max_tokens: 2000,
                    temperature: 0.7
                });

                const summary = completion.choices[0]?.message?.content;
                
                if (!summary) {
                    throw new Error('No summary generated from OpenAI');
                }

                await SignalAutomationJob.updateOne(
                    { _id: job._id }, 
                    {
                        signal_data_summary: summary,
                        job_status: 'IN_PROGRESS'
                    }
                );

                console.log(`Successfully summarized job ${job.job_id}`);

            } catch (error) {
                console.error(`Error processing individual job ${job.job_id}:`, error);
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

        res.json({ 
            message: 'Signal data summarization completed',
            processed: jobs.length
        });

    } catch (error) {
        console.error('Error in summarizeSignalData:', error);
        res.status(500).json({ 
            error: 'An error occurred while summarizing the signal data.',
            details: error.message
        });
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


module.exports = {
    router,
    fetchJobsByStatus,
    summarizeSignalData
    // resetAllJobsToNotStarted
};
