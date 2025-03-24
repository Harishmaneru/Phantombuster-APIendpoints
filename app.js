const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

const accountScraper = require('./PhantombusterAPI/AccountScraper.js');
const companyEmployesScrap = require('./PhantombusterAPI/companyEmployesScrap.js');
const likesCommentsScraper = require('./PhantombusterAPI/LikesCommentsScrap.js');
const eventGuestsScraper = require('./PhantombusterAPI/eventGuestsScraper.js');
const profileScraper = require('./PhantombusterAPI/ProfileScraper.js');
const emailScraper = require('./PhantombusterAPI/EmailScraper.js');
const findpeople = require('./PhantombusterAPI/findPeople.js');
const linkdinMessagesScraper = require('./PhantombusterAPI/linkdinMessagesScraper.js');

const webscraper = require('./webScraperAPI/WebscrapAgent.js');

const peopledatalabs = require('./pdlAPI/peopleDataLabs.js');
const personSearch = require('./pdlAPI/personSearch');

const scrapeJoblistings = require('./jobListingsAPI/scrapeJoblistings.js');
const scrapIndeedJobs = require('./jobListingsAPI/scrapIndeedJobs.js');
const linkdinJobScraper = require('./jobListingsAPI/linkdinJobScraper.js');

const generateScene = require('./runwayAPI/generateScene.js');

const warmupEmail = require('./SmartLeadAPI/warmupEmail.js');

const emailValidation = require('./naverBounceAPI/emailValidation.js');

const webhook = require('./TrigifyAPI/webhook.js');

const phoneValidationApi = require('./TrestleAPI/phoneValidationApi.js');

const findPerson = require('./TrestleAPI/findPerson.js')

const realContact = require('./TrestleAPI/realContact.js');

const phoneFeedback = require('./TrestleAPI/phoneFeedback.js');

const filingController = require('./secFilings/filingController.js');

const downloadFillings = require('./secFilings/downloadFillings.js');

const pressFundingAnnounements = require('./pressFundingAnnounements/newsAnnouncements.js');

const CompanyInsightsModule = require('./pressFundingAnnounements/CompanyInsightsModule.js');

const youtubeData = require('./socialSignals/youtubeData.js');

const twitterMentions = require('./socialSignals/twitterMentions.js');

const jobSignals = require('./pressFundingAnnounements/jobSignals.js');

const companyPosts = require('./rapidAPI/companyPosts.js');

const getCompanyArticles = require('./pressFundingAnnounements/getCompanyArticles.js');

const fetchCompanyByDomain = require('./pressFundingAnnounements/fetchCompanyByDomain.js');

const signalAutomationJobs = require('./signalAutomationJobs/signalAutomationJobs.js');

const productLunchs = require('./pressFundingAnnounements/productLunchs.js');

const publicMentions = require('./pressFundingAnnounements/publicMentions.js');

const personProfile = require('./rapidAPI/personProfile.js');

const getCompanyInfo = require('./rapidAPI/companyInfo.js');

const virtualInterview = require('./virtualInterviewAPI/virtualInterview.js');

const videoTotext = require('./virtualInterviewAPI/videoTotext.js');

const interviewLink = require('./virtualInterviewAPI/interviewLink.js');


const submissionRoutes = require('./virtualInterviewAPI/submissionRoutes.js');

const fetchPersonPosts = require('./rapidAPI/personPosts.js');

const fetchCompanyJobs = require('./rapidAPI/companyJobs.js');

const getPostDetails = require('./rapidAPI/getPostDetails.js');

const getLinkedInEmployees = require('./rapidAPI/linkedinEmployeesScraper.js');

const fetchSalesNavURL = require('./rapidAPI/fetchSalesNavURL.js');

const secScraper10K = require('./secFilings/secScraper10K.js');

const secScraper10Q = require('./secFilings/secScraper10Q.js');

const warmupInbox = require('./warmupInboxAPI/warmupInbox.js');

const prospectsAPI = require('./exploriumAPI/prospectsAPI.js');

const businessesAPI = require('./exploriumAPI/businessesAPI.js');

const { Http2ServerRequest } = require('http2');


const app = express();
const port = 3001;

app.use(
  cors({
    origin: [
      "http://localhost:4000",
      "http://localhost:3000",
      "http://localhost:4200",
      "http://localhost:4201",
      /\.onepgr\.com$/,
      "https://videoresponse.onepgr.com",
      "https://www.recordedinterview.com",
      "https://www.app.recordedinterview.com",
      "https://www.app.recordedinterview.com",
      "https://app.recordedinterview.com",
      "https://www.getprospectsignals.com",
      "https://getprospectsignals.com",
      "https://record.onepgr.com/"



    ],
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);

app.use(express.json());
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
app.use(submissionRoutes)
app.use(fetchPersonPosts.router)
app.use(fetchCompanyJobs.router)
app.use(getPostDetails.router)
app.use(getLinkedInEmployees.router)
app.use(fetchSalesNavURL.router)
app.use(secScraper10K.router);
app.use(secScraper10Q.router);
app.use(warmupInbox);
app.use(prospectsAPI);
app.use(businessesAPI.router);

const options = {
  key: fs.readFileSync('./onepgr.com.key', 'utf8'),
  cert: fs.readFileSync('./STAR_onepgr_com.crt', 'utf8'),
  ca: fs.readFileSync('./STAR_onepgr_com.ca-bundle', 'utf8'),
};

const server = https.createServer(options, app);

server.listen(port, () => {
  console.log(`Server running on port:${port}`);
});
