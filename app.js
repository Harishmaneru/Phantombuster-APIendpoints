// const express = require('express');
// const https = require('https');
// const http = require('http');
// const fs = require('fs');
// const cors = require('cors');

// const accountScraper = require('./AccountScraper');
// const likesCommentsScraper = require('./LikesCommentsScrap');
// const profileScraper =require('./ProfileScraper')
// const emailScraper =require('./EmailScraper')
// const webscraper =require('./WebscrapAgent')
// const peopledatalabs =require('./peopleDataLabs')
// const findpeople =require('./findPeople')
// const scrapeJoblistings = require('./scrapeJoblistings')
// const scrapIndeedJobs = require('./scrapIndeedJobs')
// const companyEmployesScrap = require('./companyEmployesScrap.js')
// const generateScene = require('./generateScene')



// const app = express();
// const port = 3001;

// app.use(cors());
// app.use(express.json());
// app.use(accountScraper);
// app.use(likesCommentsScraper);
// app.use(profileScraper);
// app.use(emailScraper)
// app.use(webscraper)
// app.use(peopledatalabs)
// app.use(findpeople)
// app.use(scrapIndeedJobs)
// app.use(scrapeJoblistings)
// app.use(companyEmployesScrap)
// app.use(generateScene)




// const options = {
//     key: fs.readFileSync('./onepgr.com.key', 'utf8'),
//     cert: fs.readFileSync('./STAR_onepgr_com.crt', 'utf8'),
//     ca: fs.readFileSync('./STAR_onepgr_com.ca-bundle', 'utf8')
// };

// const server = https.createServer(options, app);

// server.listen(port, () => {
//     console.log(`Server running on port:${port}`);
// });

const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');

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

const scrapeJoblistings = require('./jobListingsAPI/scrapeJoblistings.js');
const scrapIndeedJobs = require('./jobListingsAPI/scrapIndeedJobs.js');
const linkdinJobScraper = require('./jobListingsAPI/linkdinJobScraper.js');

const generateScene = require('./runwayAPI/generateScene.js');

const warmupEmail = require('./SmartLeadAPI/warmupEmail.js');

const emailValidation = require('./naverBounceAPI/emailValidation.js')

const app = express();
const port = 3001;

app.use(
  cors({
    origin: [
      "http://localhost:4000",
      "http://localhost:4200",
      "http://localhost:4201",
      /\.onepgr\.com$/,
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


const options = {
  key: fs.readFileSync('./onepgr.com.key', 'utf8'),
  cert: fs.readFileSync('./STAR_onepgr_com.crt', 'utf8'),
  ca: fs.readFileSync('./STAR_onepgr_com.ca-bundle', 'utf8'),
};

const server = https.createServer(options, app);

server.listen(port, () => {
  console.log(`Server running on port:${port}`);
});
