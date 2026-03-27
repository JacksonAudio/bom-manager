// Vercel Serverless Function — Notifications Combined
// Combines: build-complete-notify, send-sms
// Route via ?type=build-complete|sms

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const type = req.query.type || (req.body && req.body.type);
  if (!type) return res.status(400).json({ error: "Missing type param (build-complete|sms)" });

  switch (type) {
    case "build-complete":
      return await handleBuildComplete(req, res);
    case "sms":
      return await handleSms(req, res);
    case "playtest-failed":
      return await handlePlaytestFailed(req, res);
    case "build-assigned":
      return await handleBuildAssigned(req, res);
    case "test":
      return await handleTest(req, res);
    default:
      return res.status(400).json({ error: `Unknown type: ${type}` });
  }
}

// ── Build Complete Notify ───────────────────────────────────────────────────────
async function handleBuildComplete(req, res) {
  const { productName, quantity, builderName, duration, notifyEmail } = req.body || {};
  if (!notifyEmail) return res.status(400).json({ error: "No notify email" });

  const durationStr = duration
    ? duration < 1 ? `${Math.round(duration * 60)} minutes` : `${duration.toFixed(1)} hours`
    : "not tracked";

  const paceStr = duration && quantity > 0
    ? `${(duration / quantity * 60).toFixed(1)} minutes per unit`
    : "";

  const body = [
    `Build Complete!`,
    ``,
    `Product: ${productName || "Unknown"}`,
    `Quantity: ${quantity || 0} units`,
    `Builder: ${builderName || "Unassigned"}`,
    `Total Time: ${durationStr}`,
    paceStr ? `Pace: ${paceStr}` : "",
    ``,
    `Completed: ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    ``,
    `— Jackson Audio BOM Manager`,
  ].filter(Boolean).join("\n");

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("No RESEND_API_KEY — would send:", body);
    return res.status(200).json({ message: "No Resend key configured, email logged to console" });
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "BOM Manager <alerts@jackson.audio>",
        to: [notifyEmail],
        subject: `Build Complete — ${quantity}x ${productName || "Product"} by ${builderName || "team"}`,
        text: body,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return res.status(502).json({ error: "Email send failed", details: err });
    }

    return res.status(200).json({ message: "Notification sent" });
  } catch (err) {
    console.error("build-complete-notify error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Send SMS ────────────────────────────────────────────────────────────────────
async function handleSms(req, res) {
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

// ── Play Test Failed — Alert Brady (email + SMS) ──────────────────────────────
async function handlePlaytestFailed(req, res) {
  const {
    serialNumber, productName, testerName, rating, feedback,
    notifyEmail, notifyPhone,
    accountSid, authToken, fromNumber,
  } = req.body || {};

  const body = [
    `PLAY TEST FAILED`,
    ``,
    `Serial Number: ${serialNumber || "N/A"}`,
    `Product: ${productName || "Unknown"}`,
    `Tester: ${testerName || "Unknown"}`,
    rating ? `Rating: ${"★".repeat(rating)}${"☆".repeat(5 - rating)}` : "",
    feedback ? `Feedback: ${feedback}` : "",
    ``,
    `This pedal needs review and repair before it can ship.`,
    ``,
    `Reported: ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
    `— Jackson Audio BOM Manager`,
  ].filter(Boolean).join("\n");

  const smsBody = `FAILED PLAY TEST: ${serialNumber || "?"} (${productName || "?"}). Tester: ${testerName || "?"}. ${feedback ? feedback.slice(0, 100) : "No feedback."} — Review needed.`;

  const results = { email: null, sms: null };

  // Send email via Resend
  if (notifyEmail) {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "BOM Manager <alerts@jackson.audio>",
            to: [notifyEmail],
            subject: `FAILED Play Test — ${serialNumber || "?"} ${productName || ""}`,
            text: body,
          }),
        });
        results.email = emailRes.ok ? "sent" : "failed";
      } catch (e) {
        console.error("playtest-failed email error:", e);
        results.email = "error";
      }
    } else {
      console.log("No RESEND_API_KEY — would email:", notifyEmail, body);
      results.email = "no_key";
    }
  }

  // Send SMS via Twilio
  if (notifyPhone && accountSid && authToken && fromNumber) {
    const cleanTo = notifyPhone.replace(/[^+\d]/g, "");
    const fullTo = cleanTo.startsWith("+") ? cleanTo : "+1" + cleanTo;
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: fullTo, From: fromNumber, Body: smsBody }),
      });
      results.sms = twilioRes.ok ? "sent" : "failed";
    } catch (e) {
      console.error("playtest-failed sms error:", e);
      results.sms = "error";
    }
  }

  return res.status(200).json({ message: "Playtest failure notification processed", results });
}

