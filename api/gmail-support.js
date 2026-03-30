// Vercel Serverless Function — Gmail Support Inbox Scanner
// Scans support@jacksonaudio.net for repair/warranty emails
// Actions: scan (list emails with metadata) | read (get full email body)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const body = req.method === "POST" ? (req.body || {}) : req.query;
  const { client_id, client_secret, refresh_token, action, messageId } = body;

  if (!client_id || !client_secret || !refresh_token) {
    return res.status(400).json({ error: "Missing Gmail OAuth credentials (client_id, client_secret, refresh_token)" });
  }

  // Exchange refresh token for a fresh access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    return res.status(401).json({ error: "Gmail auth failed: " + (err.error_description || err.error || "check credentials") });
  }
  const { access_token } = await tokenRes.json();
  const gmailHdrs = { Authorization: `Bearer ${access_token}` };

  // ── SCAN: list recent support emails with metadata ────────────────────────
  if (action === "scan") {
    // Pull emails sent to support@jacksonaudio.net, last 180 days
    const since = new Date(Date.now() - 180 * 86400000);
    const dateStr = `${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;
    const q = encodeURIComponent(`to:support@jacksonaudio.net after:${dateStr} -from:noreply -from:Instagram -from:notifications`);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=50`,
      { headers: gmailHdrs }
    );
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      return res.status(500).json({ error: "Gmail list failed: " + (err.error?.message || listRes.status) });
    }
    const listData = await listRes.json();
    const msgIds = (listData.messages || []).slice(0, 30);

    // Fetch metadata for each message (parallel, max 30)
    const messages = await Promise.all(msgIds.map(async (msg) => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: gmailHdrs }
        );
        if (!r.ok) return null;
        const d = await r.json();
        const hdrs = {};
        (d.payload?.headers || []).forEach(h => { hdrs[h.name.toLowerCase()] = h.value; });

        // Detect serial numbers: patterns like PRISM-0042, OPTIMIST-0001, JA-0001
        const haystack = (d.snippet || "") + " " + (hdrs.subject || "");
        const patternDash   = haystack.match(/\b[A-Z]{2,}-\d{3,}\b/g) || [];
        const patternLabel  = [...haystack.matchAll(/(?:serial|s\/n|s\.n\.|sn)[:\s#]+([A-Z0-9-]{4,})/gi)]
          .map(m => m[1].trim());
        const detectedSerials = [...new Set([...patternDash, ...patternLabel])];

        // Extract sender name + email
        const fromRaw = hdrs.from || "";
        const fromName  = fromRaw.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || fromRaw.split("@")[0];
        const fromEmail = fromRaw.match(/<([^>]+)>/)?.[1] || fromRaw;

        return {
          id: d.id,
          threadId: d.threadId,
          fromRaw,
          fromName,
          fromEmail,
          subject: hdrs.subject || "(no subject)",
          date: hdrs.date || "",
          internalDate: parseInt(d.internalDate || "0"),
          snippet: d.snippet || "",
          labelIds: d.labelIds || [],
          isUnread: (d.labelIds || []).includes("UNREAD"),
          detectedSerials,
        };
      } catch {
        return null;
      }
    }));

    return res.status(200).json({
      messages: messages.filter(Boolean).sort((a, b) => b.internalDate - a.internalDate),
    });
  }

  // ── READ: get full email body ─────────────────────────────────────────────
  if (action === "read") {
    if (!messageId) return res.status(400).json({ error: "Missing messageId" });

    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: gmailHdrs }
    );
    if (!r.ok) return res.status(500).json({ error: "Failed to fetch message" });
    const d = await r.json();

    // Recursively decode body — prefer text/plain
    const decodeBody = (payload) => {
      if (!payload) return "";
      if (payload.body?.data) {
        try { return Buffer.from(payload.body.data, "base64").toString("utf-8"); } catch { return ""; }
      }
      if (payload.parts?.length) {
        const plain = payload.parts.find(p => p.mimeType === "text/plain");
        if (plain) return decodeBody(plain);
        for (const part of payload.parts) {
          const t = decodeBody(part);
          if (t) return t;
        }
      }
      return "";
    };

    const hdrs = {};
    (d.payload?.headers || []).forEach(h => { hdrs[h.name.toLowerCase()] = h.value; });
    const bodyText = decodeBody(d.payload || {}).replace(/\r\n/g, "\n").trim().slice(0, 5000);

    return res.status(200).json({
      id: d.id,
      from: hdrs.from || "",
      subject: hdrs.subject || "",
      date: hdrs.date || "",
      body: bodyText,
      snippet: d.snippet || "",
    });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
