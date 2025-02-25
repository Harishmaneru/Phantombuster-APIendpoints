// const express = require('express');
// const { chromium } = require('playwright');
// const router = express.Router();
// const fs = require('fs').promises;
// const path = require('path');

 
// const USER_AGENT = 'onepgr (harish@onepgr.us)';  
// const BASE_RATE_LIMIT_DELAY = 10000;  
// const MAX_RETRIES = 3;
// const CACHE_DIR = path.join(__dirname, 'cache');
// const CACHE_EXPIRY = 24 * 60 * 60 * 1000;  

// // Ensure cache directory exists
// async function ensureCacheDir() {
//   try {
//     await fs.mkdir(CACHE_DIR, { recursive: true });
//   } catch (error) {
//     console.error('Error creating cache directory:', error);
//   }
// }

// // Cache utilities
// async function getFromCache(key) {
//   try {
//     const filePath = path.join(CACHE_DIR, `${key}.json`);
//     const stats = await fs.stat(filePath);
    
//     // Check if cache is expired
//     const now = new Date().getTime();
//     const modTime = stats.mtime.getTime();
//     if (now - modTime > CACHE_EXPIRY) {
//       return null;
//     }
    
//     const data = await fs.readFile(filePath, 'utf8');
//     return JSON.parse(data);
//   } catch (error) {
//     return null;
//   }
// }

// async function saveToCache(key, data) {
//   try {
//     const filePath = path.join(CACHE_DIR, `${key}.json`);
//     await fs.writeFile(filePath, JSON.stringify(data));
//   } catch (error) {
//     console.error('Error saving to cache:', error);
//   }
// }

// // Sleep function with exponential backoff
// async function sleep(retryCount = 0) {
//   const delay = BASE_RATE_LIMIT_DELAY * Math.pow(2, retryCount);
//   console.log(`Sleeping for ${delay/1000} seconds before next request`);
//   return new Promise(resolve => setTimeout(resolve, delay));
// }

// // Get CIK number for a ticker symbol
// async function getCIK(ticker) {
//   const cacheKey = `cik-${ticker}`;
//   const cachedData = await getFromCache(cacheKey);
//   if (cachedData) return cachedData;

//   let browser;
//   try {
//     browser = await chromium.launch();
//     const context = await browser.newContext();
//     const request = context.request;
    
//     let retries = 0;
//     let response;
    
//     while (retries <= MAX_RETRIES) {
//       try {
//         response = await request.get('https://www.sec.gov/files/company_tickers.json', {
//           headers: { 'User-Agent': USER_AGENT }
//         });
        
//         if (response.ok()) break;
        
//         // If we get rate limited
//         if (response.status() === 429) {
//           retries++;
//           if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded');
//           await sleep(retries);
//           continue;
//         }
        
//         throw new Error(`HTTP error ${response.status()}`);
//       } catch (error) {
//         retries++;
//         if (retries > MAX_RETRIES) throw error;
//         await sleep(retries);
//       }
//     }
    
//     const companies = Object.values(await response.json());
//     const company = companies.find(c => c.ticker === ticker);
    
//     if (!company) return null;
    
//     const cik = company.cik_str.toString().padStart(10, '0');
//     await saveToCache(cacheKey, cik);
//     return cik;
//   } catch (error) {
//     console.error(`Error fetching CIK for ${ticker}:`, error);
//     throw new Error(`Failed to fetch CIK for ${ticker}: ${error.message}`);
//   } finally {
//     if (browser) await browser.close();
//   }
// }

// // Get list of filings for a CIK
// async function getFilings(cik) {
//   const cacheKey = `filings-${cik}-${new Date().toISOString().split('T')[0]}`;
//   const cachedData = await getFromCache(cacheKey);
//   if (cachedData) return cachedData;

//   let browser;
//   try {
//     browser = await chromium.launch();
//     const context = await browser.newContext();
//     const request = context.request;
    
//     let retries = 0;
//     let response;
    
//     while (retries <= MAX_RETRIES) {
//       try {
//         response = await request.get(`https://data.sec.gov/submissions/CIK${cik}.json`, {
//           headers: { 'User-Agent': USER_AGENT }
//         });
        
//         if (response.ok()) break;
        
//         // If we get rate limited
//         if (response.status() === 429) {
//           retries++;
//           if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded');
//           await sleep(retries);
//           continue;
//         }
        
