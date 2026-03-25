// Vercel Serverless Function — ShipStation Proxy
// Fetches shipment data, carriers/rates, and creates shipping labels
// Route via ?action=shipments|carriers|rates|create-order|create-label

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // For GET requests, params come from query; for POST, merge body
  const query = req.query || {};
  const body = req.method === "POST" ? (req.body || {}) : {};
  const action = query.action || body.action;
  const api_key = query.api_key || body.api_key;
  const api_secret = query.api_secret || body.api_secret;

  if (!action) return res.status(400).json({ error: "Missing action param" });
  if (!api_key || !api_secret) return res.status(400).json({ error: "Missing api_key or api_secret" });

  const authHeader = "Basic " + Buffer.from(`${api_key}:${api_secret}`).toString("base64");
  const baseUrl = "https://ssapi.shipstation.com";

  try {
    switch (action) {
      case "shipments":
        return await handleShipments(req, res, baseUrl, authHeader, query.days);
      case "carriers":
        return await handleCarriers(res, baseUrl, authHeader);
      case "services":
        return await handleServices(res, baseUrl, authHeader, query.carrierCode || body.carrierCode);
      case "rates":
        return await handleRates(res, baseUrl, authHeader, body);
      case "create-order":
        return await handleCreateOrder(res, baseUrl, authHeader, body);
      case "create-label":
        return await handleCreateLabel(res, baseUrl, authHeader, body);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error(`shipstation (${action}) error:`, e);
    return res.status(500).json({ error: e.message });
  }
}

// ── List carriers connected to ShipStation account
async function handleCarriers(res, baseUrl, authHeader) {
  const ssRes = await fetch(`${baseUrl}/carriers`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!ssRes.ok) return res.status(ssRes.status).json({ error: `ShipStation ${ssRes.status}` });
  const carriers = await ssRes.json();
  return res.status(200).json({ carriers });
}

// ── List services for a specific carrier
async function handleServices(res, baseUrl, authHeader, carrierCode) {
  if (!carrierCode) return res.status(400).json({ error: "carrierCode required" });
  const ssRes = await fetch(`${baseUrl}/carriers/listservices?carrierCode=${encodeURIComponent(carrierCode)}`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!ssRes.ok) return res.status(ssRes.status).json({ error: `ShipStation ${ssRes.status}` });
  const services = await ssRes.json();
  return res.status(200).json({ services });
}

// ── Get shipping rates for a package
async function handleRates(res, baseUrl, authHeader, body) {
  const { carrierCode, serviceCode, fromPostalCode, toPostalCode, toCountry, toState, weight, dimensions } = body;
  if (!carrierCode || !fromPostalCode || !toPostalCode) {
    return res.status(400).json({ error: "carrierCode, fromPostalCode, toPostalCode required" });
  }

  const payload = {
    carrierCode,
    serviceCode: serviceCode || null,
    packageCode: "package",
    fromPostalCode,
    toPostalCode,
    toCountry: toCountry || "US",
    toState: toState || "",
    weight: weight || { value: 16, units: "ounces" },
    dimensions: dimensions || null,
    confirmation: "none",
    residential: true,
  };

  const ssRes = await fetch(`${baseUrl}/shipments/getrates`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `ShipStation rates error: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  const rates = await ssRes.json();
  return res.status(200).json({ rates });
}

// ── Create an order in ShipStation (needed before creating a label)
async function handleCreateOrder(res, baseUrl, authHeader, body) {
  const { orderNumber, orderDate, shipTo, items, weight } = body;
  if (!orderNumber || !shipTo) return res.status(400).json({ error: "orderNumber and shipTo required" });

  const payload = {
    orderNumber,
    orderDate: orderDate || new Date().toISOString(),
    orderStatus: "awaiting_shipment",
    shipTo: {
      name: shipTo.name || "",
      company: shipTo.company || "",
      street1: shipTo.street1 || "",
      street2: shipTo.street2 || "",
      city: shipTo.city || "",
      state: shipTo.state || "",
      postalCode: shipTo.postalCode || "",
      country: shipTo.country || "US",
      phone: shipTo.phone || "",
    },
    items: (items || []).map(i => ({
      sku: i.sku || "",
      name: i.name || "",
      quantity: i.quantity || 1,
      unitPrice: i.unitPrice || 0,
    })),
    weight: weight || { value: 16, units: "ounces" },
  };

  const ssRes = await fetch(`${baseUrl}/orders/createorder`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `Create order failed: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  const order = await ssRes.json();
  return res.status(200).json({ order });
}

// ── Create a shipping label for an order
async function handleCreateLabel(res, baseUrl, authHeader, body) {
  const { orderId, carrierCode, serviceCode, weight, dimensions, testLabel } = body;
  if (!orderId || !carrierCode || !serviceCode) {
    return res.status(400).json({ error: "orderId, carrierCode, serviceCode required" });
  }

  const payload = {
    orderId: parseInt(orderId),
    carrierCode,
    serviceCode,
    packageCode: "package",
    weight: weight || { value: 16, units: "ounces" },
    dimensions: dimensions || null,
    confirmation: "none",
    testLabel: testLabel || false,
  };

  const ssRes = await fetch(`${baseUrl}/orders/createlabelfororder`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `Create label failed: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  const label = await ssRes.json();
  return res.status(200).json({
    shipmentId: label.shipmentId,
    trackingNumber: label.trackingNumber,
    labelUrl: label.labelData ? `data:application/pdf;base64,${label.labelData}` : null,
    shipmentCost: label.shipmentCost,
    carrier: carrierCode,
    service: serviceCode,
  });
}

// ── Fetch all shipments within date range, paginated
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
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
    });
    if (!ssRes.ok) {
      const errText = await ssRes.text().catch(() => "");
      return res.status(ssRes.status).json({ error: `ShipStation API error: ${ssRes.status}`, detail: errText.slice(0, 500) });
    }
    const data = await ssRes.json();
    allShipments.push(...(data.shipments || []));
    totalPages = data.pages || 1;
    page++;
  }

  const active = allShipments.filter(s => !s.voided && !s.isReturnLabel);
  const orderShipments = {};
  for (const s of active) {
    const key = s.orderNumber || s.orderId;
    if (!key) continue;
    if (!orderShipments[key]) {
      orderShipments[key] = { orderNumber: s.orderNumber, orderId: s.orderId, shipments: [], totalItemsShipped: 0 };
    }
    const items = (s.shipmentItems || []).map(i => ({ sku: i.sku || "", name: i.name || "", quantity: i.quantity || 0 }));
    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    orderShipments[key].shipments.push({
      shipmentId: s.shipmentId, trackingNumber: s.trackingNumber || "",
      carrier: s.carrierCode || "", shipDate: s.shipDate || "", cost: s.shipmentCost || 0, items,
    });
    orderShipments[key].totalItemsShipped += itemCount;
  }

  const totalShipments = active.length;
  const totalUnitsShipped = active.reduce((sum, s) =>
    sum + (s.shipmentItems || []).reduce((s2, i) => s2 + (i.quantity || 0), 0), 0);
  const uniqueOrders = Object.keys(orderShipments).length;

  return res.status(200).json({
    shipments: Object.values(orderShipments), totalShipments, totalUnitsShipped, uniqueOrders,
    dateRange: { start: startDate, end: endDate, days: lookback }, syncedAt: new Date().toISOString(),
  });
}
