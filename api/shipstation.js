// Vercel Serverless Function — ShipStation Proxy
// Fetches shipment data, carriers/rates, and creates shipping labels
// Route via ?action=shipments|carriers|services|rates|create-order|create-label

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

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

// ── List carriers
async function handleCarriers(res, baseUrl, authHeader) {
  const ssRes = await fetch(`${baseUrl}/carriers`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!ssRes.ok) return res.status(ssRes.status).json({ error: `ShipStation ${ssRes.status}` });
  return res.status(200).json({ carriers: await ssRes.json() });
}

// ── List services for carrier
async function handleServices(res, baseUrl, authHeader, carrierCode) {
  if (!carrierCode) return res.status(400).json({ error: "carrierCode required" });
  const ssRes = await fetch(`${baseUrl}/carriers/listservices?carrierCode=${encodeURIComponent(carrierCode)}`, {
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
  });
  if (!ssRes.ok) return res.status(ssRes.status).json({ error: `ShipStation ${ssRes.status}` });
  return res.status(200).json({ services: await ssRes.json() });
}

// ── Get shipping rates
async function handleRates(res, baseUrl, authHeader, body) {
  const { carrierCode, serviceCode, fromPostalCode, toPostalCode, toCountry, toState, weight, dimensions } = body;
  if (!carrierCode || !fromPostalCode || !toPostalCode) {
    return res.status(400).json({ error: "carrierCode, fromPostalCode, toPostalCode required" });
  }
  const ssRes = await fetch(`${baseUrl}/shipments/getrates`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      carrierCode, serviceCode: serviceCode || null, packageCode: "package",
      fromPostalCode, toPostalCode, toCountry: toCountry || "US", toState: toState || "",
      weight: weight || { value: 16, units: "ounces" }, dimensions: dimensions || null,
      confirmation: "none", residential: true,
    }),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `Rates error: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  return res.status(200).json({ rates: await ssRes.json() });
}

// ── Create order in ShipStation
async function handleCreateOrder(res, baseUrl, authHeader, body) {
  const { orderNumber, orderDate, shipTo, items, weight } = body;
  if (!orderNumber || !shipTo) return res.status(400).json({ error: "orderNumber and shipTo required" });
  const ssRes = await fetch(`${baseUrl}/orders/createorder`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNumber, orderDate: orderDate || new Date().toISOString(),
      orderStatus: "awaiting_shipment",
      shipTo: { name: shipTo.name||"", company: shipTo.company||"", street1: shipTo.street1||"",
        street2: shipTo.street2||"", city: shipTo.city||"", state: shipTo.state||"",
        postalCode: shipTo.postalCode||"", country: shipTo.country||"US", phone: shipTo.phone||"" },
      items: (items || []).map(i => ({ sku: i.sku||"", name: i.name||"", quantity: i.quantity||1, unitPrice: i.unitPrice||0 })),
      weight: weight || { value: 16, units: "ounces" },
    }),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `Create order failed: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  return res.status(200).json({ order: await ssRes.json() });
}

// ── Create shipping label
async function handleCreateLabel(res, baseUrl, authHeader, body) {
  const { orderId, carrierCode, serviceCode, weight, dimensions, testLabel } = body;
  if (!orderId || !carrierCode || !serviceCode) {
    return res.status(400).json({ error: "orderId, carrierCode, serviceCode required" });
  }
  const ssRes = await fetch(`${baseUrl}/orders/createlabelfororder`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: parseInt(orderId), carrierCode, serviceCode, packageCode: "package",
      weight: weight || { value: 16, units: "ounces" }, dimensions: dimensions || null,
      confirmation: "none", testLabel: testLabel || false,
    }),
  });
  if (!ssRes.ok) {
    const errText = await ssRes.text().catch(() => "");
    return res.status(ssRes.status).json({ error: `Create label failed: ${ssRes.status}`, detail: errText.slice(0, 500) });
  }
  const label = await ssRes.json();
  return res.status(200).json({
    shipmentId: label.shipmentId, trackingNumber: label.trackingNumber,
    labelUrl: label.labelData ? `data:application/pdf;base64,${label.labelData}` : null,
    shipmentCost: label.shipmentCost, carrier: carrierCode, service: serviceCode,
  });
}

