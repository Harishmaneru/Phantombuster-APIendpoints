

// const express = require('express');
// const router = express.Router();
// const fs = require('fs').promises;
// const path = require('path');
// const axios = require('axios');

// const USER_AGENT = 'onepgr (harish@onepgr.us)';
// const RATE_LIMIT_DELAY = 3000; // milliseconds

 
// function delay(ms) {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }

 
// async function getCIK(ticker) {
//   const url = 'https://www.sec.gov/files/company_tickers.json';
//   const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
//   const companies = Object.values(response.data);
//   const company = companies.find(c => c.ticker.toUpperCase() === ticker.toUpperCase());
//   if (!company) {
//     throw new Error('Company not found');
//   }
//   // Pad CIK to 10 digits
//   return company.cik_str.toString().padStart(10, '0');
// }

// /**
//  * Fetches recent filings from SEC submissions filtered by form types and filing date range.
//  * @param {string} cik - The padded CIK.
//  * @param {Array<string>} formTypes - Array of form types (e.g. ["10-K", "10-Q"]).
//  * @param {number} startYear - Minimum filing year (inclusive).
//  * @param {number} endYear - Maximum filing year (inclusive).
//  * @returns {Array<object>} Filtered filings.
//  */
// async function getFilings(cik, formTypes, startYear, endYear) {
//   const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
//   const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
//   const data = response.data;
//   const filings = data.filings.recent;
//   let filtered = filings.form
//     .map((form, index) => ({
//       form,
//       date: filings.filingDate[index],
//       accession: filings.accessionNumber[index]
//     }))
//     .filter(f => formTypes.includes(f.form));
  
//   // If date range filtering is provided, filter filings by the filing year.
//   if (startYear && endYear) {
//     filtered = filtered.filter(f => {
//       const filingYear = parseInt(f.date.substring(0, 4));
//       return filingYear >= startYear && filingYear <= endYear;
//     });
//   }
//   return filtered;
// }

// /**
//  * Downloads a filing text given its CIK and filing metadata.
//  */
// async function downloadFiling(cik, filing) {
//   const accessionNoDash = filing.accession.replace(/-/g, '');
//   const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${filing.accession}.txt`;
//   const response = await axios.get(filingUrl, { headers: { 'User-Agent': USER_AGENT } });
//   return response.data;
// }

// /**
//  * Extracts the conformed period (YYYYMMDD) from a content snippet.
//  * It splits the snippet into lines and searches (case-insensitively) for a line
//  * that mentions "conformed period of report", then extracts the first 8-digit number.
//  *
//  * @param {string} contentSnippet - The snippet of filing text.
//  * @returns {string|null} The extracted conformed period or null if not found.
//  */
// function extractConformedPeriod(contentSnippet) {
//   const lines = contentSnippet.split(/\r?\n/);
//   for (const line of lines) {
//     if (/conformed period of report/i.test(line)) {
//       const match = line.match(/(\d{8})/);
//       if (match) {
//         return match[1];
//       }
//     }
//   }
//   return null;
// }

// /**
//  * Constructs the HTML filing URL.
//  *
//  * @param {string} cik - The company's CIK.
//  * @param {string} accession - The filing's accession number.
//  * @param {string} ticker - The company ticker.
//  * @param {string} contentSnippet - The filing content snippet containing the conformed period.
//  * @returns {string|null} The constructed filing URL or null if the conformed period isn’t found.
//  */
// function buildFilingUrl(cik, accession, ticker, contentSnippet) {
//   const conformedPeriod = extractConformedPeriod(contentSnippet);
//   if (!conformedPeriod) {
//     console.error('Conformed period not found in the snippet.');
//     return null;
//   }
//   const accessionNoDash = accession.replace(/-/g, '');
//   return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${ticker.toLowerCase()}-${conformedPeriod}.htm`;
// }

// /**
//  * Main function to fetch filings for a given ticker and form types within a date range.
//  * @param {string} ticker - The company ticker.
//  * @param {Array<string>} formTypes - Array of form types (e.g. ["10-K", "10-Q"]).
//  * @param {number} startYear - Minimum filing year.
//  * @param {number} endYear - Maximum filing year.
//  * @returns {object} An object containing the CIK and an array of filings.
//  */
// async function fetchFilings(ticker, formTypes, startYear, endYear) {
//   const cik = await getCIK(ticker);
//   const filings = await getFilings(cik, formTypes, startYear, endYear);
//   const results = [];
//   for (const filing of filings) {
//     await delay(RATE_LIMIT_DELAY);
//     try {
//       const content = await downloadFiling(cik, filing);
//       const htmlUrl = buildFilingUrl(cik, filing.accession, ticker, content);
//       results.push({
//         form: filing.form,
//         date: filing.date,
//         accession: filing.accession,
//         contentSnippet: content.substring(0, 500),
//         htmlUrl: htmlUrl
//       });
//     } catch (err) {
//       console.error(`Error downloading filing ${filing.accession}: ${err.message}`);
//       results.push({
//         form: filing.form,
//         date: filing.date,
//         accession: filing.accession,
//         error: err.message
//       });
//     }
//   }
//   return { cik, filings: results };
// }

