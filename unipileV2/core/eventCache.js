/**
 * In-memory cache of realtime message events received through the v2 webhook.
 * Same keys the v1 WhatsApp webhook used, so v2 routes can read them later:
 *   msg_status:<message_id>   { delivered, delivered_at?, seen?, seen_at? }
 *   incoming_msg:<message_id> the message object from message.new
 *   msg_event:<message_id>    last reaction / edit / delete event
 */

const NodeCache = require("node-cache");

const eventCache = new NodeCache({ stdTTL: 10 * 60, checkperiod: 60 });

module.exports = eventCache;