//         throw new Error(`HTTP error ${response.status()}`);
//       } catch (error) {
//         retries++;
//         if (retries > MAX_RETRIES) throw error;
//         await sleep(retries);
//       }
//     }
    
//     const data = await response.json();
//     const filings = data.filings.recent;
    
//     const result = filings.form
//       .map((form, index) => ({
//         form,
//         date: filings.filingDate[index],
//         accession: filings.accessionNumber[index],
//         description: filings.description ? filings.description[index] : '',
//         reportDate: filings.reportDate ? filings.reportDate[index] : ''
//       }))
//       .filter(f => ['10-K', '10-Q'].includes(f.form));
    
//     await saveToCache(cacheKey, result);
//     return result;
//   } catch (error) {
//     console.error(`Error fetching filings for CIK ${cik}:`, error);
//     throw new Error(`Failed to fetch filings for CIK ${cik}: ${error.message}`);
//   } finally {
//     if (browser) await browser.close();
//   }
// }

// // Get filing document content with better rate limit handling
// async function getFilingDocument(cik, filing) {
//   const cacheKey = `filing-${cik}-${filing.accession}`;
//   const cachedData = await getFromCache(cacheKey);
//   if (cachedData) return cachedData;

//   const numericCik = parseInt(cik, 10).toString();
//   const accessionNoDash = filing.accession.replace(/-/g, '');
  
//   // URLs for different ways to access the document
//   const edgarApiUrl = `https://data.sec.gov/submissions/CIK${cik}/${filing.accession}.json`;
//   const txtUrl = `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDash}/${filing.accession}.txt`;
  
//   // Alternative URL structure that sometimes works better
//   const htmlIndexUrl = `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDash}/${filing.accession}-index.html`;
  
//   let browser;
//   try {
//     browser = await chromium.launch({ headless: true });
//     const context = await browser.newContext({ 
//       userAgent: USER_AGENT,
//       extraHTTPHeaders: {
//         'Accept': 'text/html,application/xhtml+xml,application/xml',
//         'Accept-Language': 'en-US,en;q=0.9',
//         'Connection': 'keep-alive'
//       }
//     });

//     // Try different approaches to getting the document with retries
//     let content = null;
//     let retries = 0;
    
//     // First try EDGAR API
//     while (retries <= MAX_RETRIES && !content) {
//       try {
//         console.log(`Attempting EDGAR API approach for ${filing.accession}, retry ${retries}`);
//         const request = context.request;
//         const response = await request.get(edgarApiUrl, {
//           headers: { 'User-Agent': USER_AGENT }
//         });
        
//         if (response.ok()) {
//           const metadata = await response.json();
//           if (metadata.documentFormatFiles && metadata.documentFormatFiles.length > 0) {
//             // Find the primary document
//             const primaryDoc = metadata.documentFormatFiles.find(
//               doc => doc.description.includes('DOCUMENT') && 
//                     (doc.documentUrl.endsWith('.htm') || doc.documentUrl.endsWith('.html'))
//             );
            
//             if (primaryDoc) {
//               await sleep(retries);
//               const page = await context.newPage();
//               await page.goto(`https://www.sec.gov${primaryDoc.documentUrl}`, { 
//                 timeout: 60000,
//                 waitUntil: 'domcontentloaded'
//               });
              
//               content = await page.content();
//               break;
//             }
//           }
//         }
        
//         // If we get rate limited
//         if (response.status() === 429) {
//           retries++;
//           if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded for EDGAR API');
//           await sleep(retries);
//           continue;
//         }
        
//         // Move to next approach if this one fails
//         break;
//       } catch (error) {
//         console.warn(`EDGAR API approach failed: ${error.message}`);
//         break;
//       }
//     }
    
//     // If EDGAR API failed, try HTML index approach
//     if (!content) {
//       retries = 0;
//       while (retries <= MAX_RETRIES && !content) {
//         try {
//           console.log(`Attempting HTML index approach for ${filing.accession}, retry ${retries}`);
//           const page = await context.newPage();
//           await page.goto(htmlIndexUrl, { 
//             timeout: 60000,
//             waitUntil: 'domcontentloaded'
//           });
          
