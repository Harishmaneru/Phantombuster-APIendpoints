require("dotenv").config();
const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const cors = require("cors");

const { router: slackRouter } = require("./webhooks/slackEvents");
const { router: slackLoggerRouter } = require("./webhooks/slackLogger");
const opentokWebhookRouter = require("./openTok/opentokWebhook.js");
const opentokSessionAPI = require("./openTok/opentokSessionAPI.js");

// Domain Management API

const cpanelApi = require("./domainManagementAPI/cpanelApi.js");

const nameCheapDomainApi = require("./domainManagementAPI/nameCheapDomainApi.js");

const accountScraper = require("./PhantombusterAPI/AccountScraper.js");
const companyEmployesScrap = require("./PhantombusterAPI/companyEmployesScrap.js");
const likesCommentsScraper = require("./PhantombusterAPI/LikesCommentsScrap.js");
const eventGuestsScraper = require("./PhantombusterAPI/eventGuestsScraper.js");
const profileScraper = require("./PhantombusterAPI/ProfileScraper.js");
const emailScraper = require("./PhantombusterAPI/EmailScraper.js");
const findpeople = require("./PhantombusterAPI/findPeople.js");
const linkdinMessagesScraper = require("./PhantombusterAPI/linkdinMessagesScraper.js");

const webscraper = require("./webScraperAPI/WebscrapAgent.js");

const peopledatalabs = require("./pdlAPI/peopleDataLabs.js");
const personSearch = require("./pdlAPI/personSearch");

const scrapeJoblistings = require("./jobListingsAPI/scrapeJoblistings.js");
const scrapIndeedJobs = require("./jobListingsAPI/scrapIndeedJobs.js");
const linkdinJobScraper = require("./jobListingsAPI/linkdinJobScraper.js");

const generateScene = require("./runwayAPI/generateScene.js");

const warmupEmail = require("./SmartLeadAPI/warmupEmail.js");

const emailValidation = require("./naverBounceAPI/emailValidation.js");

const webhook = require("./TrigifyAPI/webhook.js");
const rb2bEvents = require("./webhooks/rb2bevents.js");

const phoneValidationApi = require("./TrestleAPI/phoneValidationApi.js");

const findPerson = require("./TrestleAPI/findPerson.js");

const realContact = require("./TrestleAPI/realContact.js");

const phoneFeedback = require("./TrestleAPI/phoneFeedback.js");

const filingController = require("./secFilings/filingController.js");

const downloadFillings = require("./secFilings/downloadFillings.js");

const pressFundingAnnounements = require("./pressFundingAnnounements/newsAnnouncements.js");

const CompanyInsightsModule = require("./pressFundingAnnounements/CompanyInsightsModule.js");

const youtubeData = require("./socialSignals/youtubeData.js");

const twitterMentions = require("./socialSignals/twitterMentions.js");

const jobSignals = require("./pressFundingAnnounements/jobSignals.js");

const companyPosts = require("./rapidAPI/companyPosts.js");

const getCompanyArticles = require("./pressFundingAnnounements/getCompanyArticles.js");

const fetchCompanyByDomain = require("./pressFundingAnnounements/fetchCompanyByDomain.js");

const signalAutomationJobs = require("./signalAutomationJobs/signalAutomationJobs.js");

const productLunchs = require("./pressFundingAnnounements/productLunchs.js");

const publicMentions = require("./pressFundingAnnounements/publicMentions.js");

const personProfile = require("./rapidAPI/personProfile.js");

const getCompanyInfo = require("./rapidAPI/companyInfo.js");

const virtualInterview = require("./virtualInterviewAPI/virtualInterview.js");

const videoTotext = require("./virtualInterviewAPI/videoTotext.js");

const interviewLink = require("./virtualInterviewAPI/interviewLink.js");

const submissionRoutes = require("./virtualInterviewAPI/submissionRoutes.js");

const fetchPersonPosts = require("./rapidAPI/personPosts.js");

const fetchCompanyJobs = require("./rapidAPI/companyJobs.js");

const getPostDetails = require("./rapidAPI/getPostDetails.js");

const getLinkedInEmployees = require("./rapidAPI/linkedinEmployeesScraper.js");

const fetchSalesNavURL = require("./rapidAPI/fetchSalesNavURL.js");

const secScraper10K = require("./secFilings/secScraper10K.js");

const secScraper10Q = require("./secFilings/secScraper10Q.js");

const warmupInbox = require("./warmupInboxAPI/warmupInbox.js");

const prospectsAPI = require("./exploriumAPI/prospectsAPI.js");

const businessesAPI = require("./exploriumAPI/businessesAPI.js");

const signupApi = require("./virtualInterviewAPI/signupApi.js");

const stripeRoutes = require("./virtualInterviewAPI/stripeRoutes.js");

const manageSubscriptions = require("./virtualInterviewAPI/manageSubscriptions.js");

const linkedinMessaging = require("./uniplieApi/linkedinMessaging.js");

