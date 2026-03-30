// Vercel Serverless Function — Gmail Support Inbox Scanner
// Scans support@jacksonaudio.net for repair/warranty emails
// Actions: scan (list emails with metadata) | read (get full email body)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const body = req.method === "POST" ? (req.body || {}) : req.query;
    const { client_id, client_secret, refresh_token, action, messageId } = body;

    if (!client_id || !client_secret || !refresh_token) {
      return res.status(400).json({ error: "Missing Gmail OAuth credentials" });
    }

    // Exchange refresh token for a fresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&refresh_token=${encodeURIComponent(refresh_token)}&grant_type=refresh_token`,
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return res.status(401).json({ error: "Gmail auth failed: " + (tokenData.error_description || tokenData.error || "bad credentials") });
    }
    const access_token = tokenData.access_token;
    if (!access_token) {
      return res.status(401).json({ error: "No access token returned — check client_id, client_secret, refresh_token" });
    }
    const gmailHdrs = { Authorization: `Bearer ${access_token}` };

    // ── SCAN ─────────────────────────────────────────────────────────────────
    if (action === "scan") {
      const since = new Date(Date.now() - 180 * 86400000);
      const dateStr = `${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;
      const q = encodeURIComponent(
        `to:support@jacksonaudio.net after:${dateStr} -from:noreply@instagram -from:noreply -from:no-reply`
      );

      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=20`,
        { headers: gmailHdrs }
      );
      const listData = await listRes.json().catch(() => ({}));
      if (!listRes.ok) {
        return res.status(500).json({ error: "Gmail list failed: " + (listData.error?.message || listRes.status) });
      }

      const msgIds = (listData.messages || []).slice(0, 15);

      // Fetch metadata sequentially (avoids rate limit hammering)
      const messages = [];
      for (const msg of msgIds) {
        try {
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata` +
            `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: gmailHdrs }
          );
          if (!r.ok) continue;
          const d = await r.json();
          const hdrs = {};
          (d.payload?.headers || []).forEach(h => { hdrs[h.name.toLowerCase()] = h.value; });

          const haystack = (d.snippet || "") + " " + (hdrs.subject || "");
          const detectedSerials = [
            ...(haystack.match(/\b[A-Z]{2,}-\d{3,}\b/g) || []),
            ...[...haystack.matchAll(/(?:serial|s\/n)[:\s#]+([A-Z0-9-]{4,})/gi)].map(m => m[1]),
          ].filter((v, i, a) => a.indexOf(v) === i);

          const fromRaw = hdrs.from || "";
          const fromName  = fromRaw.match(/^"?([^"<]+)"?\s*</)?.[1]?.trim() || fromRaw.split("@")[0];
          const fromEmail = fromRaw.match(/<([^>]+)>/)?.[1] || fromRaw;

          messages.push({
            id: d.id,
            threadId: d.threadId,
            fromName, fromEmail, fromRaw,
            subject: hdrs.subject || "(no subject)",
            date: hdrs.date || "",
            internalDate: parseInt(d.internalDate || "0"),
            snippet: d.snippet || "",
            isUnread: (d.labelIds || []).includes("UNREAD"),
            detectedSerials,
          });
        } catch (e) {
          // skip broken messages
        }
      }

      return res.status(200).json({
        messages: messages.sort((a, b) => b.internalDate - a.internalDate),
        total: listData.resultSizeEstimate || messages.length,
      });
    }

    // ── READ ─────────────────────────────────────────────────────────────────
    if (action === "read") {
      if (!messageId) return res.status(400).json({ error: "Missing messageId" });

      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers: gmailHdrs }
      );
      if (!r.ok) return res.status(500).json({ error: "Failed to fetch message" });
      const d = await r.json();

      const decodeBody = (payload) => {
        if (!payload) return "";
        if (payload.body?.data) {
          try { return Buffer.from(payload.body.data, "base64").toString("utf-8"); } catch { return ""; }
        }
        if (payload.parts?.length) {
          const plain = payload.parts.find(p => p.mimeType === "text/plain");
          if (plain) return decodeBody(plain);
          for (const part of payload.parts) { const t = decodeBody(part); if (t) return t; }
        }
        return "";
      };

      const hdrs = {};
      (d.payload?.headers || []).forEach(h => { hdrs[h.name.toLowerCase()] = h.value; });

      return res.status(200).json({
        id: d.id,
        from: hdrs.from || "",
        subject: hdrs.subject || "",
        date: hdrs.date || "",
        body: decodeBody(d.payload || {}).replace(/\r\n/g, "\n").trim().slice(0, 5000),
        snippet: d.snippet || "",
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    // Always return JSON — never let Vercel return an empty body
    return res.status(500).json({ error: "Server error: " + (err.message || String(err)) });
  }
}
