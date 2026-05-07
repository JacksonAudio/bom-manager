// Vercel Serverless Function — Notifications Combined
// Combines: build-complete-notify, send-sms, slack-test, auth-login-alert,
//           gmail-*, track-activity
// Route via ?type=build-complete|sms|...|track-activity
//
// v10.52: Added track-activity. Validates the caller's Supabase JWT and
// fires a Slack DM to slack_alert_user_id when the user's email is on
// TRACKED_USERS (currently brady@jacksonaudio.net only). Silent for
// every other signed-in user. Used by the BOM Manager UI to give Brad
// real-time visibility into whether Brady is actually using the app —
// fires on login + every tab switch. Authorization: Bearer <jwt>.

import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const type = req.query.type || (req.body && req.body.type);
  if (!type) return res.status(400).json({ error: "Missing type param (build-complete|sms|...|track-activity)" });

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
    case "slack-test":
      return await handleSlackTest(req, res);
    case "auth-login-alert":
      return await handleAuthLoginAlert(req, res);
    case "gmail-scan":
      return await handleGmailScan(req, res);
    case "gmail-read":
      return await handleGmailRead(req, res);
    case "gmail-reply":
      return await handleGmailReply(req, res);
    case "gmail-mark-done":
      return await handleGmailMarkDone(req, res);
    case "track-activity":
      return await handleTrackActivity(req, res);
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
        from: "BOM Manager <alerts@jacksonaudio.net>",
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

