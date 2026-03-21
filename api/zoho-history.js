// Vercel Serverless Function — Zoho Books Historical Sales Orders
// Fetches all sales orders (open, invoiced, closed) from Zoho Books going back 24 months
// Returns monthly totals per product for demand forecasting

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
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
      return res.status(tokenRes.status).json({
        error: `Zoho token exchange failed: ${tokenRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const tokenData = await tokenRes.json();
    const access_token = tokenData.access_token;

    if (!access_token) {
      return res.status(401).json({ error: "No access_token in Zoho response", detail: JSON.stringify(tokenData).slice(0, 500) });
    }

    // Date range: 24 months back
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const dateStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

    // Fetch sales orders with multiple statuses
    const statuses = ["open", "partially_invoiced", "invoiced", "closed"];
    const allOrders = [];

    for (const status of statuses) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const soRes = await fetch(
          `https://www.zohoapis.com/books/v3/salesorders?organization_id=${encodeURIComponent(org_id)}&status=${status}&date_start=${dateStr}&page=${page}&per_page=200&sort_column=date&sort_order=D`,
          {
            headers: {
              "Authorization": `Zoho-oauthtoken ${access_token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!soRes.ok) break; // Move to next status

        const data = await soRes.json();
        const orders = data.salesorders || [];
        allOrders.push(...orders);

        hasMore = data.page_context?.has_more_page || false;
        page++;
        if (page > 50) break; // safety limit
      }
    }

    // Deduplicate by salesorder_id
    const seenIds = new Set();
    const uniqueOrders = [];
    for (const order of allOrders) {
      if (!seenIds.has(order.salesorder_id)) {
        seenIds.add(order.salesorder_id);
        uniqueOrders.push(order);
      }
    }

    // Fetch line items for each order and aggregate by month
    const monthlyMap = {}; // { "2024-01": { products: { itemId: { title, productId, quantity, revenue } } } }

    for (const order of uniqueOrders) {
      const detailRes = await fetch(
        `https://www.zohoapis.com/books/v3/salesorders/${order.salesorder_id}?organization_id=${encodeURIComponent(org_id)}`,
        {
          headers: {
            "Authorization": `Zoho-oauthtoken ${access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!detailRes.ok) continue;

      const detailData = await detailRes.json();
      const orderDetail = detailData.salesorder || order;
      const lineItems = orderDetail.line_items || [];

      const dateVal = order.date || order.created_time;
      const date = new Date(dateVal);
      if (isNaN(date.getTime())) continue;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { products: {} };

      for (const li of lineItems) {
        const pid = String(li.item_id || li.name || li.description || "unknown");
        const title = li.name || li.description || "";
        const qty = Math.round(li.quantity) || 0;
        const revenue = li.item_total || 0;

        if (!title || qty <= 0) continue;

        if (!monthlyMap[monthKey].products[pid]) {
          monthlyMap[monthKey].products[pid] = {
            title,
            productId: pid,
            quantity: 0,
            revenue: 0,
          };
        }
        monthlyMap[monthKey].products[pid].quantity += qty;
        monthlyMap[monthKey].products[pid].revenue += revenue;
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
      totalOrders: uniqueOrders.length,
      monthsCovered: history.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("zoho-history error:", e);
    return res.status(500).json({ error: e.message });
  }
}
