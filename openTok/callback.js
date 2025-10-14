// OpenTok Callback Example
// This file demonstrates how to handle OpenTok events on the client side
// The webhook system will automatically capture these events server-side

const OpenTokClient = {
  // Example: Initialize OpenTok session
  initSession: function(apiKey, sessionId, token) {
    const session = OT.initSession(apiKey, sessionId);
    
    // Set up event listeners
    session.on('streamCreated', (event) => {
      console.log('Stream created:', event.stream);
      // This will trigger a webhook event to your server
    });
    
    session.on('streamDestroyed', (event) => {
      console.log('Stream destroyed:', event.stream);
      // This will trigger a webhook event to your server
    });
    
    session.on('connectionCreated', (event) => {
      console.log('Connection created:', event.connection);
      // This will trigger a webhook event to your server
    });
    
    session.on('connectionDestroyed', (event) => {
      console.log('Connection destroyed:', event.connection);
      // This will trigger a webhook event to your server
    });
    
    return session;
  },
  
  // Example: Start recording
  startRecording: function(session, publisherOptions = {}) {
    const publisher = OT.initPublisher('publisher', {
      name: 'User Recording',
      publishAudio: true,
      publishVideo: true,
      ...publisherOptions
    });
    
    session.publish(publisher, (error) => {
      if (error) {
        console.error('Error publishing:', error);
      } else {
        console.log('Recording started - webhook will receive streamCreated event');
      }
    });
    
    return publisher;
  },
  
  // Example: Stop recording
  stopRecording: function(session, publisher) {
    session.unpublish(publisher, (error) => {
      if (error) {
        console.error('Error unpublishing:', error);
      } else {
        console.log('Recording stopped - webhook will receive streamDestroyed event');
      }
    });
  }
};

module.exports = OpenTokClient;
