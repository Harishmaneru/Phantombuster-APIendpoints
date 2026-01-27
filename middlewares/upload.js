const multer = require("multer");

/**
 * Multer middleware configured for memory storage
 * Streams files directly to memory (buffers) without disk I/O
 * 
 * Limits:
 * - fileSize: 100MB (suitable for video/audio messages)
 * 
 * Usage:
 * - video_message: For LinkedIn inline video messages (shows thumbnail)
 * - audio_message: For LinkedIn audio messages (shows player)
 * - attachment: For regular file attachments (shows as file bubble)
 */
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});
