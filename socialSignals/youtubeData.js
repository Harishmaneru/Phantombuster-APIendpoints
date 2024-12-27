const axios = require('axios');
const express = require('express');
const router = express.Router();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyAcP0p867UDhTcsnPEN7793veXFHYbgXuY';

router.post('/fetch-youtube-videos', async (req, res) => {
    console.log('Received request with body:', req.body);
    const response = await fetchYouTubeVideos(req.body);
    res.status(200).send(response);
});

const fetchYouTubeVideos = async (body) => {
    console.log('Received request with body:', body);
    const { companyName, maxResults = 3 } = body;

    if (!companyName) {
        console.log('Missing required parameter: companyName');
        return {
            status: "-1",
            message: "Company name is required.",
            data: {}
        };
    }

    console.log('Fetching YouTube videos for:', { companyName, maxResults });

    try {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
            params: {
                part: 'snippet',
                q: companyName,
                type: 'video',
                maxResults,
                key: YOUTUBE_API_KEY
            }
        });

        console.log('Received response from YouTube API:', response.status, response.statusText);

        const videos = response.data.items.map((item) => ({
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
            thumbnail: item.snippet.thumbnails.default.url,
        })).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        console.log('Formatted video data:', videos);

        if (videos.length > 0) {
            return {
                status: "1",
                message: "Successfully fetched YouTube videos.",
                data: videos
            };
        } else {
            console.log('No videos found for:', companyName);
            return {
                status: "-1",
                message: "No videos found for the specified company name.",
                data: {}
            };
        }
    } catch (error) {
        console.error('Error fetching YouTube videos:', error.message);
        return {
            status: "-1",
            message: error.message,
            data: {}
        };
    }
};

module.exports = {
    router,
    fetchYouTubeVideos
};
