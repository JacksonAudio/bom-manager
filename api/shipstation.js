// Vercel Serverless Function — ShipStation Proxy
// Fetches shipment data via ShipStation V1 API (Basic Auth)
// Route via ?action=shipments|orders

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, api_key, api_secret, days } = req.query;

  if (!action) return res.status(400).json({ error: "Missing action param (shipments)" });
  if (!api_key || !api_secret) {
    return res.status(400).json({ error: "Missing api_key or api_secret" });
  }

  const authHeader = "Basic " + Buffer.from(`${api_key}:${api_secret}`).toString("base64");
  const baseUrl = "https://ssapi.shipstation.com";

  try {
    switch (action) {
      case "shipments":
        return await handleShipments(req, res, baseUrl, authHeader, days);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error(`shipstation (${action}) error:`, e);
    return res.status(500).json({ error: e.message });
  }
}

// Fetch all shipments within date range, paginated
async function handleShipments(req, res, baseUrl, authHeader, days) {
  const lookback = parseInt(days) || 90;
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - lookback * 86400000).toISOString().slice(0, 10);

  const allShipments = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${baseUrl}/shipments?shipDateStart=${startDate}&shipDateEnd=${endDate}&includeShipmentItems=true&pageSize=500&page=${page}&sortBy=ShipDate&sortDir=DESC`;

    const ssRes = await fetch(url, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    if (!ssRes.ok) {
      const errText = await ssRes.text().catch(() => "");
      return res.status(ssRes.status).json({
        error: `ShipStation API error: ${ssRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const data = await ssRes.json();
    allShipments.push(...(data.shipments || []));
    totalPages = data.pages || 1;
    page++;
  }

  // Filter out voided shipments and return labels
  const active = allShipments.filter(s => !s.voided && !s.isReturnLabel);

  // Aggregate units shipped by order number
  const orderShipments = {};
  for (const s of active) {
    const key = s.orderNumber || s.orderId;
    if (!key) continue;

    if (!orderShipments[key]) {
      orderShipments[key] = {
        orderNumber: s.orderNumber,
        orderId: s.orderId,
        shipments: [],
        totalItemsShipped: 0,
      };
    }

    const items = (s.shipmentItems || []).map(i => ({
      sku: i.sku || "",
      name: i.name || "",
      quantity: i.quantity || 0,
    }));

    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

    orderShipments[key].shipments.push({
      shipmentId: s.shipmentId,
      trackingNumber: s.trackingNumber || "",
      carrier: s.carrierCode || "",
      shipDate: s.shipDate || "",
      cost: s.shipmentCost || 0,
      items,
    });
    orderShipments[key].totalItemsShipped += itemCount;
  }

  // Summary stats
  const totalShipments = active.length;
  const totalUnitsShipped = active.reduce((sum, s) =>
    sum + (s.shipmentItems || []).reduce((s2, i) => s2 + (i.quantity || 0), 0), 0
  );
  const uniqueOrders = Object.keys(orderShipments).length;

  return res.status(200).json({
    shipments: Object.values(orderShipments),
    totalShipments,
    totalUnitsShipped,
    uniqueOrders,
    dateRange: { start: startDate, end: endDate, days: lookback },
    syncedAt: new Date().toISOString(),
  });
}
