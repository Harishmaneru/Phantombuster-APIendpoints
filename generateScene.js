const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');



const router = express.Router(); // Initialize router


router.use(express.json());

// const API_KEY = 'key_67e29a372c43145561bf788aca3934ac2ab625b14e6b7e949e4d8447a35fb8591156d1a7b0428fa6c48381a3ebabb7fa36d24402f4d56eee3110e3816b1e0692';
const API_KEY = 'key_b60146dae9d8bcaa129a3c6bc5f4180aa9bf581d8797e4bdb8d8b702d58df7920028d4dbf4d96613f245433f00a2a1b233ed8d4cf1715f3bff476b638ddf9f7c'

router.post('/generate-video', async (req, res) => {
  let { imageUrl, promptText } = req.body;

  const data = JSON.stringify({
    "promptImage": imageUrl,
    "seed": 999999999,
    "model": "gen3a_turbo",
    "promptText": promptText,
    "watermark": false,
    "duration": 5,
    "ratio": "16:9"
  });

  let createVideoConfig = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api.dev.runwayml.com/v1/image_to_video',
    headers: { 
      'Content-Type': 'application/json', 
      'Authorization': `Bearer ${API_KEY}`, 
      'X-Runway-Version': '2024-09-13'
    },
    data: data
  };

  try {
    const runwayResponse = await axios.request(createVideoConfig);
    console.log(runwayResponse.data);
    const taskId = runwayResponse.data.id;

    const checkTaskStatus = async () => {
      let taskCompleted = false;
      while (!taskCompleted) {
        await new Promise(resolve => setTimeout(resolve, 10000));

        let checkStatusConfig = {
          method: 'get',
          url: `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
          headers: { 
            'Authorization': `Bearer ${API_KEY}`, 
            'X-Runway-Version': '2024-09-13'
          }
        };

        const statusResponse = await axios.request(checkStatusConfig);
        console.log(statusResponse.data);
        if (statusResponse.data.status === 'SUCCEEDED') {
          return statusResponse.data.output[0];
        } else if (statusResponse.data.status === 'FAILED') {
          throw new Error('Video generation failed');
        }
      }
    };

    const videoUrl = await checkTaskStatus();
    res.json({
      success: true,
      message: 'Video generated successfully',
      videoUrl: videoUrl
    });

  } catch (error) {
    console.error('Error creating video:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});



module.exports = router; // Export the router
