// Vercel Serverless Function — Send SMS via Twilio
// Used to notify builders when they get assigned a build order
// and when a build is completed

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { to, message, accountSid, authToken, fromNumber } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: "Missing 'to' or 'message'" });
  if (!accountSid || !authToken || !fromNumber) {
    return res.status(400).json({ error: "Missing Twilio credentials. Configure in Settings → SMS." });
  }

  // Clean phone number — ensure it starts with +
  const cleanTo = to.replace(/[^+\d]/g, "");
  if (cleanTo.length < 10) return res.status(400).json({ error: "Invalid phone number" });
  const fullTo = cleanTo.startsWith("+") ? cleanTo : "+1" + cleanTo;

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: fullTo,
        From: fromNumber,
        Body: message,
      }),
    });

    const data = await twilioRes.json();
    if (!twilioRes.ok) {
      console.error("Twilio error:", data);
      return res.status(502).json({ error: data.message || "Twilio send failed", code: data.code });
    }

    return res.status(200).json({ success: true, sid: data.sid });
  } catch (err) {
    console.error("send-sms error:", err);
    return res.status(500).json({ error: err.message });
  }
}
