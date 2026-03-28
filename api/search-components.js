// ============================================================
// api/search-components.js — Component Search + McMaster-Carr
//
// action=mouser/nexar (default): keyword search via Mouser or Nexar
// action=mcmaster: product lookup via mTLS cert + bearer token auth
//   Required Vercel env vars for McMaster:
//     MCMASTER_PFX_B64  — base64-encoded Jackson-1.pfx
//     MCMASTER_PFX_PASS — PFX passphrase
//     MCMASTER_USERNAME — McMaster API username
//     MCMASTER_PASSWORD — McMaster API password
// ============================================================

import https from "https";

// ── McMaster-Carr helpers ────────────────────────────────────

const MCMASTER_BASE = "https://api.mcmaster.com/v1";

// Module-level token cache — reused across warm invocations
let _mmToken = null;
let _mmTokenExpires = 0;

function makeMcMasterAgent() {
  const pfxB64 = process.env.MCMASTER_PFX_B64;
  if (!pfxB64) throw new Error("MCMASTER_PFX_B64 env var not set");
  return new https.Agent({
    pfx: Buffer.from(pfxB64, "base64"),
    passphrase: process.env.MCMASTER_PFX_PASS || "",
    rejectUnauthorized: true,
  });
}

function httpsRequest(method, url, agent, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method, headers, agent },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("McMaster request timed out")));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getMcMasterToken(agent) {
  // Return cached token if still valid (with 5-min buffer)
  if (_mmToken && Date.now() < _mmTokenExpires - 300_000) return _mmToken;

  const username = process.env.MCMASTER_USERNAME;
  const password = process.env.MCMASTER_PASSWORD;
  if (!username || !password) throw new Error("MCMASTER_USERNAME / MCMASTER_PASSWORD env vars not set");

  const { status, body } = await httpsRequest(
    "POST", `${MCMASTER_BASE}/login`, agent,
    { UserName: username, Password: password }
  );

  if (status !== 200) throw new Error(`McMaster login failed (${status}): ${body.slice(0, 200)}`);
  const data = JSON.parse(body);
  if (!data.AuthToken) throw new Error("McMaster login returned no AuthToken");

  _mmToken = data.AuthToken;
  // ExpirationTS is ISO string; fall back to 23h from now
  _mmTokenExpires = data.ExpirationTS ? new Date(data.ExpirationTS).getTime() : Date.now() + 23 * 3600_000;
  return _mmToken;
}

function mapMcMasterProduct(info, price, requestedMpn) {
  // price endpoint returns array of { Amount, MinimumQuantity, UnitOfMeasure }
  const rawBreaks = Array.isArray(price) ? price : [];
  const priceBreaks = rawBreaks.map((pb) => ({
    qty:   parseInt(pb.MinimumQuantity || 1),
    price: parseFloat(pb.Amount || 0),
  })).filter((pb) => pb.price > 0).sort((a, b) => a.qty - b.qty);

  const unitPrice = priceBreaks.length ? priceBreaks[0].price : 0;

  // Pull datasheet/CAD links from Links array
  const links = info.Links || [];
  const datasheet = links.find(l => /datasheet/i.test(l.Key))?.Value || null;

  return {
    mpn:         info.PartNumber || requestedMpn,
    description: info.DetailDescription || info.FamilyDescription || "",
    stock:       null, // McMaster doesn't expose stock count via API
    unitPrice,
    priceBreaks,
    moq:         priceBreaks[0]?.qty || 1,
    url:         `https://www.mcmaster.com/${encodeURIComponent(info.PartNumber || requestedMpn)}/`,
    datasheet,
    countryOfOrigin: "US",
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
      const token = await getMcMasterToken(agent);

      if (mpn === "test" || !mpn) {
        return res.status(200).json({ ok: true, msg: "McMaster-Carr authenticated — connection ready" });
      }

      // Fetch product info and pricing in parallel
      const [infoRes, priceRes] = await Promise.all([
        httpsRequest("GET", `${MCMASTER_BASE}/products/${encodeURIComponent(mpn)}`, agent, null, token),
        httpsRequest("GET", `${MCMASTER_BASE}/products/${encodeURIComponent(mpn)}/price`, agent, null, token),
      ]);

      if (infoRes.status === 404) return res.status(200).json({ error: `Part not found at McMaster-Carr: ${mpn}` });
      if (infoRes.status === 401) {
        _mmToken = null; // invalidate cached token
        return res.status(401).json({ error: "McMaster-Carr auth failed — token may have expired" });
      }
      if (infoRes.status !== 200) return res.status(infoRes.status).json({ error: `McMaster-Carr API returned ${infoRes.status}`, raw: infoRes.body.slice(0, 300) });

      const info  = JSON.parse(infoRes.body);
      const price = priceRes.status === 200 ? JSON.parse(priceRes.body) : [];

      return res.status(200).json(mapMcMasterProduct(info, price, mpn));
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