// ── Build Assigned — Email + SMS the assigned team member ──────────────────────
async function handleBuildAssigned(req, res) {
  const {
    productName, quantity, priority, dueDate, forOrder, assignerName,
    notifyEmail, notifyName,
    notifyPhone, accountSid, authToken, fromNumber,
  } = req.body || {};

  const dueStr = dueDate ? new Date(dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No due date";
  const priorityLabel = (priority || "normal").charAt(0).toUpperCase() + (priority || "normal").slice(1);

  const emailBody = [
    `New Build Order Assigned`,
    ``,
    `Product: ${productName || "Unknown"}`,
    `Quantity: ${quantity || 0} units`,
    `Priority: ${priorityLabel}`,
    `Due: ${dueStr}`,
    forOrder ? `For Order/PO: ${forOrder}` : "",
    assignerName ? `Assigned by: ${assignerName}` : "",
    ``,
    `Log in to the BOM Manager to view details and start building.`,
    ``,
    `— Jackson Audio BOM Manager`,
  ].filter(Boolean).join("\n");

  const smsBody = `New build assigned: ${quantity}x ${productName || "product"}. Priority: ${priorityLabel}. Due: ${dueStr}.${forOrder ? ` PO: ${forOrder}` : ""}\n— Jackson Audio BOM Manager`;

  const results = { email: null, sms: null };

  // Send email via Resend
  if (notifyEmail) {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "BOM Manager <alerts@jackson.audio>",
            to: [notifyEmail],
            subject: `Build Assigned — ${quantity}x ${productName || "Product"} (${priorityLabel})`,
            text: emailBody,
          }),
        });
        results.email = emailRes.ok ? "sent" : "failed";
      } catch (e) {
        console.error("build-assigned email error:", e);
        results.email = "error";
      }
    } else {
      console.log("No RESEND_API_KEY — would email:", notifyEmail, emailBody);
      results.email = "no_key";
    }
  }

  // Send SMS via Twilio
  if (notifyPhone && accountSid && authToken && fromNumber) {
    const cleanTo = notifyPhone.replace(/[^+\d]/g, "");
    const fullTo = cleanTo.startsWith("+") ? cleanTo : "+1" + cleanTo;
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: fullTo, From: fromNumber, Body: smsBody }),
      });
      results.sms = twilioRes.ok ? "sent" : "failed";
    } catch (e) {
      console.error("build-assigned sms error:", e);
      results.sms = "error";
    }
  }

  return res.status(200).json({ message: "Build assigned notification processed", results });
}

// ── Test — Verify email (Resend) and SMS (Twilio) configuration ────────────────
async function handleTest(req, res) {
  const {
    testEmail, testPhone,
    accountSid, authToken, fromNumber,
  } = req.body || {};

  const results = { email: null, sms: null, details: {} };

  // Test email via Resend
  if (testEmail) {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      results.email = "no_key";
      results.details.email = "RESEND_API_KEY is not set in Vercel environment variables. Add it at: Vercel → Project → Settings → Environment Variables.";
    } else {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "BOM Manager <alerts@jackson.audio>",
            to: [testEmail],
            subject: "Test — BOM Manager Email Notifications Working",
            text: "This is a test email from Jackson Audio BOM Manager.\n\nIf you received this, email notifications are configured correctly.\n\n— Jackson Audio BOM Manager",
          }),
        });
        if (emailRes.ok) {
          results.email = "sent";
          results.details.email = `Test email sent to ${testEmail}`;
        } else {
          const err = await emailRes.text();
          results.email = "failed";
          results.details.email = `Resend API error: ${err}`;
        }
      } catch (e) {
        results.email = "error";
        results.details.email = `Network error: ${e.message}`;
      }
    }
  }

  // Test SMS via Twilio
  if (testPhone) {
    if (!accountSid || !authToken || !fromNumber) {
      results.sms = "no_credentials";
      results.details.sms = "Missing Twilio credentials. Fill in Account SID, Auth Token, and Phone Number above, then save.";
    } else {
      const cleanTo = testPhone.replace(/[^+\d]/g, "");
      const fullTo = cleanTo.startsWith("+") ? cleanTo : "+1" + cleanTo;
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
        const twilioRes = await fetch(twilioUrl, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: fullTo, From: fromNumber, Body: "Test from Jackson Audio BOM Manager — SMS notifications are working." }),
        });
        const data = await twilioRes.json();
        if (twilioRes.ok) {
          results.sms = "sent";
          results.details.sms = `Test SMS sent to ${fullTo} (SID: ${data.sid})`;
        } else {
          results.sms = "failed";
          results.details.sms = `Twilio error ${data.code || ""}: ${data.message || "Unknown error"}`;
        }
      } catch (e) {
        results.sms = "error";
        results.details.sms = `Network error: ${e.message}`;
      }
    }
  }

  return res.status(200).json({ message: "Notification test complete", results });
}
