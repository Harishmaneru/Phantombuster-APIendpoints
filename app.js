const express = require('express');
const https = require('https');
const fs = require('fs');
const cors = require('cors');

const profileScraper = require('./AccountScraper');
const likesCommentsScraper = require('./LikesCommentsScrap');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());
app.use(profileScraper);
app.use(likesCommentsScraper);

const options = {
    key: fs.readFileSync('./onepgr.com.key', 'utf8'),
    cert: fs.readFileSync('./STAR_onepgr_com.crt', 'utf8'),
    ca: fs.readFileSync('./STAR_onepgr_com.ca-bundle', 'utf8')
};

const server = https.createServer(options, app);

server.listen(port, () => {
    console.log(`Server running on https://localhost:${port}`);
});