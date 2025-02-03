require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');

const router = express.Router();
const { fetchLatestFiling } = require('../secFilings/filingController.js');
const { getCompanyInsights } = require('../pressFundingAnnounements/CompanyInsightsModule.js');
const { processJobSignals } = require('../pressFundingAnnounements/jobSignals.js');
const { fetchYouTubeVideos } = require('../socialSignals/youtubeData.js');
const { fetchTwitterMentions } = require('../socialSignals/twitterMentions.js');
const { fetchCompanyNews } = require('../pressFundingAnnounements/newsAnnouncements.js');
const { fetchCompanyDetailsByLinkedInURL } = require('../pressFundingAnnounements/fetchCompanyByDomain.js');
const { fetchProductLaunchSignals } = require('../pressFundingAnnounements/productLunchs.js');
const { fetchPublicMentions } = require('../pressFundingAnnounements/publicMentions.js');
const { fetchCompanyPosts } = require('../pressFundingAnnounements/fetchCompanyProfile.js');

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
    job_status: { type: String, enum: ["NOT_STARTED", "IN_PROGRESS", "SUCCESS", "COMPLETED", "FAILED"], default: "NOT_STARTED", required: true },
    job_id: { type: String, required: true, unique: true },
    job_created_at: { type: Date, default: Date.now, required: true },
    signal_data: { type: mongoose.Schema.Types.Mixed },
    signal_data_summary: { type: String },
    job_error: { type: mongoose.Schema.Types.Mixed },
    job_body: { type: String },
    request_id: { type: String, required: true }
});