const notifyAPI = require("./notifyAPI/sendEmail.js");

const subscriptionManageAPI = require("./subscriptionController/subscriptionManageAPI.js");

// Nylas Email API
const nylasEmailAPI = require("./nylasAPI/nylasemailAPI.js");

const supabaseApi = require("./nylasAPI/supabaseAPI.js");
const openAI = require("./nylasAPI/openAI");
const { Http2ServerRequest } = require("http2");

const app = express();
const port = 3001;

// Trust proxy for ngrok and other reverse proxies
// Set to 1 to trust first proxy (fixes rate limit warning)
app.set("trust proxy", 1);

// Single, secure CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:4000",
        "http://localhost:3000",
        "http://localhost:4200",
        "http://localhost:4201",
        "https://videoresponse.onepgr.com",
        "https://www.recordedinterview.com",
        "https://www.app.recordedinterview.com",
        "https://app.recordedinterview.com",
        "https://www.getprospectsignals.com",
        "https://getprospectsignals.com",
        "https://record.onepgr.com",
        "https://kampaign.onepgr.com",
      ];

      // Check if origin is in allowed list or is a controlled subdomain
      if (
        allowedOrigins.includes(origin) ||
        (origin.endsWith(".onepgr.com") && origin.startsWith("https://"))
      ) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "stripe-signature",
      "X-User-Id",
    ],
    exposedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

// Register Stripe webhook route before body parser
app.use("/api/stripe", stripeRoutes);

// ─── Slack needs raw body for signature verification ───────────────────────
// Mount both the raw parser AND the router *together* on the same path:
app.use("/slack/rb2b-ri-visitors", slackRouter);

// Mount Slack Logger webhook routes
app.use("/webhooks/slackLogger", slackLoggerRouter);

// Global middleware for parsing JSON (before all routes)
app.use(express.json());

// Mount OpenTok webhook routes
app.use(opentokWebhookRouter.router);

// Mount OpenTok session API routes
app.use(opentokSessionAPI);

// Mount domain management routes

app.use(cpanelApi.router);

app.use(accountScraper);
app.use(likesCommentsScraper);
app.use(profileScraper);
app.use(emailScraper);
app.use(webscraper);
app.use(peopledatalabs);
app.use(findpeople);
app.use(scrapIndeedJobs);
app.use(scrapeJoblistings);
app.use(companyEmployesScrap);
app.use(generateScene);
app.use(warmupEmail);
app.use(eventGuestsScraper);
app.use(linkdinJobScraper);
app.use(linkdinMessagesScraper);
app.use(emailValidation);
app.use(personSearch);
app.use(webhook);
app.use(rb2bEvents);
app.use(phoneValidationApi);
app.use(realContact);
app.use(findPerson);
app.use(phoneFeedback);
app.use(filingController.router);
app.use(downloadFillings);
app.use(pressFundingAnnounements.router);
app.use(twitterMentions.router);
app.use(CompanyInsightsModule.router);
app.use(youtubeData.router);
app.use(jobSignals.router);
app.use(companyPosts.router);
app.use(getCompanyArticles.router);
app.use(fetchCompanyByDomain.router);
app.use(signalAutomationJobs.router);
app.use(productLunchs.router);
app.use(publicMentions.router);
app.use(personProfile.router);
app.use(getCompanyInfo.router);
app.use(virtualInterview);
app.use(videoTotext.router);
app.use(interviewLink.router);
app.use(submissionRoutes);
app.use(fetchPersonPosts.router);
app.use(fetchCompanyJobs.router);
app.use(getPostDetails.router);
app.use(getLinkedInEmployees.router);
app.use(fetchSalesNavURL.router);
app.use(secScraper10K.router);
app.use(secScraper10Q.router);
app.use(warmupInbox);
app.use(prospectsAPI);
app.use(businessesAPI.router);
app.use(signupApi.router);
app.use(manageSubscriptions.router);
app.use(linkedinMessaging);
app.use(notifyAPI.router);
app.use(subscriptionManageAPI.router);
app.use(nameCheapDomainApi.router);

// Mount Nylas Email API routes
app.use("/api/nylas", nylasEmailAPI);
app.use(supabaseApi);

// Mount OpenAI Email Reply API routes
app.use("/api/openai", openAI);

const options = {
  key: fs.readFileSync("./onepgr.com.key", "utf8"),
  cert: fs.readFileSync("./STAR_onepgr_com.crt", "utf8"),
  ca: fs.readFileSync("./STAR_onepgr_com.ca-bundle", "utf8"),
  requestTimeout: 30 * 60 * 1000, // 30 minutes
  headersTimeout: 15 * 60 * 1000, // 15 minutes
  keepAliveTimeout: 10 * 60 * 1000, // 5 minutes
};

const server = https.createServer(options, app);

// Set server timeout
server.setTimeout(30 * 60 * 1000); // 30 minutes
server.listen(port, () => {
  console.log(
    `───────────────────────────Server running on port:${port}───────────────────────────`,
  );
});
