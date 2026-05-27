const mongoose = require("mongoose");

const ConnectedDomainSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    source: {
      type: String,
      enum: ["external", "internal"],
      default: "external",
    },
    registrar: {
      type: String,
      default: "godaddy",
    },
    hostingProvider: {
      type: String,
      default: "namecheap_vps",
    },
    cpanel: {
      added: { type: Boolean, default: false },
      addedAt: Date,
      documentRoot: String,
      method: String,
    },
    dnsVerified: { type: Boolean, default: false },
    dnsVerifiedAt: Date,
    dnsCheck: {
      expectedIp: String,
      resolvedIps: [String],
      lastCheckedAt: Date,
      mxResolved: [String],
    },
    emailEnabled: { type: Boolean, default: false },
    emailAccounts: [
      {
        username: String,
        email: String,
        quota: { type: Number, default: 500 },
        createdAt: { type: Date, default: Date.now },
        suspended: { type: Boolean, default: false },
      },
    ],
    status: {
      type: String,
      enum: ["pending", "connected", "failed"],
      default: "pending",
    },
    notes: String,
  },
  {
    collection: "connected_domains",
    timestamps: true,
  },
);

ConnectedDomainSchema.index({ userId: 1, domain: 1 }, { unique: true });
ConnectedDomainSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ConnectedDomain", ConnectedDomainSchema);
