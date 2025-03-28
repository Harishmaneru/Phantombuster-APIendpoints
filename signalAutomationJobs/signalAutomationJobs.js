require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const { MongoClient, ObjectId } = require("mongodb");
const router = express.Router();

const { getCompanyInsights } = require('../pressFundingAnnounements/CompanyInsightsModule.js');
const { processJobSignals } = require('../pressFundingAnnounements/jobSignals.js');
const { fetchYouTubeVideos } = require('../socialSignals/youtubeData.js');
const { fetchTwitterMentions } = require('../socialSignals/twitterMentions.js');
const { fetchCompanyNews } = require('../pressFundingAnnounements/newsAnnouncements.js');
const { fetchCompanyDetailsByLinkedInURL } = require('../pressFundingAnnounements/fetchCompanyByDomain.js');
const { fetchProductLaunchSignals } = require('../pressFundingAnnounements/productLunchs.js');
const { fetchPublicMentions } = require('../pressFundingAnnounements/publicMentions.js');
const { fetchCompanyPosts } = require('../rapidAPI/companyPosts.js');
const { fetchFilings10K } = require('../secFilings/secScraper10K.js');
const { fetchFilings10Q } = require('../secFilings/secScraper10Q.js');
const { fetchFundingAndProductLaunchSignals } = require('../exploriumAPI/businessesAPI.js');
const { fetchFundingAcquisitionInfo } = require('../exploriumAPI/businessesAPI.js');
const { fetchTechnographicsData } = require('../exploriumAPI/businessesAPI.js');

const { OpenAI } = require('openai');
const url = "mongodb://onepgrdb:onepgrdb123@pages.onepgr.com:27017/?authSource=admin";

let client, SignalAutomationJob;

async function connectMongoDb() {
    try {
        client = await MongoClient.connect(url);
        SignalAutomationJob = client.db("onepgr").collection("signalautomationjobs");
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
    console.log("------------------signalautomationjobs mongodb Connected---------------");
}
connectMongoDb();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mapping for credit details based on signal_flag.
// Signals that do not incur a cost have creditsPerCall set to 0.
const creditMapping = {
    financial_information: { creditsPerCall: 0, costPerCredit: 0 },
    press_announcements: { creditsPerCall: 0, costPerCredit: 0 },
    job_openings: { creditsPerCall: 0, costPerCredit: 0 },
    job_changes: { creditsPerCall: 0, costPerCredit: 0 },
    youtube_marketing_videos: { creditsPerCall: 0, costPerCredit: 0 },
    twitter_brand_mentions: { creditsPerCall: 1, costPerCredit: 0.2 },
    public_mentions: { creditsPerCall: 0, costPerCredit: 0 },
    product_launches: { creditsPerCall: 0, costPerCredit: 0 },
    linkedin_company_updates: { creditsPerCall: 2, costPerCredit: 0.2 },
    activity_on_linkedin: { creditsPerCall: 2, costPerCredit: 0.2 },
    contact_profile_information: { creditsPerCall: 1, costPerCredit: 0.2 }
};

// Helper function to determine job status based on nested response statuses.
function determineJobStatus(response) {
    let hasError = false;
    let hasInProgress = false;
    let allSuccess = true;

    function checkStatus(obj) {
        if (typeof obj !== 'object' || obj === null) return;
        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                checkStatus(obj[key]);
            } else if (key === 'status') {
                const statusStr = String(obj[key]);
                if (statusStr === "-1") {
                    hasError = true;
                } else if (statusStr === "1") {
                    hasInProgress = true;
                    allSuccess = false;
                } else if (statusStr !== "0") {
                    allSuccess = false;
                }
            }
        }
    }
    checkStatus(response);
    if (hasError) return 'FAILED';
    if (hasInProgress) return 'IN_PROGRESS';
    return allSuccess ? 'SUCCESS' : 'IN_PROGRESS';
}