// // Express route endpoint to fetch filings for a given ticker.
// router.get('/filings/:ticker', async (req, res) => {
//   try {
//     const { ticker } = req.params;
    
//     // Accept comma-separated form types (default: "10-K")
//     let formTypes = req.query.formType || '10-K';
//     if (formTypes.indexOf(',') !== -1) {
//       formTypes = formTypes.split(',').map(f => f.trim());
//     } else {
//       formTypes = [formTypes];
//     }
    
//     // Date filtering: use query parameters or default to last 5 years.
//     const currentYear = new Date().getFullYear();
//     const startYear = req.query.startYear ? parseInt(req.query.startYear) : currentYear - 5;
//     const endYear = req.query.endYear ? parseInt(req.query.endYear) : currentYear;
    
//     const result = await fetchFilings(ticker, formTypes, startYear, endYear);
//     res.json({
//       success: true,
//       ticker: ticker.toUpperCase(),
//       cik: result.cik,
//       filings: result.filings
//     });
//   } catch (error) {
//     console.error(`Error processing request: ${error.message}`);
//     res.status(500).json({
//       success: false,
//       error: error.message,
//       ticker: req.params.ticker.toUpperCase()
//     });
//   }
// });

// module.exports = {
//   router,
//   getCIK,
//   getFilings,
//   downloadFiling,
//   fetchFilings,
//   extractConformedPeriod,
//   buildFilingUrl
// };


const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const USER_AGENT = 'onepgr (harish@onepgr.us)';
const RATE_LIMIT_DELAY = 3000; // milliseconds

