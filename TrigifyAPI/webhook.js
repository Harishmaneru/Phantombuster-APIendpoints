// const express = require('express');
// const router = express.Router();

// router.post('/trigify-webhook', (req, res) => {
//     const payload = req.body;

//     // Log the full payload
//     console.log('Full Payload:', JSON.stringify(payload, null, 2));

//     // Access the first result for verification
//     const result = payload.results[0];

//     // Log specific fields for clarity
//     if (result) {
//         console.log('Prospect:', JSON.stringify(result.prospect, null, 2));
//         console.log('LinkedIn Engagement:', JSON.stringify(result.linkedin_engagement, null, 2));
//     } else {
//         console.log('No results found in payload.');
//     }

//     res.status(200).send('Webhook received and processed!');
// });


const express = require('express');
const app = express();
const router = express.Router();


router.post('/trigify-webhook', (req, res) => {
    const payload = req.body;

    try {
        const results = payload.results.map((result) => {
            const {
                prospect,
                linkedin_engagement,
                company,
                first_name,
                last_name,
                job_title,
                job_company_name,
                location_name,
            } = result;

            // Process Prospect Details
            const prospectDetails = {
                fullName: prospect?.full_name || `${first_name} ${last_name}`,
                gender: prospect?.gender || '',
                location: prospect?.location_name || location_name,
                linkedinURL: prospect?.linkedin_url || '',
                industry: prospect?.industry || '',
                jobTitle: job_title || prospect?.job_title || '',
                companyName: job_company_name || prospect?.job_company_name || '',
                companyWebsite: prospect?.job_company_website || '',
            };

            // Process LinkedIn Engagement
            const engagementDetails = linkedin_engagement.map((engagement) => ({
                type: engagement.type,
                text: engagement.text,
                postURL: engagement.linkedin_post?.post_url || '',
                postText: engagement.linkedin_post?.text || '',
                postDate: engagement.linkedin_post?.posted_date || '',
            }));

            // Process Company Details
            const companyDetails = {
                name: company?.name || '',
                industry: company?.industry || '',
                description: company?.description || '',
                location: company?.location || '',
                linkedinURL: company?.linkedin_url || '',
                employeesCount: company?.employees_count || '',
                revenue: company?.revenue || '',
                technologies: company?.technologies || [],
                logo: company?.company_logo || '',
            };

            return {
                prospect: prospectDetails,
                linkedinEngagement: engagementDetails,
                company: companyDetails,
            };
        });

        console.log('Formatted Results:', JSON.stringify(results, null, 2));

        // Respond back with the formatted data
        res.status(200).json({
            message: 'Data processed successfully',
            data: results,
        });
    } catch (error) {
        console.error('Error processing payload:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



module.exports = router;