//           // Look for the filing document link
//           const docLinks = await page.$$eval('a', links => {
//             return links
//               .filter(link => link.href.includes('.htm') && !link.href.includes('-index.htm'))
//               .map(link => link.href);
//           });
          
//           if (docLinks.length > 0) {
//             await sleep(retries);
//             await page.goto(docLinks[0], { 
//               timeout: 60000,
//               waitUntil: 'domcontentloaded'
//             });
//             content = await page.content();
//             break;
//           }
          
//           // If no links found, try next approach
//           break;
//         } catch (error) {
//           retries++;
//           if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded for HTML index');
//           await sleep(retries);
//         }
//       }
//     }
    
//     // Fallback to TXT approach
//     if (!content) {
//       retries = 0;
//       while (retries <= MAX_RETRIES && !content) {
//         try {
//           console.log(`Attempting TXT approach for ${filing.accession}, retry ${retries}`);
//           const page = await context.newPage();
//           await page.goto(txtUrl, { 
//             timeout: 60000,
//             waitUntil: 'domcontentloaded'
//           });
          
//           content = await page.content();
          
//           // Check if we got a rate limit page
//           if (content.includes('Request Rate Threshold Exceeded')) {
//             retries++;
//             if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded for TXT approach');
//             await sleep(retries);
//             content = null;
//             continue;
//           }
          
//           break;
//         } catch (error) {
//           retries++;
//           if (retries > MAX_RETRIES) throw new Error('Maximum retries exceeded for TXT approach');
//           await sleep(retries);
//         }
//       }
//     }
    
//     if (!content) {
//       throw new Error('Failed to retrieve document content with all approaches');
//     }
    
//     await saveToCache(cacheKey, content);
//     return content;
//   } catch (error) {
//     console.error(`Error fetching filing document for ${filing.accession}:`, error);
//     throw new Error(`Failed to fetch filing document for ${filing.accession}: ${error.message}`);
//   } finally {
//     if (browser) await browser.close();
//   }
// }

// // Fetch multiple documents with controlled concurrency to avoid rate limits
// async function fetchDocumentsWithRateLimit(cik, filings, concurrency = 1) {
//   const results = [];
//   const chunks = [];
  
//   // Split filings into chunks based on concurrency
//   for (let i = 0; i < filings.length; i += concurrency) {
//     chunks.push(filings.slice(i, i + concurrency));
//   }
  
//   // Process one chunk at a time
//   for (const chunk of chunks) {
//     // Process filings in the chunk concurrently
//     const chunkPromises = chunk.map(async (filing) => {
//       try {
//         console.log(`Processing ${filing.form} from ${filing.date} (${filing.accession})`);
//         const content = await getFilingDocument(cik, filing);
        
//         return {
//           form: filing.form,
//           date: filing.date,
//           reportDate: filing.reportDate,
//           accession: filing.accession,
//           description: filing.description,
//           contentSnippet: content.substring(0, 500),
//           content: content,
//           status: 'success'
//         };
//       } catch (error) {
//         console.error(`Error processing filing ${filing.accession}:`, error);
//         return {
//           form: filing.form,
//           date: filing.date,
//           accession: filing.accession,
//           error: error.message,
//           status: 'error'
//         };
//       }
//     });
    
//     const chunkResults = await Promise.all(chunkPromises);
//     results.push(...chunkResults);
    
//     // Wait between chunks to avoid rate limiting
//     if (chunks.indexOf(chunk) < chunks.length - 1) {
//       await sleep(0); // Base delay between chunk processing
//     }
//   }
  
//   return results;
// }

// // Main function to fetch SEC filings with better rate limit handling
// async function fetchSECFilings(companyTicker, options = {}) {
//   await ensureCacheDir();
  
//   // Default options
//   const opts = {
//     limit: options.limit || 5,
//     extractSections: options.extractSections || false,
//     concurrency: options.concurrency || 1,
//     daysBack: options.daysBack || 365
//   };
  
//   try {
//     const cik = await getCIK(companyTicker.toUpperCase());
//     if (!cik) throw new Error(`Company with ticker ${companyTicker} not found`);
    
//     await sleep(0); // Rate limit delay between API calls
    
//     const allFilings = await getFilings(cik);
//     if (!allFilings.length) throw new Error(`No 10-K or 10-Q filings found for ${companyTicker}`);
    
