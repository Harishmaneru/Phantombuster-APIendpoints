const express = require('express');
const axios = require('axios');
const { fetchCompanyInfo } = require('../rapidAPI/companyInfo');
const router = express.Router();

async function fetchCompanyEmployees(companyId, page = 1) {
    try {
        const response = await axios.get(`https://linkedin-bulk-data-scraper.p.rapidapi.com/company_employee?companyId=${companyId}&page=${page}`, {
            headers: {
                'x-rapidapi-host': 'linkedin-bulk-data-scraper.p.rapidapi.com',
                'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
            }
        });

        // console.log("API Response:", JSON.stringify(response.data, null, 2));

        if (response.data.success && response.data.status === 200) {
            if (response.data.data.results.length === 0) {
                return 0;  // No employees found
            }
            return response.data.data.results.map(profile => profile.profileUrn);
        } else {
            throw new Error(response.data.message || "Failed to fetch company employees.");
        }
    } catch (error) {
        console.error("Error fetching company employees:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || "Error fetching company employees.");
    }
}

async function fetchEmployeeDetails(profileUrns) {
    try {
        const response = await axios.post('https://mtn-linkedin-bulk-data-api.p.rapidapi.com/api/person/bulk/urn', {
            links: profileUrns.map(urn => `https://linkedin.com/in/${urn}`)
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': 'mtn-linkedin-bulk-data-api.p.rapidapi.com',
                'x-rapidapi-key': '989f4f415emsh61990bfbf21063fp14c1a4jsn58f1c4a73736'
            }
        });

        console.log("Employee details API response:", response.data);
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error("Error fetching employee details:", error.response?.data || error.message);
        throw new Error(error.response?.data?.message || "Error fetching employee details.");
    }
}

router.post('/getLinkedInEmployees', async (req, res) => {
    const { linkedinUrl, page } = req.body;  // Accept page dynamically if passed, default to 1

    try {
        console.log("Fetching company information for URL:", linkedinUrl);
        const companyInfo = await fetchCompanyInfo(linkedinUrl);

        if (!companyInfo?.Company_Profile?.data?.company_id) {
            return res.status(200).json({
                status: 0,
                message: companyInfo.Company_Profile?.message || "Company not found on LinkedIn."
            });
        }

        const companyId = companyInfo.Company_Profile.data.company_id;
        console.log("Company ID fetched:", companyId);

        const profileUrns = await fetchCompanyEmployees(companyId, page || 1);

        if (profileUrns === 0) {
            return res.status(200).json({ status: 0, message: "No employees found." });
        }

        console.log("Fetched profile URNs:", profileUrns);
        const employeeDetails = await fetchEmployeeDetails(profileUrns);

        res.status(200).json({
            status: 1,
            data: employeeDetails.data
        });
    } catch (error) {
        console.error("Error in /getLinkedInEmployees endpoint:", error.message);
        res.status(500).json({ status: -1, message: error.message });
    }
});

module.exports = { router, getLinkedInEmployees: router };