async function processJob(job) {
    let response, signalDataCount = 0, costDetails = null;

    // Reuse signal data if a similar job exists.
    const existingJob = await SignalAutomationJob.findOne({
        user_id: job.user_id,
        request_id: job.request_id,
        contact_company: job.contact_company,
        signal_flag: job.signal_flag,
        signal_data: { $exists: true, $ne: null },
        _id: { $ne: job._id }
    });

    if (existingJob) {
        console.log(`Reusing signal data from job ${existingJob.job_id} for company ${job.contact_company}`);
        response = existingJob.signal_data;
        signalDataCount = existingJob.signal_data_count || 0;
    } else {
        // Process the API call based on the signal_flag.
        switch (job.signal_flag) {
            case 'financial_information': {
                // Fetch 10-K and 10-Q filings.
                const filing10KResult = await fetchFilings10K(job.contact_company);
                const filing10QResult = await fetchFilings10Q(job.contact_company);
                const form10KData = filing10KResult?.data || filing10KResult?.filings || null;
                const form10QData = filing10QResult?.data || filing10QResult?.filings || null;
                const normalizeFilings = (filings) => {
                    return filings.map(filing => {
                        if (!filing.filingUrl && filing.htmlUrl) {
                            filing.filingUrl = filing.htmlUrl;
                        }
                        return filing;
                    });
                };
                const normalized10KData = form10KData ? normalizeFilings(form10KData) : null;
                const normalized10QData = form10QData ? normalizeFilings(form10QData) : null;
                response = {
                    status: filing10KResult.status,
                    message: filing10KResult.message,
                    ticker: filing10KResult.ticker,
                    cik: filing10KResult.cik,
                    form10K: normalized10KData,
                    form10Q: normalized10QData
                };
                signalDataCount =
                    (normalized10KData ? normalized10KData.length : 0) +
                    (normalized10QData ? normalized10QData.length : 0);
                break;
            }
            case 'press_announcements': {
                const insightsResponse = await getCompanyInsights({ companyName: job.contact_company });
                const newsResponse = await fetchCompanyNews({ companyName: job.contact_company });
                response = { insightsResponse, newsResponse };
                signalDataCount = (insightsResponse?.data?.length || 0) + (newsResponse?.data?.length || 0);
                break;
            }
            case 'job_openings':
            case 'job_changes': {
                response = await processJobSignals({
                    linkedinUrl: job.contact_details?.co_linkedin,
                    companyName: job.contact_company
                });
                signalDataCount = response?.data?.length || 0;
                break;
            }
            case 'funding_announcement': {
                console.log('[SIGNAL_AUTOMATION_JOBS] Processing funding announcement for company:', job.contact_company);
                const domain = job.contact_details?.domain || `${job.contact_company}.com`;
                console.log('[SIGNAL_AUTOMATION_JOBS] Using domain for funding announcement:', domain);

                try {
                    response = await fetchFundingAcquisitionInfo({ domain });
                    // Count the number of funding rounds from the FundingAndAcquisitionData
                    signalDataCount = response?.FundingAndAcquisitionData?.number_of_funding_rounds ||
                        response?.FundingAndAcquisitionData?.funding_rounds_info?.length || 0;
                    console.log('[SIGNAL_AUTOMATION_JOBS] Funding announcement API response status:', response.status);
                    console.log('[SIGNAL_AUTOMATION_JOBS] Found funding rounds count:', signalDataCount);
                } catch (error) {
                    console.error('[SIGNAL_AUTOMATION_JOBS] Error fetching funding announcements:', error.message);
                    throw error;
                }
                break;
            }
            case 'technographics_data': {
                console.log('[SIGNAL_AUTOMATION_JOBS] Processing technographics data for company:', job.contact_company);
                const domain = job.contact_details?.domain || `${job.contact_company}.com`;
                console.log('[SIGNAL_AUTOMATION_JOBS] Using domain for technographics data:', domain);

                try {
                    response = await fetchTechnographicsData({ domain });
                    // Count the number of technographics data points
                    // signalDataCount = response?.technographicsData?.length || 0;
                    signalDataCount = Object.keys(response.technographicsData).length;

                    console.log('[SIGNAL_AUTOMATION_JOBS] Technographics data API response status:', response.status);
                    console.log('[SIGNAL_AUTOMATION_JOBS] Found technographics data count:', signalDataCount);
                } catch (error) {
                    console.error('[SIGNAL_AUTOMATION_JOBS] Error fetching technographics data:', error.message);
                    throw error;
                }
                break;
            }
            case 'new_product_launch': {
                console.log('[SIGNAL_AUTOMATION_JOBS] Processing new product launch for company:', job.contact_company);
                const domain = job.contact_details?.domain || `${job.contact_company}.com`;
                console.log('[SIGNAL_AUTOMATION_JOBS] Using domain for product launch:', domain);

                try {
                    response = await fetchFundingAndProductLaunchSignals({ domain });
                    // Count the number of output events from the FundingannounmenetData
                    signalDataCount = response?.fundingInvestmentAndProductLaunchData?.output_events?.length || 0;
                    console.log('[SIGNAL_AUTOMATION_JOBS] Product launch API response status:', response.status);
                    console.log('[SIGNAL_AUTOMATION_JOBS] Found product launches count:', signalDataCount);
                } catch (error) {
                    console.error('[SIGNAL_AUTOMATION_JOBS] Error fetching product launch info:', error.message);
                    throw error;
                }


                break;
            }
            case 'youtube_marketing_videos': {
                response = await fetchYouTubeVideos({ companyName: job.contact_company });
                signalDataCount = response?.data?.length || 0;
                break;
            }
            case 'twitter_replies_or_engagements':
            case 'twitter_brand_mentions': {
                response = await fetchTwitterMentions({ companyName: job.contact_company });
                signalDataCount = response?.data?.length || 0;
                break;
            }
            case 'public_mentions': {
                response = await fetchPublicMentions({ companyName: job.contact_company });
                signalDataCount = response?.data?.length || 0;
                break;
            }
            case 'product_launches': {
                response = await fetchProductLaunchSignals({ companyName: job.contact_company });
                signalDataCount = response?.data?.length || 0;
                break;
            }
            case 'linkedin_company_updates':
            case 'activity_on_linkedin': {
                let companyUrl = '';
                const linkedinProfile = job.contact_details?.co_linkedin?.trim();

                // First check if we have a valid LinkedIn profile URL
                if (linkedinProfile && linkedinProfile !== "N/A") {
                    // Check if it's a valid LinkedIn URL
                    if (linkedinProfile.includes('linkedin.com')) {
                        companyUrl = linkedinProfile;
                    } else if (linkedinProfile.startsWith('www.linkedin.com') || linkedinProfile.startsWith('linkedin.com')) {
                        // Add https:// if missing
                        companyUrl = `https://${linkedinProfile}`;
                    } else {
                        // If it's just a profile ID/handle, construct the full URL
                        companyUrl = `https://www.linkedin.com/company/${linkedinProfile}`;
                    }
                } else {
                    // Fallback to using company name if no valid LinkedIn profile
                    console.log('No LinkedIn profile found, using company name:', job.contact_company);
                    const slug = job.contact_company.toLowerCase()
                        .replace(/\s+/g, '-')
                        .replace(/[^a-z0-9-]/g, '')
                        .replace(/-+/g, '-');
                    companyUrl = `https://www.linkedin.com/company/${slug}`;
                }

                console.log('Using LinkedIn URL:', companyUrl);
                response = await fetchCompanyPosts(companyUrl);
                signalDataCount = response?.data?.data?.length || 0;
                break;
            }
            case 'contact_profile_information': {
                let companyUrl = job.contact_details?.co_linkedin?.trim();
                if (!companyUrl || companyUrl === "N/A") {
                    const slug = job.contact_company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                    companyUrl = `https://www.linkedin.com/company/${slug}`;
                }
                response = await fetchCompanyDetailsByLinkedInURL(companyUrl);
                signalDataCount = response?.data?.data?.company_name ? 1 : 0;
                break;
            }
            default:
                console.warn(`Unknown signal_flag for job ID: ${job.job_id}`);
                return;
        }
    }

    // Determine the job status based on the response.
    const jobStatus = determineJobStatus(response);
    // Retrieve credit mapping based on the signal_flag.
    const mapping = creditMapping[job.signal_flag] || { creditsPerCall: 0, costPerCredit: 0 };
    costDetails = {
        signal_name: job.signal_name,
        signal_flag: job.signal_flag,
        total_signal_usage: 1, // each API call is counted as one usage
        total_credits_used: mapping.creditsPerCall,
        credits_per_signal: mapping.creditsPerCall,
        cost_per_credit: mapping.costPerCredit
    };

    // Update the job document with response, signal data count, job status, and cost details.
    const updateResult = await SignalAutomationJob.updateOne(
        { _id: job._id },
        {
            $set: {
                job_status: jobStatus,
                signal_data: response,
                signal_data_count: signalDataCount,
                job_signal_cost_details: costDetails
            }
        }
    );

    if (updateResult.modifiedCount === 0) {
        console.warn(`Job ID: ${job.job_id} update did not modify any documents`);
    } else {
        console.log(`Job ID: ${job.job_id} updated with status: ${jobStatus}, signal_data_count: ${signalDataCount}, and cost details:`, costDetails);
    }
}