//     // Filter filings by date if daysBack is specified
//     let filteredFilings = allFilings;
//     if (opts.daysBack) {
//       const cutoffDate = new Date();
//       cutoffDate.setDate(cutoffDate.getDate() - opts.daysBack);
      
//       filteredFilings = allFilings.filter(filing => {
//         const filingDate = new Date(filing.date);
//         return filingDate >= cutoffDate;
//       });
//     }
    
//     // Limit number of filings to process
//     const filingsToProcess = opts.limit ? filteredFilings.slice(0, opts.limit) : filteredFilings;
    
//     // Process documents with rate limiting
//     const filingResults = await fetchDocumentsWithRateLimit(cik, filingsToProcess, opts.concurrency);
    
//     return { 
//       cik, 
//       company: companyTicker.toUpperCase(),
//       filings: filingResults 
//     };
//   } catch (error) {
//     console.error('Error in fetchSECFilings:', error);
//     throw error;
//   }
// }

// // Express route handler
// router.post('/fetch-sec-filings/:companyTicker', async (req, res) => {
//   try {
//     const { companyTicker } = req.params;
//     const options = {
//       limit: req.body.limit || 2,          // Reduced limit to avoid rate issues
//       daysBack: req.body.daysBack || 365,  // Option to filter by date
//       concurrency: 1,                      // Force sequential processing to avoid rate limits
//       extractSections: req.body.extractSections || false
//     };
    
//     const data = await fetchSECFilings(companyTicker, options);
//     res.json(data);
//   } catch (error) {
//     console.error('API error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// module.exports = {
//   router,
//   getCIK,
//   getFilings,
//   getFilingDocument,
//   fetchSECFilings
// };




const express = require('express');
const axios = require('axios');
const router = express.Router();

const USER_AGENT = 'onepgr (harish@onepgr.us)';
const RATE_LIMIT_DELAY = 3000;

// Get CIK from SEC company tickers JSON.
async function getCIK(ticker) {
  const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': USER_AGENT }
  });
  const companies = Object.values(response.data);
  const company = companies.find(c => c.ticker.toUpperCase() === ticker.toUpperCase());
  return company ? company.cik_str.toString().padStart(10, '0') : null;
}

// Fetch filings metadata.
async function getFilings(cik) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const response = await axios.get(url, { headers: { 'User-Agent': USER_AGENT } });
  const data = response.data;
  const filings = data.filings.recent;
  return filings.form
    .map((form, index) => ({
      form,
      date: filings.filingDate[index],
      reportDate: filings.reportDate ? filings.reportDate[index] : null,
      accession: filings.accessionNumber[index]
    }))
    .filter(f => ['10-K', '10-Q'].includes(f.form));
}

// Download filing document directly using axios.
async function downloadFilingDocument(cik, filing) {
  // Construct potential URL for text file.
  const accessionNoDash = filing.accession.replace(/-/g, '');
  const txtUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDash}/${filing.accession}.txt`;
  try {
    const response = await axios.get(txtUrl, { headers: { 'User-Agent': USER_AGENT } });
    return response.data;
  } catch (error) {
    throw new Error(`Error fetching filing document: ${error.message}`);
  }
}

async function fetchSECFilings(companyTicker) {
  const cik = await getCIK(companyTicker);
  if (!cik) throw new Error('Company not found');

  const filings = await getFilings(cik);
  if (!filings.length) throw new Error('No filings found');

  let results = [];
  // Process filings sequentially to ensure rate limits are respected.
  for (const filing of filings) {
    // Wait to avoid rate limits.
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    try {
      const content = await downloadFilingDocument(cik, filing);
      results.push({
        form: filing.form,
        date: filing.date,
        reportDate: filing.reportDate,
        accession: filing.accession,
        contentSnippet: content.substring(0, 500)
      });
    } catch (error) {
      results.push({
        form: filing.form,
        date: filing.date,
        reportDate: filing.reportDate,
        accession: filing.accession,
        error: error.message
      });
    }
  }
  return { cik, filings: results };
}

router.post('/fetch-sec-filings/:companyTicker', async (req, res) => {
  try {
    const { companyTicker } = req.params;
    const data = await fetchSECFilings(companyTicker);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = {
  router,
  getCIK,
  getFilings,
  downloadFilingDocument,
  fetchSECFilings
};
