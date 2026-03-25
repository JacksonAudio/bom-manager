// ============================================================
// api/ti-search.js — Texas Instruments Part Search
//
// Supports two auth modes:
// 1. Single API key (myTI dashboard) — passed as query param
// 2. OAuth2 client_credentials (older apps) — client_id + secret
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { query, apiKey, apiSecret } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

  try {
    let accessToken = null;
    const useOAuth = apiSecret && apiSecret.length > 5;

    if (useOAuth) {
      // OAuth2 client_credentials flow (older dual-key apps)
      const tokenRes = await fetch("https://transact.ti.com/v1/oauth/accesstoken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiSecret)}`,
      });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        accessToken = tokenData.access_token;
      }
      if (!accessToken) {
        console.warn("[ti-search] OAuth failed, falling back to API key auth");
      }
    }

    // Build auth headers — try Bearer token if we have one, otherwise use API key header
    const makeHeaders = () => {
      if (accessToken) return { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
      return { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey, Accept: "application/json" };
    };

    // Try multiple TI API endpoints in order
    const errors = [];

    // Attempt 1: Product details endpoint (v1)
    try {
      const r1 = await fetch(
        `https://transact.ti.com/v1/products/${encodeURIComponent(query)}`,
        { headers: makeHeaders() }
      );
      if (r1.ok) {
        const data = await r1.json();
        if (data) return res.status(200).json({ parts: [mapProduct(data)], count: 1, source: "ti-v1-product" });
      } else {
        errors.push(`v1/products: ${r1.status}`);
      }
    } catch (e) { errors.push(`v1/products: ${e.message}`); }

    // Attempt 2: Store inventory pricing (uses apikey as query param)
    try {
      const r2 = await fetch(
        `https://store.ti.com/octopart/api/v4/pricing?mpn=${encodeURIComponent(query)}`,
        { headers: { apikey: apiKey, Accept: "application/json" } }
      );
      if (r2.ok) {
        const data = await r2.json();
        const items = data?.products || data?.data || (Array.isArray(data) ? data : [data]);
        if (items.length > 0 && items[0]) {
          return res.status(200).json({ parts: items.map(mapProduct), count: items.length, source: "ti-store-pricing" });
        }
      } else {
        errors.push(`store-pricing: ${r2.status}`);
      }
    } catch (e) { errors.push(`store-pricing: ${e.message}`); }

    // Attempt 3: Transact store search (v2)
    try {
      const r3 = await fetch(
        `https://transact.ti.com/v2/store/products?q=${encodeURIComponent(query)}`,
        { headers: makeHeaders() }
      );
      if (r3.ok) {
        const data = await r3.json();
        const products = data?.products || data?.data || [];
        if (products.length > 0) {
          return res.status(200).json({ parts: products.map(mapProduct), count: products.length, source: "ti-v2-store" });
        }
      } else {
        errors.push(`v2/store: ${r3.status}`);
      }
    } catch (e) { errors.push(`v2/store: ${e.message}`); }

    // Attempt 4: Inventory/pricing endpoint with API key as query param
    try {
      const r4 = await fetch(
        `https://transact.ti.com/v1/products/${encodeURIComponent(query)}?apikey=${encodeURIComponent(apiKey)}`,
        { headers: { Accept: "application/json" } }
      );
      if (r4.ok) {
        const data = await r4.json();
        if (data) return res.status(200).json({ parts: [mapProduct(data)], count: 1, source: "ti-v1-apikey" });
      } else {
        errors.push(`v1-apikey: ${r4.status}`);
      }
    } catch (e) { errors.push(`v1-apikey: ${e.message}`); }

    // All attempts failed
    return res.status(404).json({
      error: "TI API: no results from any endpoint",
      attempts: errors,
      hint: "Check your API key at ti.com/myti/docs/overview.page",
    });

  } catch (err) {
    console.error("[ti-search] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

function mapProduct(p) {
  const tiPN = p.tiPartNumber || p.gpn || p.partNumber || p.opn || p.mpn || "";
  const rawBreaks = p.pricingTiers || p.priceBreaks || p.pricing || p.standardPricing || [];
  const priceBreaks = (Array.isArray(rawBreaks) ? rawBreaks : []).map(pb => ({
    qty: parseInt(pb.quantity || pb.minQuantity || pb.qty || pb.minQty || 1),
    price: parseFloat(pb.price || pb.unitPrice || pb.publicPrice || 0),
  })).filter(pb => pb.price > 0);

  const unitPrice = priceBreaks.length
    ? priceBreaks[0].price
    : parseFloat(p.buyNowPrice || p.unitPrice || p.price || p.publicPrice || 0);

  return {
    mpn: tiPN,
    description: p.description || p.shortDescription || p.genericDescription || "",
    stock: parseInt(p.inventoryQuantity || p.inventory || p.quantity || 0),
    price: unitPrice,
    moq: parseInt(p.minimumOrderQuantity || p.moq || p.minOrderQty || 1),
    url: tiPN ? `https://www.ti.com/product/${encodeURIComponent(tiPN)}` : "",
    priceBreaks,
  };
}
