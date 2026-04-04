/**
 * Email sender via AgentMail API.
 * Never throws — logs warnings on failure.
 */

const AGENTMAIL_ENDPOINT = "https://api.agentmail.to/v0/emails";
const FROM_ADDRESS = "qdivision@agentmail.to";

/**
 * Send an email via AgentMail.
 *
 * @param {string} to - recipient email address
 * @param {string} subject - email subject
 * @param {string} body - email body (plain text)
 * @returns {Promise<boolean>} true if sent, false if skipped or failed
 */
export async function sendEmail(to, subject, body) {
  const apiKey = process.env.AGENTMAIL_API_KEY;

  if (!apiKey) {
    console.warn("email: No AGENTMAIL_API_KEY configured. Skipping email.");
    return false;
  }

  if (!to) {
    console.warn("email: No recipient address provided. Skipping.");
    return false;
  }

  try {
    const res = await fetch(AGENTMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to,
        subject,
        body,
      }),
    });

    if (!res.ok) {
      console.warn(`email: AgentMail returned ${res.status}: ${await res.text()}`);
      return false;
    }

    console.log(`email: Sent to ${to} — "${subject}"`);
    return true;
  } catch (err) {
    console.warn(`email: Failed to send — ${err.message}`);
    return false;
  }
}
