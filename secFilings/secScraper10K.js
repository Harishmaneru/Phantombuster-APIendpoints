const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const USER_AGENT = 'onepgr (harish@onepgr.us)';
const RATE_LIMIT_DELAY = 3000;   

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

function normalizeName(name) {
  return name.toLowerCase().replace(/[\s\.,-\/#!$%\^&\*;:{}=\-_`~()]/g, '');
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
    
    const paddedCik = company.cik_str.toString().padStart(10, '0');
    logger.info(`Found CIK for ${ticker}: ${paddedCik}`);
    return paddedCik;
  } catch (error) {
    logger.error(`Error fetching CIK for ${ticker}`, error);
    throw error;
  }
}

async function getTickerFromCompanyName(companyName) {
  logger.info(`Fetching ticker for company name: ${companyName}`);
  const url = 'https://www.sec.gov/files/company_tickers.json';
  try {
    const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
    const companies = Object.values(response.data);
    const normalizedInput = normalizeName(companyName);
    
    // Try an exact normalized match
    let match = companies.find(c => normalizeName(c.title) === normalizedInput);
    
    // Fallback: check if normalized company name includes the input
    if (!match) {
      match = companies.find(c => normalizeName(c.title).includes(normalizedInput));
    }
    
    if (!match) {
      logger.error(`Company with name "${companyName}" not found in SEC database`);
      throw new Error('Company not found');
    }
    logger.info(`Found ticker for "${companyName}": ${match.ticker}`);
    return match.ticker;
  } catch (error) {
    logger.error(`Error fetching ticker for company name: ${companyName}`, error);
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
    
    // Filter by filing year if range provided.
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
          filingUrl: htmlUrl
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


async function fetchFilings10K(  identifier,
  formTypes = ['10-K'],
  startYear = new Date().getFullYear() - 3,
  endYear = new Date().getFullYear()
) {
  try {
    // Resolve identifier to ticker and CIK.
    // First try as ticker; if that fails, try as company name.
    let ticker, cik;
    try {
      ticker = identifier.toUpperCase();
      cik = await getCIK(ticker);
    } catch (e) {
      // Fallback to resolving by company name.
      ticker = await getTickerFromCompanyName(identifier);
      cik = await getCIK(ticker);
    }
    
    const filings = await getFilings(cik, formTypes, startYear, endYear);
    const results = [];
    for (let i = 0; i < filings.length; i++) {
      const filing = filings[i];
      if (i > 0) await delay(RATE_LIMIT_DELAY);
      try {
        const content = await downloadFiling(cik, filing);
        const htmlUrl = buildFilingUrl(cik, filing.accession, ticker, content);
        results.push({
          form: filing.form,
          date: filing.date,
          accession: filing.accession,
          contentSnippet: content.substring(0, 500),
          filingUrl: htmlUrl
        });
      } catch (error) {
        results.push({
          form: filing.form,
          date: filing.date,
          accession: filing.accession,
          error: error.message
        });
      }
    }
    if (results.length === 0) {
      return {
        status: 0,
        message: 'No filings found',
        ticker,
        cik,
        filings: []
      };
    }
    return {
      status: 1,
      message: 'Success',
      ticker,
      cik,
      filings: results
    };
  } catch (error) {
    return {
      status: 0,
      message: error.message,
      // error: error.message
    };
  }
}

// router.get('/10-Kfilings/:identifier', async (req, res) => {
//   const startTime = Date.now();
//   const { identifier } = req.params;
  
//   logger.info(`Received request for identifier: ${identifier}`);
//   logger.debug('Request query parameters:', req.query);
  
//   try {
//     let formTypes = req.query.formType 
//       ? req.query.formType.split(',').map(f => f.trim()) 
//       : ['10-K'];
    
//     const currentYear = new Date().getFullYear();
//     const startYear = req.query.startYear ? parseInt(req.query.startYear) : currentYear - 3;
//     const endYear = req.query.endYear ? parseInt(req.query.endYear) : currentYear;
    
//     logger.info(`Processing request: identifier=${identifier}, formTypes=${formTypes.join(',')}, years=${startYear}-${endYear}`);
    
//     const result = await fetchFilings10K(identifier, formTypes, startYear, endYear);
//     const responseTime = Date.now() - startTime;
//     logger.info(`Successfully completed request for ${identifier} in ${responseTime}ms, found ${result.filings.length} filings`);
    
//     res.json({
//       ...result,
//       executionTime: responseTime
//     });
//   } catch (error) {
//     const responseTime = Date.now() - startTime;
//     logger.error(`Request failed for ${identifier} after ${responseTime}ms`, error);
//     res.status(500).json({
//       status: -1,
//       message: 'Unexpected error occurred',
//       error: error.message,
//       executionTime: responseTime
//     });
//   }
// });

router.get('/10-Kfilings/:identifier', async (req, res) => {
  const startTime = Date.now();
  const { identifier } = req.params;
  
  logger.info(`Received request for identifier: ${identifier}`);
  logger.debug('Request query parameters:', req.query);
  
  try {
    let formTypes = req.query.formType 
      ? req.query.formType.split(',').map(f => f.trim()) 
      : ['10-K'];
    
    const currentYear = new Date().getFullYear();
    const startYear = req.query.startYear ? parseInt(req.query.startYear) : currentYear - 3;
    const endYear = req.query.endYear ? parseInt(req.query.endYear) : currentYear;
    
    logger.info(`Processing request: identifier=${identifier}, formTypes=${formTypes.join(',')}, years=${startYear}-${endYear}`);
    
    const result = await fetchFilings10K(identifier, formTypes, startYear, endYear);
    const responseTime = Date.now() - startTime;
    
    // Check if result.filings exists before accessing its length
    const filingsCount = result.filings ? result.filings.length : 0;
    logger.info(`Successfully completed request for ${identifier} in ${responseTime}ms, found ${filingsCount} filings`);
    
    res.json({
      ...result,
      executionTime: responseTime
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`Request failed for ${identifier} after ${responseTime}ms`, error);
    res.status(500).json({
      status: 0,
      message: error.message || `${identifier} not found in SEC database`,
      // error: error.message,
      executionTime: responseTime
    });
  }
});

module.exports = {
  router,
  fetchFilings10K,
  getTickerFromCompanyName, 
  getCIK,
  getFilings,
  downloadFiling,
  fetchFilings,
  extractConformedPeriod,
  buildFilingUrl,
  getTickerFromCompanyName
};