// Setup basic logging utility
const logger = {
  info: (message) => {
    console.log(`[INFO ${new Date().toISOString()}] ${message}`);
  },
  error: (message, error) => {
    console.error(`[ERROR ${new Date().toISOString()}] ${message}`, error);
  },
  debug: (message, data = null) => {
    console.log(`[DEBUG ${new Date().toISOString()}] ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
  }
};

function delay(ms) {
  logger.debug(`Delaying for ${ms}ms to respect rate limits`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCIK(ticker) {
  logger.info(`Fetching CIK for ticker: ${ticker}`);
  const url = 'https://www.sec.gov/files/company_tickers.json';
  try {
    logger.debug(`Requesting data from ${url}`);
    const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const companies = Object.values(response.data);
    logger.debug(`Found ${companies.length} companies in SEC database`);
    
    const company = companies.find(c => c.ticker.toUpperCase() === ticker.toUpperCase());
    if (!company) {
      logger.error(`Company with ticker ${ticker} not found in SEC database`);
      throw new Error('Company not found');
    }
    
    // Pad CIK to 10 digits
    const paddedCik = company.cik_str.toString().padStart(10, '0');
    logger.info(`Found CIK for ${ticker}: ${paddedCik}`);
    return paddedCik;
  } catch (error) {
    logger.error(`Error fetching CIK for ${ticker}`, error);
    throw error;
  }
}

async function getFilings(cik, formTypes, startYear, endYear) {
  logger.info(`Fetching filings for CIK: ${cik}, forms: ${formTypes.join(', ')}, years: ${startYear}-${endYear}`);
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  
  try {
    logger.debug(`Requesting filing data from ${url}`);
    const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = response.data;
    
    if (!data.filings || !data.filings.recent) {
      logger.error(`No filings data found for CIK: ${cik}`);
      return [];
    }
    
    const filings = data.filings.recent;
    logger.debug(`Found ${filings.form.length} recent filings`);
    
    let filtered = filings.form
      .map((form, index) => ({
        form,
        date: filings.filingDate[index],
        accession: filings.accessionNumber[index]
      }))
      .filter(f => formTypes.includes(f.form));
    
    logger.debug(`Filtered to ${filtered.length} filings of requested types`);
    
    // If date range filtering is provided, filter filings by the filing year.
    if (startYear && endYear) {
      filtered = filtered.filter(f => {
        const filingYear = parseInt(f.date.substring(0, 4));
        return filingYear >= startYear && filingYear <= endYear;
      });
      logger.debug(`Further filtered to ${filtered.length} filings within date range ${startYear}-${endYear}`);
    }
    
    return filtered;
  } catch (error) {
    logger.error(`Error fetching filings for CIK: ${cik}`, error);
    throw error;
  }
}

async function downloadFiling(cik, filing) {
  logger.info(`Downloading filing: ${filing.form} from ${filing.date}, accession: ${filing.accession}`);
  const accessionNoDash = filing.accession.replace(/-/g, '');
  const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${filing.accession}.txt`;
  
  try {
    logger.debug(`Requesting filing content from ${filingUrl}`);
    const response = await axios.get(filingUrl, { headers: { 'User-Agent': USER_AGENT } });
    logger.debug(`Successfully downloaded filing content (${response.data.length} bytes)`);
    return response.data;
  } catch (error) {
    logger.error(`Error downloading filing from ${filingUrl}`, error);
    throw error;
  }
}

function extractConformedPeriod(contentSnippet) {
  logger.debug('Extracting conformed period from content snippet');
  const lines = contentSnippet.split(/\r?\n/);
  for (const line of lines) {
    if (/conformed period of report/i.test(line)) {
      const match = line.match(/(\d{8})/);
      if (match) {
        logger.debug(`Found conformed period: ${match[1]}`);
        return match[1];
      }
    }
  }
  logger.error('Conformed period not found in content snippet');
  return null;
}

function buildFilingUrl(cik, accession, ticker, contentSnippet) {
  logger.info(`Building HTML filing URL for ${ticker}, accession: ${accession}`);
  const conformedPeriod = extractConformedPeriod(contentSnippet);
  if (!conformedPeriod) {
    logger.error('Conformed period not found in the snippet, cannot build HTML URL');
    return null;
  }
  
  const accessionNoDash = accession.replace(/-/g, '');
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${ticker.toLowerCase()}-${conformedPeriod}.htm`;
  logger.debug(`Built HTML filing URL: ${url}`);
  return url;
}

async function fetchFilings(ticker, formTypes, startYear, endYear) {
  logger.info(`Starting filing fetch process for ${ticker}, form types: ${formTypes.join(', ')}, years: ${startYear}-${endYear}`);
  
  try {
    const cik = await getCIK(ticker);
    logger.debug(`Retrieved CIK: ${cik} for ticker: ${ticker}`);
    
    const filings = await getFilings(cik, formTypes, startYear, endYear);
    logger.info(`Found ${filings.length} filings matching criteria`);
    
    const results = [];
    for (let i = 0; i < filings.length; i++) {
      const filing = filings[i];
      logger.info(`Processing filing ${i+1}/${filings.length}: ${filing.form} from ${filing.date}`);
      
      if (i > 0) {
        logger.debug(`Waiting ${RATE_LIMIT_DELAY}ms before next request to respect SEC rate limits`);
        await delay(RATE_LIMIT_DELAY);
      }
      
      try {
        const content = await downloadFiling(cik, filing);
        const htmlUrl = buildFilingUrl(cik, filing.accession, ticker, content);
        
        results.push({
          form: filing.form,
          date: filing.date,
          accession: filing.accession,
          contentSnippet: content.substring(0, 500),
          htmlUrl: htmlUrl
        });
        
        logger.debug(`Successfully processed filing ${filing.accession}`);
      } catch (err) {
        logger.error(`Error downloading filing ${filing.accession}`, err);
        results.push({
          form: filing.form,
          date: filing.date,
          accession: filing.accession,
          error: err.message
        });
      }
    }
    
    logger.info(`Completed fetching all filings for ${ticker}`);
    return { cik, filings: results };
  } catch (error) {
    logger.error(`Fatal error in fetchFilings for ${ticker}`, error);
    throw error;
  }
}

 
router.get('/filings/:ticker', async (req, res) => {
  const startTime = Date.now();
  const { ticker } = req.params;
  
  logger.info(`Received request for ticker: ${ticker}`);
  logger.debug('Request query parameters:', req.query);
  
  try {
    
    let formTypes = req.query.formType || '10-K';
    if (formTypes.indexOf(',') !== -1) {
      formTypes = formTypes.split(',').map(f => f.trim());
    } else {
      formTypes = [formTypes];
    }
    
    
    const currentYear = new Date().getFullYear();
    const startYear = req.query.startYear ? parseInt(req.query.startYear) : currentYear - 3;
    const endYear = req.query.endYear ? parseInt(req.query.endYear) : currentYear;
    
    logger.info(`Processing request: ticker=${ticker}, formTypes=${formTypes.join(',')}, years=${startYear}-${endYear}`);
    
    const result = await fetchFilings(ticker, formTypes, startYear, endYear);
    
    const responseTime = Date.now() - startTime;
    logger.info(`Successfully completed request for ${ticker} in ${responseTime}ms, found ${result.filings.length} filings`);
    
    res.json({
      success: true,
      ticker: ticker.toUpperCase(),
      cik: result.cik,
      filings: result.filings
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`Request failed for ${ticker} after ${responseTime}ms`, error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      ticker: req.params.ticker.toUpperCase()
    });
  }
});

module.exports = {
  router,
  getCIK,
  getFilings,
  downloadFiling,
  fetchFilings,
  extractConformedPeriod,
  buildFilingUrl
};