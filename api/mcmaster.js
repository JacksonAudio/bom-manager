// ============================================================
// api/mcmaster.js — McMaster-Carr API proxy
//
// Auth: mTLS client certificate (.pfx)
// Required Vercel env vars:
//   MCMASTER_PFX_B64  — base64-encoded Jackson-1.pfx file
//   MCMASTER_PFX_PASS — PFX passphrase
//
// NOTE: Endpoint URL below may need updating — confirm with
//       McMaster-Carr API documentation received with cert.
// ============================================================

import https from "https";

const MCMASTER_BASE = "https://api.mcmaster.com/v1";

function makeAgent() {
  const pfxB64 = process.env.MCMASTER_PFX_B64;
  if (!pfxB64) throw new Error("MCMASTER_PFX_B64 env var not set — add base64 PFX to Vercel environment variables");
  return new https.Agent({
    pfx: Buffer.from(pfxB64, "base64"),
    passphrase: process.env.MCMASTER_PFX_PASS || "",
    rejectUnauthorized: true,
  });
}

function httpsGet(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("McMaster request timed out")));
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { action = "search", mpn } = req.query;

  try {
    const agent = makeAgent();

    // ── Test connection — just verify cert loads and agent initializes
    if (action === "test") {
      return res.status(200).json({ ok: true, msg: "McMaster-Carr cert loaded — connection ready" });
    }

    // ── Search by part number
    if (action === "search") {
      if (!mpn) return res.status(400).json({ error: "mpn is required" });

      // TODO: confirm endpoint with McMaster-Carr API docs
      const url = `${MCMASTER_BASE}/products/${encodeURIComponent(mpn)}`;
      const { status, body } = await httpsGet(url, agent);

      if (status === 404) {
        return res.status(200).json({ error: `Part not found at McMaster-Carr: ${mpn}` });
      }
      if (status === 401) {
        return res.status(401).json({ error: "McMaster-Carr auth failed — cert may be expired or revoked" });
      }
      if (status !== 200) {
        return res.status(status).json({
          error: `McMaster-Carr API returned ${status}`,
          raw: body.slice(0, 300),
        });
      }

      let data;
      try { data = JSON.parse(body); }
      catch { return res.status(500).json({ error: "McMaster-Carr returned non-JSON response", raw: body.slice(0, 200) }); }

      return res.status(200).json(mapProduct(data, mpn));
    }

    return res.status(400).json({ error: `Unknown action: ${action}. Use 'search' or 'test'.` });

  } catch (err) {
    if (err.message.includes("MCMASTER_PFX_B64")) {
      return res.status(500).json({ error: err.message });
    }
    console.error("[mcmaster] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

function mapProduct(p, requestedMpn) {
  // NOTE: Adjust field names once actual McMaster API response shape is confirmed
  const rawBreaks = p.priceBreaks || p.pricing || p.pricingTiers || [];
  const priceBreaks = rawBreaks.map((pb) => ({
    qty: parseInt(pb.quantity || pb.minQuantity || pb.qty || 1),
    price: parseFloat(pb.price || pb.unitPrice || 0),
  })).filter((pb) => pb.price > 0);

  const unitPrice = priceBreaks.length
    ? priceBreaks[0].price
    : parseFloat(p.price || p.unitPrice || p.listPrice || 0);

  return {
    mpn:             p.partNumber || p.PartNumber || p.itemNumber || requestedMpn,
    description:     p.description || p.Description || p.productDescription || "",
    stock:           parseInt(p.availability || p.quantityAvailable || p.stock || 0),
    unitPrice,
    priceBreaks,
    moq:             parseInt(p.minimumQuantity || p.minOrderQty || p.packageQuantity || 1),
    url:             p.productUrl || p.url || `https://www.mcmaster.com/${encodeURIComponent(p.partNumber || requestedMpn)}/`,
    datasheet:       p.drawingUrl || p.datasheetUrl || p.cadUrl || null,
    countryOfOrigin: p.countryOfOrigin || "US",
  };
}
