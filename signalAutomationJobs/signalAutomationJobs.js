const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

const { fetchLatestFiling } = require('../secFilings/filingController.js');
const { getCompanyInsights } = require('../pressFundingAnnounements/CompanyInsightsModule.js');
const { fetchAdzunaJobListings } = require('../pressFundingAnnounements/jobSignals.js');
const { fetchYouTubeVideos } = require('../socialSignals/youtubeData.js');
const { fetchTwitterMentions } = require('../socialSignals/twitterMentions.js');

const url = "mongodb://onepgrdb:onepgrdb123@pages.onepgr.com:27017/?authSource=admin";

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
        console.log('Fetching jobs by status');
        const { user_id, job_status } = req.query;
        if (!user_id) {
            console.warn('No user_id provided in request');
            return res.status(400).json({ message: 'user_id is required' });
        }

        if (!job_status || !["NOT_STARTED", "IN_PROGRESS", "FAILED"].includes(job_status)) {
            console.warn('Invalid or missing job_status provided');
            return res.status(400).json({ message: 'Valid job_status is required (NOT_STARTED, IN_PROGRESS, FAILED)' });
        }

        const jobs = await SignalAutomationJob.find({ job_status, user_id });

        if (jobs.length === 0) {
            console.log(`No jobs found with status ${job_status}`);
            return res.json({ message: `No jobs with status ${job_status} found for this user.` });
        }

        console.log(`Found ${jobs.length} jobs with status ${job_status}`);
        for (const job of jobs) {
            console.log(`Processing job: ${job.job_id}`);
            let response;
            switch (job.signal_flag) {
                case 'financial_information':
                    response = await fetchLatestFiling({
                        companyName: job.contact_company,
                        formType: '10-K'
                    });
                    break;
                case 'press_announcements':
                    response = await getCompanyInsights({
                        companyName: job.contact_company
                    });
                    break;
                case 'job_openings':
                    response = await fetchAdzunaJobListings({
                        companyName: job.contact_company
                    });
                    break;
                case 'youtube_marketing_videos':
                    response = await fetchYouTubeVideos({
                        companyName: job.contact_company
                    });
                    break;
                case 'twitter_brand_mentions':
                    response = await fetchTwitterMentions({
                        companyName: job.contact_company
                    });
                    break;
                default:
                    console.warn(`Unknown signal flag for job ${job.job_id}`);
                    continue;
            }

            await SignalAutomationJob.updateOne({ _id: job._id }, {
                signal_data: response,
                job_status: 'IN_PROGRESS'
            });
        }

        res.json({ jobs });
    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({ error: 'An error occurred while fetching the jobs.' });
    }
}

router.get('/fetchJobsByStatus', fetchJobsByStatus);

module.exports = {
    router,
    fetchJobsByStatus
};