// Aggregate cost details from all jobs for a given user and request,
// then update the signalautomationrequests document with the field job_signal_cost_details.
async function aggregateAndUpdateRequestCostDetails(user_id, request_id) {
    const jobs = await SignalAutomationJob.find({ user_id, request_id }).toArray();
    const aggregatedCostDetails = {};

    jobs.forEach(job => {
        const cost = job.job_signal_cost_details;
        if (cost) {
            const key = cost.signal_flag;
            if (!aggregatedCostDetails[key]) {
                aggregatedCostDetails[key] = { ...cost };
            } else {
                aggregatedCostDetails[key].total_signal_usage += cost.total_signal_usage;
                aggregatedCostDetails[key].total_credits_used += cost.total_credits_used;
            }
        }
    });

    const aggregatedCostArray = Object.values(aggregatedCostDetails);

    const requestCollection = client.db("onepgr").collection("signalautomationrequests");
    await requestCollection.updateOne(
        { request_id },
        { $set: { job_signal_cost_details: aggregatedCostArray } }
    );
    console.log(`Updated request ${request_id} with aggregated cost details:`, aggregatedCostArray);
}

// Updated fetchJobsByStatus endpoint which processes jobs, updates their cost details,
// and then aggregates these details in the corresponding request document.
async function fetchJobsByStatus(req, res) {
    try {
        const { user_id, job_status, request_id } = req.query;
        console.log('Received:', { user_id, job_status, request_id });

        if (!user_id) {
            return res.status(400).json({ message: 'user_id is required' });
        }

        if (!job_status || !["NOT_STARTED", "IN_PROGRESS", "FAILED"].includes(job_status)) {
            return res.status(400).json({ message: 'Valid job_status is required (NOT_STARTED, IN_PROGRESS, FAILED)' });
        }

        const query = { user_id, job_status };
        if (request_id) {
            query.request_id = request_id;
        }

        const jobs = await SignalAutomationJob.find(query).toArray();
        if (!Array.isArray(jobs) || jobs.length === 0) {
            console.log(`No jobs found with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''}`);
            return res.json({
                message: `No jobs with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''} found for this user.`,
                summary: {
                    NOT_STARTED: 0,
                    IN_PROGRESS: 0,
                    SUCCESS: 0,
                    FAILED: 0
                }
            });
        }

        // Process jobs if status is NOT_STARTED.
        if (job_status === 'NOT_STARTED') {
            for (const job of jobs) {
                try {
                    await processJob(job);
                } catch (jobError) {
                    console.error(`Error occurred while processing job ID: ${job.job_id}`, jobError);
                    await SignalAutomationJob.updateOne(
                        { _id: job._id },
                        {
                            $set: {
                                job_status: 'FAILED',
                                job_error: {
                                    message: jobError.message,
                                    timestamp: new Date()
                                }
                            }
                        }
                    );
                }
            }

            // Optionally, run summarization after processing.
            try {
                await summarizeSignalData({ query: { user_id, request_id } }, {
                    json: () => { },
                    status: () => ({ json: () => { } })
                });
                console.log('Summarization completed for user:', { user_id, request_id });
            } catch (summaryError) {
                console.error('Error during summarization:', summaryError);
            }
        }

        // Aggregate cost details and update the request document.
        if (request_id) {
            await aggregateAndUpdateRequestCostDetails(user_id, request_id);
        }

        const statusCounts = await SignalAutomationJob.aggregate([
            { $match: { user_id, ...(request_id ? { request_id } : {}) } },
            {
                $group: {
                    _id: '$job_status',
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        const summary = {
            NOT_STARTED: 0,
            IN_PROGRESS: 0,
            SUCCESS: 0,
            FAILED: 0
        };

        if (Array.isArray(statusCounts)) {
            statusCounts.forEach(status => {
                if (status._id) {
                    summary[status._id] = status.count;
                }
            });
        }

        console.log('Summary of job statuses:', summary);

        res.json({
            summary,
            message: `${jobs.length} jobs fetched successfully.`
        });

    } catch (error) {
        console.error('Critical Error in fetchJobsByStatus:', error);
        res.status(500).json({
            error: 'An error occurred while fetching the jobs.',
            details: error.message
        });
    }
}

// Summarize signal data using the OpenAI API.
async function summarizeSignalData(req, res) {
    try {
        const { user_id, request_id } = req.query;

        if (!user_id || !request_id) {
            return res.status(400).json({ message: 'user_id and request_id are required' });
        }

        console.log('Starting summarizeSignalData for user:', user_id, 'and request_id:', request_id);
        const jobs = await SignalAutomationJob.find({
            job_status: 'IN_PROGRESS',
            user_id,
            request_id
        }).toArray();
        if (!Array.isArray(jobs) || jobs.length === 0) {
            console.log(`No IN_PROGRESS jobs found for user ${user_id} with request_id ${request_id}`);
            return res.json({
                message: `No IN_PROGRESS jobs found for user ${user_id} with request_id ${request_id}.`
            });
        }

        console.log(`Found ${jobs.length} jobs to summarize for user ${user_id} with request_id ${request_id}`);

        for (const job of jobs) {
            try {
                if (!job.signal_data || Object.keys(job.signal_data).length === 0) {
                    console.log(`Skipping job ${job.job_id} - no signal data`);
                    continue;
                }

                if (job.signal_data_summary && job.signal_data_summary.trim().length > 0) {
                    console.log(`Skipping job ${job.job_id} - summary already exists`);
                    continue;
                }

                let promptTemplate;
                if (job.business_objective_prompt && job.business_objective_prompt.trim().length > 0) {
                    promptTemplate = job.business_objective_prompt;
                    console.log(`Using business objective prompt for job ${job.job_id}: ${promptTemplate}`);
                } else {
                    switch (job.signal_flag) {
                        case 'financial_information':
                            promptTemplate = `Analyze the following financial data for ${job.contact_company}. Focus on key metrics from 10-K and 10-Q filings, including revenue, profit, and significant changes: `;
                            break;
                        case 'press_announcements':
                            promptTemplate = `Summarize the latest press announcements and funding rounds for ${job.contact_company}. Highlight major events, funding amounts, and key developments: `;
                            break;
                        case 'job_openings':
                        case 'job_changes':
                            promptTemplate = `Analyze the job market activity for ${job.contact_company}. Include total openings, key departments hiring, and notable positions: `;
                            break;
                        case 'funding_announcement':
                            promptTemplate = `Summarize the latest funding announcements for ${job.contact_company}. Include funding amounts, investors, and key developments: `;
                            break;
                        case 'new_product_launch':
                            promptTemplate = `Summarize the latest product launches for ${job.contact_company}. Include product details, launch dates, key features, and market impact: `;
                            break;
                        case 'technographics_data':
                            promptTemplate = `Analyze the comprehensive technographic data for ${job.contact_company}. Summarize the complete technology stack and its categorization into functional areas (e.g., Operations Management, Programming, Marketing, IT Security, Product and Design, etc.). Identify key trends, standout technologies, and any competitive advantages. Provide insights on how these tools support business operations, drive innovation, and impact market positioning.`;
                            break;
                        case 'youtube_marketing_videos':
                            promptTemplate = `Summarize the recent YouTube content from ${job.contact_company}. Focus on video engagement, key themes, and notable metrics: `;
                            break;
                        case 'twitter_replies_or_engagements':
                        case 'twitter_brand_mentions':
                            promptTemplate = `Analyze Twitter engagement for ${job.contact_company}. Include mention volume, sentiment trends, and notable interactions: `;
                            break;
                        case 'public_mentions':
                            promptTemplate = `Summarize the public mentions for ${job.contact_company}. Include sentiment analysis, volume trends, and key themes: `;
                            break;
                        case 'product_launches':
                            promptTemplate = `Summarize the latest product launches for ${job.contact_company}. Include product details, launch dates, key features, and market impact: `;
                            break;
                        case 'linkedin_company_updates':
                        case 'activity_on_linkedin':
                            promptTemplate = `Summarize the latest LinkedIn updates and activities for ${job.contact_company}. Highlight recent posts, articles, announcements, and key engagements. Include any insights on company initiatives, market trends, and industry impact: `;
                            break;
                        default:
                            promptTemplate = `Summarize the following data for ${job.contact_company}: `;
                    }
                }

                const promptData = promptTemplate + JSON.stringify(job.signal_data, null, 2);
                console.log(`Generating summary for job ${job.job_id}`);

                // Call OpenAI's API for summarization.
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

                // Update the job with the summary.
                const updateResult = await SignalAutomationJob.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            signal_data_summary: summary,
                            job_status: 'IN_PROGRESS'
                        }
                    }
                );
                if (updateResult.modifiedCount === 0) {
                    console.warn(`Warning: Update for job ${job.job_id} did not modify any documents`);
                } else {
                    console.log(`Successfully summarized job ${job.job_id}`);
                }
            } catch (error) {
                console.error(`Error processing job ${job.job_id}:`, error.message);
                const errorUpdateResult = await SignalAutomationJob.updateOne(
                    { _id: job._id },
                    {
                        $set: {
                            job_status: 'FAILED',
                            job_error: {
                                message: error.message,
                                timestamp: new Date(),
                                details: 'Error during summarization'
                            }
                        }
                    }
                );
                if (errorUpdateResult.modifiedCount === 0) {
                    console.warn(`Warning: Error update for job ${job.job_id} did not modify any documents`);
                }
            }
        }

        res.json({
            message: `Signal data summarization completed successfully for user ${user_id}.`,
            processed: jobs.length
        });

    } catch (error) {
        console.error('Error in summarizeSignalData:', error.message);
        res.status(500).json({
            error: 'An error occurred while summarizing the signal data.',
            details: error.message
        });
    }
}

// Fetch all jobs for a given user and request.
async function fetchAllJobsByUser(req, res) {
    try {
        const { user_id, request_id } = req.query;

        if (!user_id || !request_id) {
            return res.status(400).json({
                message: 'Both user_id and request_id are required.'
            });
        }
        const jobs = await SignalAutomationJob.find({ user_id, request_id }).toArray();

        if (jobs.length === 0) {
            console.warn(`No jobs found for user_id: ${user_id} and request_id: ${request_id}`);
            return res.json({
                message: `No jobs found for user_id ${user_id} and request_id ${request_id}.`
            });
        }

        console.log(`Fetched ${jobs.length} jobs for user_id: ${user_id} and request_id: ${request_id}`);
        jobs.forEach(job => console.log(`Job ID: ${job.job_id}, Job Status: ${job.job_status}`));

        res.json({
            jobs,
            message: `${jobs.length} jobs fetched successfully for user_id ${user_id} and request_id ${request_id}.`
        });

    } catch (error) {
        console.error('Error fetching jobs:', error);
        res.status(500).json({
            error: 'An error occurred while fetching the jobs.',
            details: error.message
        });
    }
}

// Change the job status back to NOT_STARTED and reset related fields.
async function changeJobStatusToNotStarted(req, res) {
    try {
        const { user_id, request_id } = req.body;
        console.log('Received:', { user_id, request_id });

        if (!user_id || !request_id) {
            return res.status(400).json({ message: 'Both user_id and request_id are required.' });
        }

        const query = {
            user_id,
            request_id,
            // job_status: { $in: ['COMPLETED'] }
            job_status: { $in: ['FAILED', 'IN_PROGRESS', 'SUCCESS', 'COMPLETED'] }
        };

        const updatedJobs = await SignalAutomationJob.updateMany(
            query,
            {
                $set: {
                    job_status: 'NOT_STARTED',
                    signal_data: null,
                    signal_data_summary: null,
                    signal_data_count: null,
                    job_error: null,
                    job_signal_cost_details: null
                }
            }
        );

        if (updatedJobs.modifiedCount === 0) {
            return res.status(404).json({
                message: 'No jobs updated. Ensure jobs exist, match the user_id and request_id, and have the correct status.'
            });
        }

        console.log(`Updated ${updatedJobs.modifiedCount} job(s) to NOT_STARTED for request_id: ${request_id}`);
        res.json({
            message: 'Jobs status updated to NOT_STARTED successfully.',
            updatedCount: updatedJobs.modifiedCount
        });

    } catch (error) {
        console.error('Error updating job status:', error);
        res.status(500).json({ error: 'An internal error occurred while updating the job status.' });
    }
}

// Fetch jobs that have FAILED.
async function fetchFailedJobs(req, res) {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ message: 'user_id is required' });
        }

        const jobs = await SignalAutomationJob.find({
            user_id,
            job_status: 'FAILED'
        }).toArray();

        if (jobs.length === 0) {
            console.log(`No FailedJobs jobs found for user_id: ${user_id}`);
            return res.json({
                message: `No FailedJobs jobs found for user_id ${user_id}.`,
                jobs: []
            });
        }

        console.log(`Fetched ${jobs.length} FailedJobs jobs for user_id: ${user_id}`);
        jobs.forEach(job => console.log(`Job ID: ${job.job_id}`));

        res.json({
            jobs,
            message: `${jobs.length} FailedJobs jobs fetched successfully for user_id ${user_id}.`
        });

    } catch (error) {
        console.error('Error fetching FailedJobs jobs:', error);
        res.status(500).json({
            error: 'An error occurred while fetching FailedJobs jobs.',
            details: error.message
        });
    }
}

router.get('/fetchFailedJobs', fetchFailedJobs);
router.get('/fetchAllJobsByUser', fetchAllJobsByUser);
router.get('/fetchJobsByStatus', fetchJobsByStatus);
router.get('/summarizeSignalData', summarizeSignalData);
router.post('/changeJobStatusToNotStarted', changeJobStatusToNotStarted);

module.exports = {
    router,
    fetchAllJobsByUser,
    fetchJobsByStatus,
    summarizeSignalData,
    changeJobStatusToNotStarted,
    fetchFailedJobs
};
