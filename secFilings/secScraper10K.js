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

/**
 * Returns a promise that resolves after a given number of milliseconds.
 */
function delay(ms) {
  logger.debug(`Delaying for ${ms}ms to respect rate limits`);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalizes a string by converting to lowercase and removing spaces and punctuation.
 */
function normalizeName(name) {
  return name.toLowerCase().replace(/[\s\.,-\/#!$%\^&\*;:{}=\-_`~()]/g, '');
}

/**
 * Retrieves the CIK for a given ticker from the SEC company tickers JSON.
 */
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

/**
 * Retrieves the ticker symbol from the SEC company tickers JSON using a company name.
 * The function normalizes both the input and each company's name for a forgiving match.
 * @param {string} companyName - The company name to search for.
 * @returns {string} The matching ticker symbol.
 */
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
      throw new Error('Company not found by name');
    }
    logger.info(`Found ticker for "${companyName}": ${match.ticker}`);
    return match.ticker;
  } catch (error) {
    logger.error(`Error fetching ticker for company name: ${companyName}`, error);
    throw error;
  }
}

/**
 * Fetches recent filings from SEC submissions filtered by form types and filing date range.
 * @param {string} cik - The padded CIK.
 * @param {Array<string>} formTypes - Array of form types (e.g. ["10-K", "10-Q"]).
 * @param {number} startYear - Minimum filing year (inclusive).
 * @param {number} endYear - Maximum filing year (inclusive).
 * @returns {Array<object>} Filtered filings.
 */
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

/**
 * Downloads a filing text given its CIK and filing metadata.
 */
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

/**
 * Extracts the conformed period (YYYYMMDD) from a content snippet.
 * Splits the snippet into lines and searches (case-insensitively) for a line containing
 * "conformed period of report", then extracts the first 8-digit number.
 *
 * @param {string} contentSnippet - The snippet of filing text.
 * @returns {string|null} The extracted conformed period or null if not found.
 */
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

/**
 * Constructs the HTML filing URL.
 *
 * @param {string} cik - The company's CIK.
 * @param {string} accession - The filing's accession number.
 * @param {string} ticker - The company ticker.
 * @param {string} contentSnippet - The filing content snippet containing the conformed period.
 * @returns {string|null} The constructed filing URL or null if the conformed period isn’t found.
 */
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

/**
 * Main function to fetch filings for a given ticker and form types within a date range.
 * @param {string} ticker - The company ticker.
 * @param {Array<string>} formTypes - Array of form types (e.g. ["10-K", "10-Q"]).
 * @param {number} startYear - Minimum filing year.
 * @param {number} endYear - Maximum filing year.
 * @returns {object} An object containing the CIK and an array of filings.
 */
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

/**
 * Fetch filings by company name.
 * This function converts a company name to a ticker symbol and then calls fetchFilings.
 * @param {string} identifier - The company name or ticker.
 * @param {Array<string>} formTypes - Array of form types.
 * @param {number} startYear - Minimum filing year.
 * @param {number} endYear - Maximum filing year.
 * @returns {object} An object containing the CIK and filings.
 */
async function fetchFilingsWithStatus(identifier, formTypes, startYear, endYear) {
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
      status: -1,
      message: error.message,
      error: error.stack
    };
  }
}

// Express route endpoint for ticker/company name-based queries.
// Endpoint: /10-Kfilings/:identifier
// Accepts query parameters: formType (comma-separated, default: "10-K"),
// startYear, and endYear.
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
    
    const result = await fetchFilingsWithStatus(identifier, formTypes, startYear, endYear);
    const responseTime = Date.now() - startTime;
    logger.info(`Successfully completed request for ${identifier} in ${responseTime}ms, found ${result.filings.length} filings`);
    
    res.json({
      ...result,
      executionTime: responseTime
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`Request failed for ${identifier} after ${responseTime}ms`, error);
    res.status(500).json({
      status: -1,
      message: 'Unexpected error occurred',
      error: error.message,
      executionTime: responseTime
    });
  }
});

module.exports = {
  router,
  fetchFilingsWithStatus,
  getTickerFromCompanyName, 
  getCIK,
  getFilings,
  downloadFiling,
  fetchFilings,
  extractConformedPeriod,
  buildFilingUrl,
  getTickerFromCompanyName
};