// ── Helper: Send SMS (supports AWS SNS and Twilio) ───────────────────────────
async function sendSms({ to, body, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid }) {
  const cleanTo = to.replace(/[^+\d]/g, "");
  const fullTo = cleanTo.startsWith("+") ? cleanTo : "+1" + cleanTo;

  if (smsProvider === "aws_sns" && awsAccessKeyId && awsSecretAccessKey) {
    // AWS SNS
    const region = awsRegion || "us-east-1";
    const client = new SNSClient({
      region,
      credentials: { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey },
    });
    const command = new PublishCommand({
      PhoneNumber: fullTo,
      Message: body,
      MessageAttributes: {
        "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
      },
    });
    try {
      const result = await client.send(command);
      return { ok: true, data: { sid: result.MessageId, provider: "aws_sns" } };
    } catch (e) {
      return { ok: false, data: { message: e.message, code: e.name, provider: "aws_sns" } };
    }
  }

  // Twilio (fallback)
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const params = { To: fullTo, Body: body };
  if (messagingServiceSid) {
    params.MessagingServiceSid = messagingServiceSid;
  } else {
    params.From = fromNumber;
  }
  const twilioRes = await fetch(twilioUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await twilioRes.json();
  return { ok: twilioRes.ok, data: { ...data, provider: "twilio" } };
}

// ── Send SMS ────────────────────────────────────────────────────────────────────
async function handleSms(req, res) {
  const { to, message, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: "Missing 'to' or 'message'" });
  const hasAws = smsProvider === "aws_sns" && awsAccessKeyId && awsSecretAccessKey;
  const hasTwilio = accountSid && authToken && (fromNumber || messagingServiceSid);
  if (!hasAws && !hasTwilio) {
    return res.status(400).json({ error: "Missing SMS credentials. Configure AWS SNS or Twilio in Settings." });
  }

  try {
    const result = await sendSms({ to, body: message, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid });
    if (!result.ok) {
      console.error("SMS error:", result.data);
      return res.status(502).json({ error: result.data.message || "SMS send failed", code: result.data.code });
    }
    return res.status(200).json({ success: true, sid: result.data.sid, provider: result.data.provider });
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
    smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion,
    accountSid, authToken, fromNumber, messagingServiceSid,
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
            from: "BOM Manager <alerts@jacksonaudio.net>",
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

  // Send SMS
  const hasSmsCreds = (smsProvider === "aws_sns" && awsAccessKeyId && awsSecretAccessKey) || (accountSid && authToken && (fromNumber || messagingServiceSid));
  if (notifyPhone && hasSmsCreds) {
    try {
      const result = await sendSms({ to: notifyPhone, body: smsBody, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid });
      results.sms = result.ok ? "sent" : "failed";
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
    notifyPhone, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion,
    accountSid, authToken, fromNumber, messagingServiceSid,
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
            from: "BOM Manager <alerts@jacksonaudio.net>",
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

  // Send SMS
  const hasSmsCreds = (smsProvider === "aws_sns" && awsAccessKeyId && awsSecretAccessKey) || (accountSid && authToken && (fromNumber || messagingServiceSid));
  if (notifyPhone && hasSmsCreds) {
    try {
      const result = await sendSms({ to: notifyPhone, body: smsBody, smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid });
      results.sms = result.ok ? "sent" : "failed";
    } catch (e) {
      console.error("build-assigned sms error:", e);
      results.sms = "error";
    }
  }

  return res.status(200).json({ message: "Build assigned notification processed", results });
}

// ── Test — Verify email (Resend) and SMS (AWS SNS / Twilio) configuration ─────
async function handleTest(req, res) {
  const {
    testEmail, testPhone,
    smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion,
    accountSid, authToken, fromNumber, messagingServiceSid,
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
            from: "BOM Manager <alerts@jacksonaudio.net>",
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

  // Test SMS
  if (testPhone) {
    const hasAws = smsProvider === "aws_sns" && awsAccessKeyId && awsSecretAccessKey;
    const hasTwilio = accountSid && authToken && (fromNumber || messagingServiceSid);
    if (!hasAws && !hasTwilio) {
      results.sms = "no_credentials";
      results.details.sms = "Missing SMS credentials. Configure AWS SNS or Twilio in Settings, then save.";
    } else {
      try {
        const result = await sendSms({ to: testPhone, body: "Test from Jackson Audio BOM Manager — SMS notifications are working.", smsProvider, awsAccessKeyId, awsSecretAccessKey, awsRegion, accountSid, authToken, fromNumber, messagingServiceSid });
        if (result.ok) {
          results.sms = "sent";
          results.details.sms = `Test SMS sent to ${testPhone} via ${result.data.provider === "aws_sns" ? "AWS SNS" : "Twilio"} (ID: ${result.data.sid})`;
        } else {
          results.sms = "failed";
          results.details.sms = `SMS error: ${result.data.message || result.data.code || "Unknown error"}`;
        }
      } catch (e) {
        results.sms = "error";
        results.details.sms = `Error: ${e.message}`;
      }
    }
  }

  return res.status(200).json({ message: "Notification test complete", results });
}

// ── Slack DM helpers (shared by slack-test + auth-login-alert) ──────────────
// Reads slack_bot_token from public.api_keys via the service-role client.
// Service role lives only in Vercel runtime env — never client-side.
async function getSlackBotToken() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { token: null, error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env" };
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.from("api_keys").select("key_value").eq("key_name", "slack_bot_token").maybeSingle();
  if (error) return { token: null, error: `db read: ${error.message}` };
  if (!data || !data.key_value) return { token: null, error: "slack_bot_token row missing or empty in api_keys" };
  return { token: data.key_value, error: null };
}

async function slackLookupUserId(token, email) {
  const r = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json();
  if (!body.ok) return { ok: false, error: body.error || "lookup failed" };
  return { ok: true, userId: body.user.id, name: body.user.real_name || body.user.name };
}

async function slackPostDm(token, slackUserId, text) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  return await r.json();
}

// ── Slack Test — confirm bot can DM Brad end-to-end ─────────────────────────
// Accepts either { email } (requires users:read.email scope on the bot) or
// { slack_user_id } (bypasses lookup; works with just chat:write).
async function handleSlackTest(req, res) {
  const recipientEmail = (req.body && req.body.email) || "brad@jacksonaudio.net";
  const slackUserIdOverride = req.body && req.body.slack_user_id;
  const { token, error: tokenErr } = await getSlackBotToken();
  if (!token) return res.status(500).json({ ok: false, step: "token", error: tokenErr });

  let userId, name;
  if (slackUserIdOverride) {
    userId = slackUserIdOverride;
    name = "(direct ID)";
  } else {
    const lookup = await slackLookupUserId(token, recipientEmail);
    if (!lookup.ok) return res.status(500).json({ ok: false, step: "lookup", error: lookup.error, recipientEmail });
    userId = lookup.userId;
    name = lookup.name;
  }

  const text = `:bell: Test DM from BOM Manager — login alerts are wired up. If you see this, Slack notifications work end-to-end. (${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })} CT)`;
  const slackResp = await slackPostDm(token, userId, text);
  if (!slackResp.ok) return res.status(500).json({ ok: false, step: "post", error: slackResp.error, slack_response: slackResp });
  return res.status(200).json({ ok: true, recipient: slackUserIdOverride ? "(direct ID)" : recipientEmail, slack_user: userId, slack_name: name, ts: slackResp.ts });
}

// ── Track Activity (v10.52) — Brad's "is Brady using this?" visibility ──────
// POST /api/notifications?type=track-activity
//   headers: Authorization: Bearer <supabase_access_token>
//   body:    { action: string, details?: string|null }
// Validates the JWT against Supabase, looks up the user's email, and ONLY
// fires a Slack DM (to slack_alert_user_id) if the user is in TRACKED_USERS.
// Other users get a silent 200 so the frontend can call this on every
// session/route change without thinking about who's signed in.
// Reuses the existing getSlackBotToken / slackPostDm helpers.

const TRACKED_USERS = new Set(["brady@jacksonaudio.net"]);

async function handleTrackActivity(req, res) {
  const { action, details } = req.body || {};
  if (!action || typeof action !== "string") {
    return res.status(400).json({ error: "action (string) required in body" });
  }

  // Pre-declared. Pull bearer from Authorization header.
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Authorization: Bearer <token> required" });
  const userToken = m[1].trim();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey     = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error("track-activity: missing Supabase URL/anon key in env");
    return res.status(500).json({ error: "supabase env vars missing" });
  }

  // Validate the JWT by calling Supabase Auth's user endpoint.
  let user;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: anonKey },
    });
    if (!r.ok) return res.status(401).json({ error: "invalid token" });
    user = await r.json();
  } catch (err) {
    console.error("track-activity: user validation threw:", err);
    return res.status(500).json({ error: "user validation failed" });
  }
  const email = (user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "no email in token" });

  // Silent for non-tracked users — frontend fires on every login/tab
  // change, and we don't want every team member's clicks pinging Brad.
  if (!TRACKED_USERS.has(email)) {
    return res.status(200).json({ ok: true, tracked: false });
  }

  // Tracked — pull the Slack bot token + Brad's slack user id and DM.
  const { token: slackToken, error: tokenErr } = await getSlackBotToken();
  if (!slackToken) {
    console.error("track-activity: getSlackBotToken failed:", tokenErr);
    return res.status(500).json({ ok: false, step: "slack_token", error: tokenErr });
  }

  // slack_alert_user_id is already populated in api_keys (per the existing
  // auth-login-alert flow). Read it via the same service-role pattern.
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    return res.status(500).json({ error: "service role key missing" });
  }
  let slackUserId;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await sb.from("api_keys").select("key_value").eq("key_name", "slack_alert_user_id").maybeSingle();
    slackUserId = data?.key_value;
  } catch (err) {
    console.error("track-activity: api_keys read threw:", err);
    return res.status(500).json({ error: "api_keys read failed" });
  }
  if (!slackUserId) {
    return res.status(500).json({ ok: false, error: "slack_alert_user_id missing in api_keys" });
  }

  // Compose + send the DM. Central time so the timestamp matches Brad's
  // mental model. Mrkdwn formatting (Slack default for chat.postMessage).
  const ts = new Date().toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const text =
    `:eyes: *Brady — BOM Manager*\n` +
    `*${action}*` +
    (details ? `\n${details}` : "") +
    `\n_${ts} CT · ${email}_`;

  const slackResp = await slackPostDm(slackToken, slackUserId, text);
  if (!slackResp.ok) {
    console.error("track-activity: slack post failed:", slackResp.error);
    return res.status(502).json({ ok: false, step: "slack_post", error: slackResp.error });
  }
  return res.status(200).json({ ok: true, tracked: true, slack_ts: slackResp.ts });
}

