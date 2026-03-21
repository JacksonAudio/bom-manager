// Vercel Serverless Function — Shopify Historical Orders
// Fetches completed/fulfilled orders from Shopify going back 24 months
// Returns monthly totals per product for demand forecasting

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

    // Go back 24 months
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const createdAtMin = since.toISOString();

    // Fetch fulfilled/closed orders with pagination
    const allOrders = [];
    let url = `https://${domain}/admin/api/2024-01/orders.json?status=any&fulfillment_status=shipped&created_at_min=${encodeURIComponent(createdAtMin)}&limit=250`;

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

    // Also fetch closed orders (different fulfillment path)
    let closedUrl = `https://${domain}/admin/api/2024-01/orders.json?status=closed&created_at_min=${encodeURIComponent(createdAtMin)}&limit=250`;
    const seenIds = new Set(allOrders.map(o => o.id));

    while (closedUrl) {
      const shopRes = await fetch(closedUrl, {
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
        },
      });

      if (!shopRes.ok) break; // Non-critical, continue with what we have

      const data = await shopRes.json();
      for (const order of (data.orders || [])) {
        if (!seenIds.has(order.id)) {
          allOrders.push(order);
          seenIds.add(order.id);
        }
      }

      const linkHeader = shopRes.headers.get("Link") || "";
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      closedUrl = nextMatch ? nextMatch[1] : null;
    }

    // Aggregate by month and product
    const skipWords = ["shipping", "gift card", "tip", "gratuity", "donation", "insurance", "handling", "gift wrap", "express shipping"];
    const isNonProduct = (title) => {
      const t = (title || "").toLowerCase();
      return skipWords.some(w => t.includes(w));
    };

    const monthlyMap = {}; // { "2024-01": { products: { productId: { title, productId, quantity, revenue } } } }

    for (const order of allOrders) {
      if (order.cancelled_at) continue;

      const date = new Date(order.created_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { products: {} };

      for (const li of (order.line_items || [])) {
        if (isNonProduct(li.title)) continue;
        const pid = String(li.product_id || li.title);

        if (!monthlyMap[monthKey].products[pid]) {
          monthlyMap[monthKey].products[pid] = {
            title: li.title,
            productId: pid,
            quantity: 0,
            revenue: 0,
          };
        }
        monthlyMap[monthKey].products[pid].quantity += (li.quantity || 0);
        monthlyMap[monthKey].products[pid].revenue += parseFloat(li.price || 0) * (li.quantity || 0);
      }
    }

    // Convert to sorted array
    const history = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        products: Object.values(data.products),
      }));

    return res.status(200).json({
      history,
      totalOrders: allOrders.filter(o => !o.cancelled_at).length,
      monthsCovered: history.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("shopify-history error:", e);
    return res.status(500).json({ error: e.message });
  }
}
