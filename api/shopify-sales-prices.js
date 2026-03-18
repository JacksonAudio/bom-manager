// Vercel Serverless Function — Shopify Sales Price Analytics
// Fetches completed/fulfilled orders from the last 90 days and computes
// average, min, max selling price per product.
// Uses same Client Credentials grant as shopify-orders.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { domain, client_id, client_secret } = req.query;

    if (!domain || !client_id || !client_secret) {
      return res.status(400).json({ error: "Missing domain, client_id, or client_secret" });
    }

    // Exchange client credentials for access token
    const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}`,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      return res.status(tokenRes.status).json({
        error: `Token exchange failed: ${tokenRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const { access_token } = await tokenRes.json();

    // Fetch fulfilled/closed orders from last 90 days (paginate)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const allOrders = [];

    // Fetch shipped orders
    let url = `https://${domain}/admin/api/2024-01/orders.json?status=any&fulfillment_status=shipped&created_at_min=${encodeURIComponent(since)}&limit=250`;

    while (url) {
      const shopRes = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
      });

      if (!shopRes.ok) {
        const errText = await shopRes.text().catch(() => "");
        return res.status(shopRes.status).json({
          error: `Shopify API error: ${shopRes.status}`,
          detail: errText.slice(0, 500),
        });
      }

      const data = await shopRes.json();
      allOrders.push(...(data.orders || []));

      const linkHeader = shopRes.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    // Also fetch closed orders from the same period
    url = `https://${domain}/admin/api/2024-01/orders.json?status=closed&created_at_min=${encodeURIComponent(since)}&limit=250`;

    while (url) {
      const shopRes = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
      });

      if (!shopRes.ok) break; // Non-critical — we already have shipped orders

      const data = await shopRes.json();
      // Deduplicate by order ID (some closed orders may also be shipped)
      const existingIds = new Set(allOrders.map(o => o.id));
      for (const order of (data.orders || [])) {
        if (!existingIds.has(order.id)) {
          allOrders.push(order);
          existingIds.add(order.id);
        }
      }

      const linkHeader = shopRes.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    // Aggregate per product
    const productMap = {}; // keyed by product_id

    for (const order of allOrders) {
      if (order.cancelled_at) continue;

      for (const li of (order.line_items || [])) {
        const productId = String(li.product_id);
        if (!productId || productId === "null") continue;

        const linePrice = parseFloat(li.price) || 0;
        // Calculate per-item discount
        const totalDiscount = (li.discount_allocations || []).reduce(
          (sum, d) => sum + (parseFloat(d.amount) || 0), 0
        );
        const perItemDiscount = li.quantity > 0 ? totalDiscount / li.quantity : 0;
        const effectivePrice = linePrice - perItemDiscount;
        const quantity = li.quantity || 1;

        if (!productMap[productId]) {
          productMap[productId] = {
            shopifyProductId: productId,
            title: li.title,
            prices: [],
            totalUnits: 0,
            totalRevenue: 0,
          };
        }

        const entry = productMap[productId];
        // Record the effective price for each unit sold
        for (let i = 0; i < quantity; i++) {
          entry.prices.push(effectivePrice);
        }
        entry.totalUnits += quantity;
        entry.totalRevenue += effectivePrice * quantity;
      }
    }

    // Compute stats
    const products = Object.values(productMap).map(p => {
      const prices = p.prices.sort((a, b) => a - b);
      const avgPrice = prices.length > 0 ? p.totalRevenue / p.totalUnits : 0;
      const minPrice = prices.length > 0 ? prices[0] : 0;
      const maxPrice = prices.length > 0 ? prices[prices.length - 1] : 0;

      return {
        shopifyProductId: p.shopifyProductId,
        title: p.title,
        avgPrice: Math.round(avgPrice * 100) / 100,
        minPrice: Math.round(minPrice * 100) / 100,
        maxPrice: Math.round(maxPrice * 100) / 100,
        unitsSold: p.totalUnits,
        totalRevenue: Math.round(p.totalRevenue * 100) / 100,
      };
    });

    return res.status(200).json({
      products,
      totalOrders: allOrders.length,
      periodDays: 90,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("shopify-sales-prices error:", e);
    return res.status(500).json({ error: e.message });
  }
}
