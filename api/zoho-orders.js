// Vercel Serverless Function — Zoho Books Sales Orders Proxy
// Fetches open sales orders from Zoho Books for dealer/wholesale demand planning
// Uses OAuth2 refresh token flow

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Accept params from query string (GET) or body (POST)
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const { org_id, client_id, client_secret, refresh_token } = params;

    if (!org_id || !client_id || !client_secret || !refresh_token) {
      return res.status(400).json({ error: "Missing org_id, client_id, client_secret, or refresh_token" });
    }

    // Exchange refresh token for access token
    const tokenRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&refresh_token=${encodeURIComponent(refresh_token)}`,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      console.error("[zoho] Token failed:", tokenRes.status, errText.slice(0, 500));
      console.error("[zoho] client_id:", client_id?.slice(0, 20), "secret length:", client_secret?.length, "refresh length:", refresh_token?.length);
      return res.status(tokenRes.status).json({
        error: `Zoho token exchange failed: ${tokenRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const tokenData = await tokenRes.json();
    const access_token = tokenData.access_token;

    if (!access_token) {
      console.error("[zoho] No access_token:", JSON.stringify(tokenData).slice(0, 300));
      console.error("[zoho] client_id:", client_id?.slice(0, 20), "secret length:", client_secret?.length, "refresh length:", refresh_token?.length);
      return res.status(401).json({ error: "No access_token in Zoho response", detail: JSON.stringify(tokenData).slice(0, 500) });
    }

    // Fetch open sales orders (paginate)
    const allOrders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const soRes = await fetch(
        `https://www.zohoapis.com/books/v3/salesorders?organization_id=${encodeURIComponent(org_id)}&status=open&page=${page}&per_page=200`,
        {
          headers: {
            "Authorization": `Zoho-oauthtoken ${access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!soRes.ok) {
        const errText = await soRes.text().catch(() => "");
        return res.status(soRes.status).json({
          error: `Zoho Books API error: ${soRes.status}`,
          detail: errText.slice(0, 500),
        });
      }

      const data = await soRes.json();
      const orders = data.salesorders || [];
      allOrders.push(...orders);

      hasMore = data.page_context?.has_more_page || false;
      page++;
      if (page > 20) break; // safety limit
    }

    // For each order, fetch line item details
    const orderSummaries = [];
    const demand = {}; // { productId: { zohoProductId, title, totalUnfulfilled } }

    for (const order of allOrders) {
      // Fetch individual sales order for line items
      const detailRes = await fetch(
        `https://www.zohoapis.com/books/v3/salesorders/${order.salesorder_id}?organization_id=${encodeURIComponent(org_id)}`,
        {
          headers: {
            "Authorization": `Zoho-oauthtoken ${access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      let lineItems = [];
      let orderDetail = order;
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        orderDetail = detailData.salesorder || order;
        lineItems = (orderDetail.line_items || []).map(li => ({
          title: li.name || li.description || "",
          productId: String(li.item_id || ""),
          quantity: Math.round(li.quantity) || 0,
          rate: li.rate || 0,
          amount: li.item_total || 0,
        }));
      }

      orderSummaries.push({
        id: String(order.salesorder_id),
        name: order.salesorder_number || order.reference_number || `SO-${order.salesorder_id}`,
        date: order.date || order.created_time,
        createdAt: order.created_time || order.date,
        status: order.status,
        customerName: order.customer_name || "",
        total: order.total || 0,
        lineItems,
      });

      for (const li of lineItems) {
        if (li.quantity <= 0) continue;
        const key = li.productId || li.title;
        if (!demand[key]) {
          demand[key] = { zohoProductId: li.productId, title: li.title, totalUnfulfilled: 0, avgRate: 0, rateCount: 0 };
        }
        demand[key].totalUnfulfilled += li.quantity;
        if (li.rate > 0) {
          demand[key].avgRate = ((demand[key].avgRate * demand[key].rateCount) + li.rate) / (demand[key].rateCount + 1);
          demand[key].rateCount += 1;
        }
      }
    }

    // Clean up demand entries
    const products = Object.values(demand).map(d => ({
      zohoProductId: d.zohoProductId,
      title: d.title,
      totalUnfulfilled: d.totalUnfulfilled,
      avgRate: Math.round(d.avgRate * 100) / 100,
    }));

    return res.status(200).json({
      products,
      orders: orderSummaries,
      totalOrders: orderSummaries.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("zoho-orders error:", e);
    return res.status(500).json({ error: e.message });
  }
}