// ── Auth Login Alert — fired by Postgres trigger when a watched user logs in
// Body: {
//   user_email:           string,   // who logged in
//   created_at?:          ISO string,
//   notify_slack_user_id: string,   // who gets DM'd (e.g. "U06GNFC0JA3")
//   watched_by_email?:    string,   // fallback if no slack id (needs users:read.email scope)
// }
async function handleAuthLoginAlert(req, res) {
  const { user_email, created_at, watched_by_email, notify_slack_user_id } = req.body || {};
  if (!user_email) return res.status(400).json({ ok: false, error: "missing user_email in body" });
  const { token, error: tokenErr } = await getSlackBotToken();
  if (!token) return res.status(500).json({ ok: false, step: "token", error: tokenErr });

  let userId, name;
  if (notify_slack_user_id) {
    userId = notify_slack_user_id;
    name = "(direct ID)";
  } else {
    const recipient = watched_by_email || "brad@jacksonaudio.net";
    const lookup = await slackLookupUserId(token, recipient);
    if (!lookup.ok) return res.status(500).json({ ok: false, step: "lookup", error: lookup.error, recipient });
    userId = lookup.userId;
    name = lookup.name;
  }

  const ts = created_at
    ? new Date(created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })
    : new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" });
  const text = `:bell: *${user_email}* just logged into BOM Manager (${ts} CT)`;
  const slackResp = await slackPostDm(token, userId, text);
  return res.status(200).json({ ok: !!slackResp.ok, slack_response: slackResp });
}

// ── Gmail Support Inbox ───────────────────────────────────────────────────────

