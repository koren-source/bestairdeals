/**
 * Notification dispatcher. Sends to Slack webhook and/or email.
 * Both channels are non-blocking. Failures are logged, never thrown.
 */

import { sendEmail } from "./email.js";

/**
 * Send a notification message to all configured channels.
 *
 * @param {string} message - notification text
 * @param {object} config - trip config with notifications.slack_webhook and notifications.email
 * @returns {Promise<void>}
 */
export async function notify(message, config) {
  const slackUrl = config?.notifications?.slack_webhook || process.env.SLACK_WEBHOOK_URL;
  const emailTo = config?.notifications?.email || process.env.NOTIFY_EMAIL;

  const channels = [];

  if (slackUrl) {
    channels.push(sendSlack(slackUrl, message));
  }

  if (emailTo) {
    channels.push(sendEmail(emailTo, "bestairdeals — Search Complete", message));
  }

  if (channels.length === 0) {
    // No channels configured — skip silently
    return;
  }

  const results = await Promise.allSettled(channels);

  for (const r of results) {
    if (r.status === "rejected") {
      console.warn(`notify: Channel failed — ${r.reason?.message ?? r.reason}`);
    }
  }
}

/**
 * Build the standard notification message for a completed search.
 *
 * @param {object[]} confirmed - confirmed combos
 * @param {object[]} likely - likely combos
 * @param {number} totalRecords - total flight records processed
 * @param {object} topDeal - best combo (lowest score)
 * @param {string} filePath - path to results file
 * @param {object} programs - PROGRAMS config
 * @returns {string}
 */
export function buildNotifyMessage(confirmed, likely, totalRecords, topDeal, filePath, programs) {
  const n = confirmed.length;
  const m = likely.length;

  let msg = `Search complete! Found ${n} confirmed + ${m} likely combos from ${totalRecords} flight records.`;

  if (topDeal) {
    const progOut = programs[topDeal.outbound.program]?.name ?? topDeal.outbound.program;
    if (topDeal.return) {
      const progRet = programs[topDeal.return.program]?.name ?? topDeal.return.program;
      msg += `\nTop deal: ${progOut} + ${progRet}, ${topDeal.outbound.date} - ${topDeal.return.date}, ${topDeal.total_pts} MR + $${topDeal.total_fees} for ${topDeal.outbound.seats_available ?? "?"} pax.`;
    } else {
      msg += `\nTop deal: ${progOut}, ${topDeal.outbound.date} (one-way), ${topDeal.total_pts} MR + $${topDeal.total_fees} for ${topDeal.outbound.seats_available ?? "?"} pax.`;
    }
  }

  msg += `\nFull results: ${filePath}`;
  return msg;
}

/**
 * POST to a Slack webhook. Never throws.
 */
async function sendSlack(webhookUrl, text) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.warn(`notify/slack: Webhook returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`notify/slack: Failed — ${err.message}`);
  }
}
