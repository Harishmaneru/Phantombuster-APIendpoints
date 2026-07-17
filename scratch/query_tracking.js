const mongoose = require("mongoose");
require("dotenv").config();

const emailTrackingSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true },
    originalMessageId: String,
    fromEmail: { type: String, required: true },
    toEmail: { type: String, required: true },
    subject: String,
    sentAt: { type: Date, default: Date.now },
    openedAt: Date,
    openedCount: { type: Number, default: 0 },
    lastOpenedIP: String,
    repliedAt: Date,
    webhookUrl: String,
    emailContent: {
      html: String,
      text: String,
    },
    trackingPayload: mongoose.Schema.Types.Mixed,
    openEvents: [
      {
        openedAt: Date,
        ip: String,
        userAgent: String,
        sessionId: String,
        isMachineOpen: { type: Boolean, default: false },
      },
    ],
    replayCount: { type: Number, default: 0 },
    replayEvents: [
      {
        replayedAt: Date,
        ip: String,
        userAgent: String,
        sessionId: String,
        isMachineOpen: { type: Boolean, default: false },
      },
    ],
    clickEvents: [
      {
        url: String,
        clickedAt: Date,
        ip: String,
        userAgent: String,
      },
    ],
  },
  {
    collection: "email_tracking_v2",
    timestamps: true,
  }
);

const EmailTracking = mongoose.model("EmailTracking", emailTrackingSchema);

async function run() {
  const uri = process.env.ONEPGR_MONGO_URI;
  console.log("Connecting to:", uri);
  
  try {
    await mongoose.connect(uri, {
      dbName: "onepgr_apps",
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected successfully!");

    const email = "danielleb@luxurybrandpartners.com";
    console.log(`Querying records for toEmail: ${email}`);

    const records = await EmailTracking.find({ toEmail: email }).sort({ createdAt: -1 });

    console.log(`\nFound ${records.length} records:\n`);
    
    records.forEach((record, index) => {
      console.log(`--- [Record ${index + 1}] ---`);
      console.log(JSON.stringify(record, null, 2));
      console.log("\n");
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

run();
