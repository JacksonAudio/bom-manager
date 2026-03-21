// ============================================================
// api/ti-search.js — Texas Instruments Part Search
//
// OAuth2 client_credentials flow → TI product lookup.
// Returns pricing, stock, and MOQ data.
// ============================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { query, apiKey, apiSecret } = req.query;
  if (!query) return res.status(400).json({ error: "query is required" });
  if (!apiKey || !apiSecret) return res.status(400).json({ error: "apiKey and apiSecret are required" });

  try {
    // Step 1: Get OAuth2 access token
    const tokenRes = await fetch("https://transact.ti.com/v1/oauth/accesstoken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiSecret)}`,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[ti-search] OAuth error:", tokenRes.status, err.slice(0, 500));
      return res.status(502).json({ error: `TI OAuth error: ${tokenRes.status}`, details: err.slice(0, 300) });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(500).json({ error: "TI OAuth: no access_token", details: JSON.stringify(tokenData).slice(0, 300) });
    }

    // Step 2: Look up the specific part
    const productRes = await fetch(
      `https://transact.ti.com/v1/products/${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
    );

    if (!productRes.ok) {
      // Try the store search as fallback
      const storeRes = await fetch(
        `https://transact.ti.com/v2/store/products?q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
      );
      if (!storeRes.ok) {
        const err = await storeRes.text();
        console.error("[ti-search] Search error:", storeRes.status, err.slice(0, 500));
        return res.status(storeRes.status).json({ error: `TI API error: ${storeRes.status}`, details: err.slice(0, 300) });
      }
      const storeData = await storeRes.json();
      const products = storeData?.products || storeData?.data || [];
      const parts = products.map(mapProduct);
      return res.status(200).json({ parts, count: parts.length, source: "ti-store" });
    }

    const productData = await productRes.json();
    // Single product response — wrap in array
    const parts = [mapProduct(productData)];
    return res.status(200).json({ parts, count: parts.length, source: "ti-product" });

  } catch (err) {
    console.error("[ti-search] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

function mapProduct(p) {
  const tiPN = p.tiPartNumber || p.gpn || p.partNumber || p.opn || "";
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
