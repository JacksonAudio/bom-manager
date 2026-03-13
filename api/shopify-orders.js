// Vercel Serverless Function — Shopify Orders Proxy
// Fetches unfulfilled orders from a single Shopify store
// Uses Client Credentials grant (Dev Dashboard apps) — tokens expire every 24h

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

    // Fetch unfulfilled orders (paginate up to 250 per page)
    const allOrders = [];
    let url = `https://${domain}/admin/api/2024-01/orders.json?status=open&limit=250`;

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

    // Filter to unfulfilled/partial orders and aggregate demand
    const demand = {};
    const orderSummaries = [];

    for (const order of allOrders) {
      if (order.cancelled_at) continue;

      const lineItems = (order.line_items || []).map(li => ({
        title: li.title,
        productId: String(li.product_id),
        variantTitle: li.variant_title || "",
        quantity: li.quantity,
        fulfilledQty: li.fulfillable_quantity != null
          ? li.quantity - li.fulfillable_quantity
          : 0,
        unfulfilled: li.fulfillable_quantity != null
          ? li.fulfillable_quantity
          : li.quantity,
      }));

      orderSummaries.push({
        id: String(order.id),
        name: order.name,
        createdAt: order.created_at,
        financialStatus: order.financial_status,
        fulfillmentStatus: order.fulfillment_status || "unfulfilled",
        lineItems,
      });

      for (const li of lineItems) {
        if (li.unfulfilled <= 0) continue;
        const key = li.productId;
        if (!demand[key]) {
          demand[key] = { shopifyProductId: li.productId, title: li.title, totalUnfulfilled: 0 };
        }
        demand[key].totalUnfulfilled += li.unfulfilled;
      }
    }

    return res.status(200).json({
      products: Object.values(demand),
      orders: orderSummaries,
      totalOrders: orderSummaries.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("shopify-orders error:", e);
    return res.status(500).json({ error: e.message });
  }
}