// ── Fetch ALL shipped orders — paginate through entire history
async function handleShipments(req, res, baseUrl, authHeader, days) {
  const headers = { Authorization: authHeader, "Content-Type": "application/json" };

  // Fetch ALL shipped orders — no date filter so we get full history
  const allOrders = [];
  let page = 1;
  let totalPages = 1;
  let apiPages = 0;

  while (page <= totalPages && page <= 50) { // safety cap at 50 pages (25,000 orders)
    const url = `${baseUrl}/orders?orderStatus=shipped&pageSize=500&page=${page}&sortBy=OrderDate&sortDir=DESC`;
    const oRes = await fetch(url, { headers });
    if (!oRes.ok) {
      if (allOrders.length > 0) break; // return partial data on error
      const errText = await oRes.text().catch(() => "");
      return res.status(oRes.status).json({ error: `ShipStation API error: ${oRes.status}`, detail: errText.slice(0, 500) });
    }
    const oData = await oRes.json();
    const batch = oData.orders || [];
    allOrders.push(...batch);
    totalPages = oData.pages || 1;
    apiPages = totalPages;
    page++;
    // If this page was empty, stop
    if (batch.length === 0) break;
  }

  // Also fetch recent shipments for tracking numbers
  const trackingMap = {};
  const now = new Date();
  // Fetch shipments going back further — up to 1 year for tracking data
  for (const lookbackDays of [90, 180, 365]) {
    const shipStart = new Date(now.getTime() - lookbackDays * 86400000).toISOString().slice(0, 10);
    const shipEnd = lookbackDays === 90 ? now.toISOString().slice(0, 10)
      : new Date(now.getTime() - (lookbackDays - 90) * 86400000).toISOString().slice(0, 10);
    // Only fetch older chunks if we have enough orders to warrant it
    if (lookbackDays > 90 && allOrders.length < 500) break;

    let sPage = 1;
    let sTotalPages = 1;
    while (sPage <= sTotalPages && sPage <= 10) {
      try {
        const sUrl = `${baseUrl}/shipments?shipDateStart=${shipStart}&shipDateEnd=${lookbackDays === 90 ? now.toISOString().slice(0,10) : shipEnd}&includeShipmentItems=true&pageSize=500&page=${sPage}&sortBy=ShipDate&sortDir=DESC`;
        const sRes = await fetch(sUrl, { headers });
        if (!sRes.ok) break;
        const sData = await sRes.json();
        for (const s of (sData.shipments || [])) {
          if (s.voided || s.isReturnLabel) continue;
          const key = s.orderNumber || s.orderId;
          if (!key || trackingMap[key]) continue;
          trackingMap[key] = [{
            shipmentId: s.shipmentId, trackingNumber: s.trackingNumber || "",
            carrier: s.carrierCode || "", shipDate: s.shipDate || "",
            cost: s.shipmentCost || 0,
            items: (s.shipmentItems || []).map(i => ({ sku: i.sku||"", name: i.name||"", quantity: i.quantity||0 })),
          }];
        }
        sTotalPages = sData.pages || 1;
        sPage++;
      } catch { break; }
    }
  }

  // Deduplicate orders by orderNumber
  const seen = new Set();
  const uniqueOrders = [];
  for (const o of allOrders) {
    const key = o.orderNumber || o.orderId;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const shipments = trackingMap[key] || [];
    // For older orders without shipment tracking data, create a stub from order data
    if (shipments.length === 0 && o.shipDate) {
      shipments.push({
        shipmentId: null, trackingNumber: "", carrier: o.carrierCode || "",
        shipDate: o.shipDate, cost: 0, items: [],
      });
    }

    const totalItemsShipped = (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0);

    // Calculate lead time
    let leadTimeDays = null;
    if (o.orderDate && shipments.length > 0 && shipments[0].shipDate) {
      const ordered = new Date(o.orderDate);
      const shipped = new Date(shipments[0].shipDate);
      leadTimeDays = Math.max(0, Math.round((shipped - ordered) / 86400000));
    }

    uniqueOrders.push({
      orderNumber: o.orderNumber, orderId: o.orderId,
      orderDate: o.orderDate || o.createDate || null,
      shipments, totalItemsShipped, leadTimeDays,
    });
  }

  // Sort by ship date descending
  uniqueOrders.sort((a, b) => {
    const aDate = a.shipments[0]?.shipDate || a.orderDate || "";
    const bDate = b.shipments[0]?.shipDate || b.orderDate || "";
    return bDate.localeCompare(aDate);
  });

  // Stats
  const totalShipments = uniqueOrders.reduce((s, o) => s + o.shipments.length, 0);
  const totalUnitsShipped = uniqueOrders.reduce((s, o) => s + o.totalItemsShipped, 0);
  const withLead = uniqueOrders.filter(o => o.leadTimeDays != null);
  const avgLeadTime = withLead.length > 0 ? (withLead.reduce((s, o) => s + o.leadTimeDays, 0) / withLead.length) : null;

  // no longer used for filtering, but compute for display
  return res.status(200).json({
    shipments: uniqueOrders,
    totalShipments,
    totalUnitsShipped,
    uniqueOrders: uniqueOrders.length,
    avgLeadTimeDays: avgLeadTime != null ? Math.round(avgLeadTime * 10) / 10 : null,
    dateRange: {
      start: uniqueOrders.length > 0 ? (uniqueOrders[uniqueOrders.length-1].orderDate || "?") : "?",
      end: now.toISOString().slice(0, 10),
      days: 0,
    },
    debug: {
      rawOrdersFetched: allOrders.length,
      apiPagesAvailable: apiPages,
      pagesFetched: page - 1,
      trackingOrdersMatched: Object.keys(trackingMap).length,
      oldestOrder: allOrders.length > 0 ? (allOrders[allOrders.length-1]?.orderDate || allOrders[allOrders.length-1]?.createDate) : null,
      newestOrder: allOrders.length > 0 ? (allOrders[0]?.orderDate || allOrders[0]?.createDate) : null,
    },
    syncedAt: new Date().toISOString(),
  });
}
