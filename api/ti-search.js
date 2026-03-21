// ============================================================
// api/ti-search.js — Texas Instruments Part Search
//
// OAuth2 client_credentials flow → TI Store product search.
// Returns parts with pricing, stock, and MOQ data.
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
      console.error("[ti-search] OAuth error:", err.slice(0, 500));
      return res.status(tokenRes.status).json({ error: `TI OAuth error: ${tokenRes.status}` });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(500).json({ error: "TI OAuth: no access_token in response" });
    }

    // Step 2: Search for products
    const searchRes = await fetch(
      `https://transact.ti.com/v2/store/products?q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!searchRes.ok) {
      const err = await searchRes.text();
      console.error("[ti-search] Search error:", err.slice(0, 500));
      return res.status(searchRes.status).json({ error: `TI search error: ${searchRes.status}` });
    }

    const searchData = await searchRes.json();
    const products = searchData?.products || searchData?.data || [];

    const parts = products.map(p => {
      const tiPN = p.tiPartNumber || p.gpn || "";
      const rawBreaks = p.pricingTiers || p.priceBreaks || p.pricing || [];
      const priceBreaks = rawBreaks.map(pb => ({
        qty: parseInt(pb.quantity || pb.minQuantity || pb.qty || 1),
        price: parseFloat(pb.price || pb.unitPrice || 0),
      })).filter(pb => pb.price > 0);

      const unitPrice = priceBreaks.length
        ? priceBreaks[0].price
        : parseFloat(p.buyNowPrice || p.unitPrice || p.price || 0);

      return {
        mpn: tiPN,
        description: p.description || p.shortDescription || "",
        stock: parseInt(p.inventoryQuantity || p.inventory || 0),
        price: unitPrice,
        moq: parseInt(p.minimumOrderQuantity || p.moq || 1),
        url: `https://www.ti.com/product/${encodeURIComponent(tiPN)}`,
        priceBreaks,
      };
    });

    return res.status(200).json({ parts, count: parts.length, source: "ti" });
  } catch (err) {
    console.error("[ti-search] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
