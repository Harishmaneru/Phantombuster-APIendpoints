const fs = require('fs');
const axios = require('axios');
const express = require('express');
const router = express.Router();

const SEC_API_KEY = 'a4b8d2116974c6ed4fed5d5d5a3088e5a003055cc864eaf77fb0562b95c73ed6';

// Download filing as PDF
router.post('/download-filing', async (req, res) => {
    const { filingUrl, fileName } = req.body;
    console.log('Received request:', req.body);
    if (!filingUrl || !fileName) {
        return res.status(400).json({ error: 'Filing URL and file name are required.' });
    }

    try {
        const response = await axios.get(
            `https://api.sec-api.io/filing-reader?token=${SEC_API_KEY}&url=${encodeURIComponent(filingUrl)}`,
            {
                headers: { Accept: 'application/pdf' },
                responseType: 'stream'
            }
        );

        const filePath = `./${fileName}.pdf`;
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        writer.on('finish', () => {
            console.log(`PDF downloaded successfully as ${filePath}`);
            res.status(200).json({ message: 'PDF downloaded successfully.', filePath });
        });

        writer.on('error', (error) => {
            console.error('Error writing PDF file:', error.message);
            res.status(500).json({ error: 'Failed to save the PDF.' });
        });
    } catch (error) {
        console.error('Error downloading PDF:', error.message);
        res.status(500).json({ error: 'Failed to download PDF.' });
    }
});

module.exports = router;
