// ============================================================
// api/search-components.js — Component Search + McMaster-Carr
//
// action=mouser/nexar (default): keyword search via Mouser or Nexar
// action=mcmaster: product lookup via mTLS client cert
//   Required Vercel env vars for McMaster:
//     MCMASTER_PFX_B64  — base64-encoded Jackson-1.pfx
//     MCMASTER_PFX_PASS — PFX passphrase
// ============================================================

import https from "https";

// ── McMaster-Carr helpers ────────────────────────────────────

const MCMASTER_BASE = "https://api.mcmaster.com/v1";

function makeMcMasterAgent() {
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
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("McMaster request timed out")));
  });
}

function mapMcMasterProduct(p, requestedMpn) {
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

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, q, mouserKey, token, limit, mpn } = req.query;

  // ── McMaster-Carr ──────────────────────────────────────────
  if (action === "mcmaster") {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    try {
      const agent = makeMcMasterAgent();

      if (mpn === "test" || !mpn) {
        return res.status(200).json({ ok: true, msg: "McMaster-Carr cert loaded — connection ready" });
      }

      // TODO: confirm endpoint with McMaster-Carr API docs
      const url = `${MCMASTER_BASE}/products/${encodeURIComponent(mpn)}`;
      const { status, body } = await httpsGet(url, agent);

      if (status === 404) return res.status(200).json({ error: `Part not found at McMaster-Carr: ${mpn}` });
      if (status === 401) return res.status(401).json({ error: "McMaster-Carr auth failed — cert may be expired or revoked" });
      if (status !== 200) return res.status(status).json({ error: `McMaster-Carr API returned ${status}`, raw: body.slice(0, 300) });

      let data;
      try { data = JSON.parse(body); }
      catch { return res.status(500).json({ error: "McMaster-Carr returned non-JSON response", raw: body.slice(0, 200) }); }

      return res.status(200).json(mapMcMasterProduct(data, mpn));
    } catch (err) {
      console.error("[search-components/mcmaster] Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Component keyword search (Mouser / Nexar) ──────────────
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!q) return res.status(400).json({ error: "q (search query) is required" });

  const maxResults = Math.min(parseInt(limit) || 100, 200);

  // Try Mouser first (free, no monthly part limit)
  if (mouserKey) {
    try {
      const mouserRes = await fetch(`https://api.mouser.com/api/v1/search/keyword?apiKey=${encodeURIComponent(mouserKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SearchByKeywordRequest: {
            keyword: q,
            records: maxResults,
            startingRecord: 0,
            searchOptions: "",
            searchWithYourSignUpLanguage: "",
          },
        }),
      });

      if (!mouserRes.ok) {
        const err = await mouserRes.text();
        console.error("[search-components] Mouser error:", err.slice(0, 500));
        return res.status(mouserRes.status).json({ error: `Mouser API error: ${mouserRes.status}` });
      }

      const data = await mouserRes.json();
      const parts = data?.SearchResults?.Parts || [];

      const results = parts.slice(0, maxResults).map(p => ({
        mpn: p.ManufacturerPartNumber || "",
        manufacturer: p.Manufacturer || "",
        description: p.Description || "",
        category: p.Category || "",
        datasheetUrl: p.DataSheetUrl || null,
        mouserPN: p.MouserPartNumber || "",
        countryOfOrigin: (p.CountryOfOrigin || "").toUpperCase(),
        stock: parseInt(String(p.Availability || "0").replace(/[^0-9]/g, "")) || 0,
        price: (() => {
          const breaks = p.PriceBreaks || [];
          if (breaks.length === 0) return null;
          return parseFloat(String(breaks[0].Price || "0").replace(/[^0-9.]/g, "")) || null;
        })(),
        reelQty: (() => {
          const breaks = p.PriceBreaks || [];
          if (breaks.length === 0) return null;
          const last = breaks[breaks.length - 1];
          return parseInt(last.Quantity) || null;
        })(),
        specs: {},
      }));

      return res.status(200).json({ results, count: results.length, source: "mouser" });
    } catch (err) {
      console.error("[search-components] Mouser error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Fallback to Nexar
  if (token) {
    const query = `query SearchParts($q: String!, $limit: Int!, $start: Int) {
      supSearch(q: $q, limit: $limit, start: $start) {
        hits
        results {
          part {
            mpn
            manufacturer { name }
            shortDescription
            category { name }
          }
        }
      }
    }`;

    try {
      const allResults = [];
      let start = 0;
      const pageSize = Math.min(maxResults, 100);
      let totalHits = Infinity;

      while (start < totalHits && start < maxResults) {
        const response = await fetch("https://api.nexar.com/graphql", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, variables: { q, limit: pageSize, start } }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return res.status(response.status).json({ error: `Nexar API error: ${response.status}`, details: errText.substring(0, 300) });
        }

        const data = await response.json();
        if (data.errors) return res.status(400).json({ error: data.errors[0]?.message || "Nexar error" });

        totalHits = data?.data?.supSearch?.hits || 0;
        const pageResults = data?.data?.supSearch?.results || [];
        if (pageResults.length === 0) break;

        allResults.push(...pageResults.map(r => ({
          mpn: r.part.mpn || "",
          manufacturer: r.part.manufacturer?.name || "",
          description: r.part.shortDescription || "",
          category: r.part.category?.name || "",
          countryOfOrigin: (r.part.countryOfOrigin || "").toUpperCase(),
        })));

        start += pageSize;
      }

      return res.status(200).json({ results: allResults, count: allResults.length, totalHits, source: "nexar" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Provide mouserKey or token" });
}
