// ============================================================
// api/ti-search.js — Texas Instruments Store API (v2)
//
// Auth: OAuth2 client_credentials — requires client_id + client_secret
// The "API Key" from myTI dashboard is the client_id.
// The "API Secret" is the client_secret (same page, may need to regenerate).
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { query, apiKey, apiSecret } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  if (!apiKey) return res.status(400).json({ error: "apiKey (client_id) is required" });
  if (!apiSecret) return res.status(400).json({ error: "apiSecret (client_secret) is required — find it at ti.com/myti under API Keys" });

  try {
    // Step 1: OAuth2 token exchange
    const tokenRes = await fetch("https://transact.ti.com/v1/oauth/accesstoken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiSecret)}`,
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => "");
      return res.status(401).json({
        error: `TI OAuth failed (${tokenRes.status}) — check client_id and client_secret`,
        detail: errBody.slice(0, 200),
        hint: "Go to ti.com/myti → API Keys & Access. Your 'API Key' is the client_id, and you also need the 'API Secret' (client_secret).",
      });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(401).json({ error: "TI OAuth returned no access_token", hint: "Regenerate your credentials at ti.com/myti" });
    }

    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    // Step 2: Try exact part lookup first (v2)
    const encodedMpn = encodeURIComponent(query);
    const r1 = await fetch(
      `https://transact.ti.com/v2/store/products/${encodedMpn}?currency=USD`,
      { headers }
    );

    if (r1.ok) {
      const data = await r1.json();
      if (data && data.tiPartNumber) {
        return res.status(200).json({ parts: [mapProduct(data)], count: 1, source: "ti-v2-exact" });
      }
    }

    // Step 3: Search by GPN if exact lookup missed
    const r2 = await fetch(
      `https://transact.ti.com/v2/store/products?gpn=${encodedMpn}&page=0&size=20&currency=USD`,
      { headers }
    );

    if (r2.ok) {
      const data = await r2.json();
      const products = data?.products || data?.content || (Array.isArray(data) ? data : []);
      if (products.length > 0) {
        return res.status(200).json({ parts: products.map(mapProduct), count: products.length, source: "ti-v2-search" });
      }
    }

    // Neither endpoint returned results
    return res.status(404).json({
      error: "TI API: authenticated OK but no results for this part number",
      query,
      hint: "Part may not be available on ti.com store, or try a different variation of the MPN",
    });

  } catch (err) {
    console.error("[ti-search] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

function mapProduct(p) {
  const tiPN = p.tiPartNumber || p.genericPartNumber || p.gpn || p.partNumber || "";

  // v2 response: pricing is an array with currency + priceBreaks
  let rawBreaks = [];
  if (Array.isArray(p.pricing)) {
    const usdPricing = p.pricing.find(pr => (pr.currency || "USD") === "USD") || p.pricing[0];
    rawBreaks = usdPricing?.priceBreaks || [];
  }

  const priceBreaks = rawBreaks.map(pb => ({
    qty: parseInt(pb.priceBreakQuantity || pb.quantity || pb.qty || 1),
    price: parseFloat(pb.price || 0),
  })).filter(pb => pb.price > 0);

  const unitPrice = priceBreaks.length
    ? priceBreaks[0].price
    : parseFloat(p.buyNowPrice || p.unitPrice || p.price || 0);

  return {
    mpn: tiPN,
    description: p.description || p.shortDescription || "",
    stock: parseInt(p.quantity || p.inventoryQuantity || 0),
    price: unitPrice,
    moq: parseInt(p.minimumOrderQuantity || p.moq || 1),
    url: p.buyNowURL || (tiPN ? `https://www.ti.com/product/${encodeURIComponent(tiPN)}` : ""),
    priceBreaks,
  };
}