const onepgrDB = mongoose.createConnection(url, { dbName: 'onepgr' });
const SignalAutomationJob = onepgrDB.model('signalAutomationJobs', signalAutomationJobsSchema);


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

        const jobs = await SignalAutomationJob.find(query);

        if (jobs.length === 0) {
            console.log(`No jobs found with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''}`);
            return res.json({ message: `No jobs with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''} found for this user.` });
        }

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
                            const insightsResponse = await getCompanyInsights({ companyName: job.contact_company });
                            const newsResponse = await fetchCompanyNews({ companyName: job.contact_company });
                            response = { insightsResponse, newsResponse };
                            break;
                        case 'job_openings':
                        case 'job_changes':
                            response = await processJobSignals({
                                linkedinUrl: job.contact_details?.co_linkedin,
                                companyName: job.contact_company
                            });
                            break;
                        case 'youtube_marketing_videos':
                            response = await fetchYouTubeVideos({ companyName: job.contact_company });
                            break;
                        case 'twitter_brand_mentions':
                            response = await fetchTwitterMentions({ companyName: job.contact_company });
                            break;
                        case 'public_mentions':
                            response = await fetchPublicMentions({ companyName: job.contact_company });
                            break;
                        case 'product_launches':
                            response = await fetchProductLaunchSignals({ linkedinUrl: job.contact_company });
                            break;
                        case 'linkedin_company_updates':
                        case 'activity_on_linkedin':
                            const postsUrl = job.contact_details?.co_linkedin?.trim();
                            if (!postsUrl) throw new Error('Invalid LinkedIn URL for company posts');
                            response = await fetchCompanyPosts(postsUrl);
                            break;
                        case 'contact_profile_information':
                            const companyUrl = job.contact_details?.co_linkedin?.trim();
                            if (!companyUrl) throw new Error('Invalid LinkedIn URL for company details');
                            response = await fetchCompanyDetailsByLinkedInURL(companyUrl);
                            break;
                        default:
                            console.warn(`Unknown signal_flag for job ID: ${job.job_id}`);
                            continue;
                    }

                    const jobStatus = determineJobStatus(response);
                    
                    await SignalAutomationJob.updateOne(
                        { _id: job._id },
                        {
                            job_status: jobStatus,
                            signal_data: response
                        }
                    );
                    console.log(`Job ID: ${job.job_id} updated with status: ${jobStatus}`);

                } catch (jobError) {
                    console.error(`Error occurred while processing job ID: ${job.job_id}`, jobError);
                    await SignalAutomationJob.updateOne(
                        { _id: job._id },
                        {
                            job_status: 'FAILED',
                            job_error: {
                                message: jobError.message,
                                timestamp: new Date()
                            }
                        }
                    );
                }
            }

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

        const statusCounts = await SignalAutomationJob.aggregate([
            { $match: { user_id, ...(request_id ? { request_id } : {}) } },
            {
                $group: {
                    _id: '$job_status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const summary = {
            NOT_STARTED: 0,
            IN_PROGRESS: 0,
            SUCCESS: 0,
            FAILED: 0
        };

        statusCounts.forEach(status => {
            summary[status._id] = status.count;
        });

        console.log('Summary of job statuses:', summary);

        res.json({
            jobs,
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

// Function to determine job status by checking all nested statuses
function determineJobStatus(response) {
    let hasError = false;
    let hasInProgress = false;
    let allSuccess = true;

    // Recursive function to check status within nested objects
    function checkStatus(obj) {
        if (typeof obj !== 'object' || obj === null) return;

        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                checkStatus(obj[key]);
            } else if (key === 'status') {
                if (obj[key] === "-1") {
                    hasError = true;
                } else if (obj[key] === "1") {
                    hasInProgress = true;
                    allSuccess = false;
                } else if (obj[key] !== "0") {
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


// async function fetchJobsByStatus(req, res) {
//     try {
//         const { user_id, job_status, request_id } = req.query;
//         console.log('Received:', { user_id, job_status, request_id });
//         if (!user_id) {
//             return res.status(400).json({ message: 'user_id is required' });
//         }

//         if (!job_status || !["NOT_STARTED", "IN_PROGRESS", "FAILED"].includes(job_status)) {
//             return res.status(400).json({ message: 'Valid job_status is required (NOT_STARTED, IN_PROGRESS, FAILED)' });
//         }

//         const query = { user_id, job_status };
//         if (request_id) {
//             query.request_id = request_id;
//         }

//         const jobs = await SignalAutomationJob.find({ job_status, user_id });

//         if (jobs.length === 0) {
//             console.log(`No jobs found with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''}`);
//             return res.json({ message: `No jobs with status ${job_status}${request_id ? ` and request_id ${request_id}` : ''} found for this user.` });
//         }


//         if (job_status === 'NOT_STARTED') {
//             for (const job of jobs) {
//                 try {
//                     let insightsResponse = null;
//                     let newsResponse = null;
//                     let response;
//                     // let hasError = false;
//                     let errorMessage = [];

//                     const getLinkedInUrl = (contactDetails) => {
//                         if (!contactDetails || !contactDetails.co_linkedin) return null;
//                         const url = contactDetails.co_linkedin;
//                         return typeof url === 'string' ? url.trim() : null;
//                     };

//                     switch (job.signal_flag) {
//                         case 'financial_information':
//                             const response10K = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-K' });
//                             const response10Q = await fetchLatestFiling({ companyName: job.contact_company, formType: '10-Q' });
//                             response = { form10K: response10K, form10Q: response10Q };
//                             break;
//                         case 'press_announcements':
//                             insightsResponse = await getCompanyInsights({ companyName: job.contact_company });
//                             newsResponse = await fetchCompanyNews({ companyName: job.contact_company });
//                             response = { insightsResponse, newsResponse };

//                             // Check for errors first
//                             if (insightsResponse.status === "-1" || newsResponse.status === "-1") {
//                                 hasError = true;
//                                 if (insightsResponse.status === "-1") {
//                                     errorMessage.push(`Insights Error: ${insightsResponse.message}`);
//                                 }
//                                 if (newsResponse.status === "-1") {
//                                     errorMessage.push(`News Error: ${newsResponse.message}`);
//                                 }

//                                 await SignalAutomationJob.updateOne(
//                                     { _id: job._id },
//                                     {
//                                         job_status: 'FAILED',
//                                         job_error: errorMessage.join(' | '),
//                                         signal_data: response
//                                     }
//                                 );
//                                 continue;
//                             }

//                             // If both responses have status "0", mark as SUCCESS
//                             if (insightsResponse.status === "0" && newsResponse.status === "0") {
//                                 await SignalAutomationJob.updateOne(
//                                     { _id: job._id },
//                                     {
//                                         job_status: 'SUCCESS',
//                                         signal_data: response
//                                     }
//                                 );
//                             }
//                             // If either response has status "1", mark as IN_PROGRESS
//                             else if (insightsResponse.status === "1" || newsResponse.status === "1") {
//                                 await SignalAutomationJob.updateOne(
//                                     { _id: job._id },
//                                     {
//                                         job_status: 'IN_PROGRESS',
//                                         signal_data: response
//                                     }
//                                 );
//                             }
//                             // For any other status combination, mark as IN_PROGRESS
//                             else {
//                                 await SignalAutomationJob.updateOne(
//                                     { _id: job._id },
//                                     {
//                                         job_status: 'IN_PROGRESS',
//                                         signal_data: response
//                                     }
//                                 );
//                             }
//                             break;
//                         case 'job_openings':
//                         case 'job_changes':
//                             response = await processJobSignals({
//                                 linkedinUrl: job.contact_details?.co_linkedin,
//                                 companyName: job.contact_company
//                             });
//                             break;
//                         case 'youtube_marketing_videos':
//                             response = await fetchYouTubeVideos({ companyName: job.contact_company });
//                             break;
//                         case 'twitter_brand_mentions':
//                             response = await fetchTwitterMentions({ companyName: job.contact_company });
//                             break;
//                         case 'public_mentions':
//                             response = await fetchPublicMentions({ companyName: job.contact_company });
//                             break;
//                         case 'product_launches':
//                             response = await fetchProductLaunchSignals({ linkedinUrl: job.contact_company });
//                             break;
//                         case 'linkedin_company_updates':
//                         case 'activity_on_linkedin':
//                             const postsUrl = getLinkedInUrl(job.contact_details);
//                             if (!postsUrl) {
//                                 throw new Error('Invalid LinkedIn URL for company posts');
//                             }
//                             console.log('Fetching company posts for LinkedIn URL:', postsUrl);
//                             response = await fetchCompanyPosts(postsUrl);
//                             break;

//                         case 'contact_profile_information':
//                             const companyUrl = getLinkedInUrl(job.contact_details);
//                             if (!companyUrl) {
//                                 throw new Error('Invalid LinkedIn URL for company details');
//                             }
//                             console.log('Fetching company details for LinkedIn URL:', companyUrl);
//                             // Pass URL string directly instead of object
//                             response = await fetchCompanyDetailsByLinkedInURL(companyUrl);
//                             break;



//                         default:
//                             console.warn(`Unknown signal_flag for job ID: ${job.job_id}`);
//                             continue;
//                     }

//                     // New logic to handle status "0" as SUCCESS
//                     // Handling the update based on the response status code
//                     if (response.status === "0") {
//                         await SignalAutomationJob.updateOne(
//                             { _id: job._id },
//                             {
//                                 job_status: 'SUCCESS',
//                                 signal_data: response
//                             }
//                         );
//                     } else if (response.status === "-1") {
//                         await SignalAutomationJob.updateOne(
//                             { _id: job._id },
//                             {
//                                 job_status: 'FAILED',
//                                 job_error: response,
//                                 signal_data: response
//                             }
//                         );
//                     } else if (response.status === "1") {

//                         await SignalAutomationJob.updateOne(
//                             { _id: job._id },
//                             {
//                                 job_status: 'IN_PROGRESS',
//                                 signal_data: response
//                             }
//                         );
//                     } else {
//                         await SignalAutomationJob.updateOne(
//                             { _id: job._id },
//                             {
//                                 signal_data: response,
//                                 job_status: 'IN_PROGRESS'
//                             }
//                         )
//                     }
//                 } catch (jobError) {
//                     console.error(`Error occurred while processing job ID: ${job.job_id}`, jobError);
//                     await SignalAutomationJob.updateOne(
//                         { _id: job._id },
//                         {
//                             job_status: 'FAILED',
//                             job_error: {
//                                 message: jobError.message,
//                                 timestamp: new Date()
//                             }
//                         }
//                     );
//                 }
//             }

//             try {
//                 await summarizeSignalData({ query: { user_id, request_id } }, {
//                     json: () => { },
//                     status: () => ({ json: () => { } })
//                 });
//                 console.log('Summarization completed for user:', { user_id, request_id });
//             } catch (summaryError) {
//                 console.error('Error during summarization:', summaryError);
//             }
//         }

//         // // Update query to include SUCCESS status in results
//         // const updatedJobs = await SignalAutomationJob.find({
//         //     user_id,
//         //     $or: [
//         //         { job_status: job_status },
//         //         ...(job_status === 'NOT_STARTED' ? [
//         //             { job_status: 'IN_PROGRESS' },
//         //             { job_status: 'SUCCESS' }
//         //         ] : [])
//         //     ]
//         // });

//         const statusCounts = await SignalAutomationJob.aggregate([
//             { $match: { user_id, ...(request_id ? { request_id } : {}) } },
//             {
//                 $group: {
//                     _id: '$job_status',
//                     count: { $sum: 1 }
//                 }
//             }
//         ]);

//         console.log('Aggregated Status Counts:', statusCounts); // This will show what MongoDB is returning


//         console.log('\n=== Job Status Summary ===');
//         console.log('User ID:', user_id);
//         const summary = {
//             NOT_STARTED: 0,
//             IN_PROGRESS: 0,
//             SUCCESS: 0,
//             FAILED: 0
//         };

//         statusCounts.forEach(status => {
//             summary[status._id] = status.count;
//         });

//         console.log('NOT_STARTED jobs:', summary.NOT_STARTED);
//         console.log('IN_PROGRESS jobs:', summary.IN_PROGRESS);
//         console.log('SUCCESS jobs:', summary.SUCCESS);
//         console.log('FAILED jobs:', summary.FAILED);

//         console.log('========================\n');

//         console.log(`Fetched ${jobs.length} jobs for user_id: ${user_id}, job_status: ${job_status}${request_id ? `, request_id: ${request_id}` : ''}`);
//         res.json({
//             jobs,
//             message: `${jobs.length} jobs fetched successfully.`
//         });


//     } catch (error) {
//         console.error('Critical Error in fetchJobsByStatus:', error);
//         res.status(500).json({
//             error: 'An error occurred while fetching the jobs.',
//             details: error.message
//         });
//     }
// }


async function summarizeSignalData(req, res) {
    try {
        const { user_id, request_id } = req.query;

        if (!user_id || !request_id) {
            return res.status(400).json({ message: 'user_id and request_id are required' });
        }

        console.log('Starting summarizeSignalData for user:', user_id, 'and request_id:', request_id);
        const jobs = await SignalAutomationJob.find({ job_status: 'IN_PROGRESS', user_id, request_id });

        if (jobs.length === 0) {
            return res.json({ message: `No IN_PROGRESS jobs found for user ${user_id} with request_id ${request_id}.` });
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
                        case 'youtube_marketing_videos':
                            promptTemplate = `Summarize the recent YouTube content from ${job.contact_company}. Focus on video engagement, key themes, and notable metrics: `;
                            break;
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

//fetchAllJobsByUser 
async function fetchAllJobsByUser(req, res) {
    try {
        const { user_id, request_id } = req.query;

        // Validate query parameters
        if (!user_id || !request_id) {
            return res.status(400).json({ 
                message: 'Both user_id and request_id are required.' 
            });
        }

        // Fetch jobs based on user_id and request_id
        const jobs = await SignalAutomationJob.find({ user_id, request_id });

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


//changeJobStatusToNotStarted
async function changeJobStatusToNotStarted(req, res) {
    try {
        const { user_id, request_id } = req.body;
        console.log('Received:', { user_id, request_id });

        if (!user_id || !request_id) {
            return res.status(400).json({ message: 'Both user_id and request_id are required.' });
        }

        // Correcting the query to use $in for multiple job_status values
        const query = {
            user_id,
            request_id,
            job_status: { $in: ['FAILED', 'IN_PROGRESS', 'SUCCESS'] }
        };

        const updatedJobs = await SignalAutomationJob.updateMany(
            query,
            {
                $set: {
                    job_status: 'NOT_STARTED',
                    signal_data: null,
                    signal_data_summary: null,
                    job_error: null
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
//fetchFailedJobs
async function fetchFailedJobs(req, res) {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ message: 'user_id is required' });
        }

        const jobs = await SignalAutomationJob.find({
            user_id,
            job_status: 'FAILED'
        });

        if (jobs.length === 0) {
            console.log(`No FailedJobs jobs found for user_id: ${user_id}`);
            return res.json({
                message: `No FailedJobs jobs found for user_id ${user_id}.`,
                jobs: []
            });
        }

        console.log(`Fetched ${jobs.length} FailedJobsjobs for user_id: ${user_id}`);
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
// router.post('/resetAllJobsToNotStarted', resetAllJobsToNotStarted);


module.exports = {
    router,
    fetchAllJobsByUser,
    fetchJobsByStatus,
    summarizeSignalData,
    changeJobStatusToNotStarted,
    fetchFailedJobs
};
