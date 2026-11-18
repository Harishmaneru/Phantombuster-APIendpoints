const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractWebhookProvider,
  isNonLinkedInWebhookEvent,
} = require("../uniplieApi/unipileWebhookProvider");

test("WhatsApp AccountStatus events are ignored", () => {
  const body = {
    AccountStatus: {
      account_id: "UybF2_x_Ts2vtaAgDc2S4A",
      account_type: "WHATSAPP",
      message: "OK",
      name: "919110397112",
    },
  };
  assert.equal(extractWebhookProvider(body), "WHATSAPP");
  assert.equal(isNonLinkedInWebhookEvent(body), true);
});

test("non-LinkedIn providers are ignored in every payload shape", () => {
  assert.equal(isNonLinkedInWebhookEvent({ Account: { id: "a", provider: "WHATSAPP" } }), true);
  assert.equal(isNonLinkedInWebhookEvent({ Account: { id: "a", type: "GOOGLE_OAUTH" } }), true);
  assert.equal(isNonLinkedInWebhookEvent({ account_id: "a", provider: "TELEGRAM" }), true);
});

test("LinkedIn events are processed, in any case", () => {
  assert.equal(
    isNonLinkedInWebhookEvent({ AccountStatus: { account_id: "a", account_type: "LINKEDIN" } }),
    false,
  );
  assert.equal(isNonLinkedInWebhookEvent({ Account: { id: "a", provider: "linkedin" } }), false);
  assert.equal(isNonLinkedInWebhookEvent({ account_id: "a", provider: "LinkedIn" }), false);
});

test("events without a provider are still processed (hosted-auth notify)", () => {
  const body = { status: "CREATION_SUCCESS", account_id: "a", name: "11092|jimmy@example.com" };
  assert.equal(extractWebhookProvider(body), null);
  assert.equal(isNonLinkedInWebhookEvent(body), false);
  assert.equal(isNonLinkedInWebhookEvent({ provider: "  " }), false);
  assert.equal(isNonLinkedInWebhookEvent(undefined), false);
});