async function gmailAccessToken(body) {
  const { client_id, client_secret, refresh_token } = body;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&refresh_token=${encodeURIComponent(refresh_token)}&grant_type=refresh_token`,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Gmail auth failed: " + (d.error_description || d.error || "bad credentials"));
  if (!d.access_token) throw new Error("No access_token returned");
  return d.access_token;
}

async function handleGmailScan(req, res) {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.refresh_token) return res.status(400).json({ error: "Missing Gmail credentials" });
    const token = await gmailAccessToken(b);
    const hdrs = { Authorization: `Bearer ${token}` };

    const since = new Date(Date.now() - 180 * 86400000);
    const ds = `${since.getFullYear()}/${since.getMonth()+1}/${since.getDate()}`;
    const q = encodeURIComponent(`to:support@jacksonaudio.net after:${ds} -from:noreply -from:instagram`);
    const lr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`, { headers: hdrs });
    const ld = await lr.json().catch(() => ({}));
    if (!lr.ok) return res.status(500).json({ error: "Gmail list failed: " + (ld.error?.message || lr.status) });

    const messages = [];
    for (const msg of (ld.messages || []).slice(0, 15)) {
      try {
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: hdrs });
        if (!r.ok) continue;
        const d = await r.json();
        const mh = {};
        (d.payload?.headers || []).forEach(h => { mh[h.name.toLowerCase()] = h.value; });
        const hay = (d.snippet || "") + " " + (mh.subject || "");
        const detectedSerials = [...new Set([...(hay.match(/\b[A-Z]{2,}-\d{3,}\b/g)||[]), ...[...hay.matchAll(/(?:serial|s\/n)[:\s#]+([A-Z0-9-]{4,})/gi)].map(m=>m[1])])];
        const fr = mh.from || "";
        messages.push({
          id: d.id, threadId: d.threadId,
          fromName: fr.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || fr.split("@")[0],
          fromEmail: fr.match(/<([^>]+)>/)?.[1] || fr,
          subject: mh.subject || "(no subject)",
          date: mh.date || "", internalDate: parseInt(d.internalDate||"0"),
          snippet: d.snippet || "", isUnread: (d.labelIds||[]).includes("UNREAD"),
          detectedSerials,
        });
      } catch { /* skip */ }
    }
    return res.status(200).json({ messages: messages.sort((a,b) => b.internalDate-a.internalDate) });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleGmailRead(req, res) {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.refresh_token || !b.messageId) return res.status(400).json({ error: "Missing params" });
    const token = await gmailAccessToken(b);
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${b.messageId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(500).json({ error: "Failed to fetch message" });
    const d = await r.json();
    const dec = (p) => {
      if (!p) return "";
      if (p.body?.data) { try { return Buffer.from(p.body.data,"base64").toString("utf-8"); } catch { return ""; } }
      if (p.parts?.length) { const pl = p.parts.find(x=>x.mimeType==="text/plain"); if (pl) return dec(pl); for (const pt of p.parts) { const t=dec(pt); if(t) return t; } }
      return "";
    };
    const mh = {};
    (d.payload?.headers||[]).forEach(h => { mh[h.name.toLowerCase()]=h.value; });
    return res.status(200).json({ id:d.id, from:mh.from||"", subject:mh.subject||"", date:mh.date||"", body:dec(d.payload||{}).replace(/\r\n/g,"\n").trim().slice(0,5000), snippet:d.snippet||"" });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleGmailReply(req, res) {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.refresh_token || !b.threadId || !b.to || !b.subject || !b.body) {
      return res.status(400).json({ error: "Missing required params: client_id, refresh_token, threadId, to, subject, body" });
    }
    const token = await gmailAccessToken(b);

    let raw = `From: me\r\nTo: ${b.to}\r\nSubject: ${b.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n`;
    if (b.inReplyTo) {
      raw += `In-Reply-To: ${b.inReplyTo}\r\nReferences: ${b.references || b.inReplyTo}\r\n`;
    }
    raw += `\r\n${b.body}`;

    const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded, threadId: b.threadId }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(500).json({ error: "Failed to send reply: " + (err.error?.message || r.status) });
    }
    const d = await r.json();
    return res.status(200).json({ success: true, messageId: d.id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function handleGmailMarkDone(req, res) {
  try {
    const b = req.body || {};
    if (!b.client_id || !b.refresh_token || !b.threadId) {
      return res.status(400).json({ error: "Missing required params: client_id, refresh_token, threadId" });
    }
    const token = await gmailAccessToken(b);

    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${b.threadId}/modify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ removeLabelIds: ["INBOX"], addLabelIds: [] }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(500).json({ error: "Failed to archive thread: " + (err.error?.message || r.status) });
    }
    return res.status(200).json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
