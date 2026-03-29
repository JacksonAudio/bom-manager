// ============================================================
// api/mouser-cart.js — Mouser Cart, Order Options, Order History & Pack Qty
//
// Actions:
//   cart (POST)         — create temp cart + get tariff fees
//   order-history (POST)— fetch all past orders with line items
//   pack-qty (POST)     — look up FactoryPackQty, cache in Supabase
// ============================================================

const MOUSER_CART_API = "https://api.mouser.com/api/v2/cart";
const MOUSER_ORDER_API = "https://api.mouser.com/api/v1/order";
const MOUSER_HISTORY_API = "https://api.mouser.com/api/v1/orderhistory";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const action = body.action || "cart";

  try {
    switch (action) {
      case "cart":
        return await handleCart(res, body);
      case "order-history":
        return await handleOrderHistory(res, body);
      case "order-detail":
        return await handleOrderDetail(res, body);
      case "pack-qty":
        return await handlePackQty(res, body);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`[mouser-cart] ${action} error:`, err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Cart + tariff detection (existing functionality)
async function handleCart(res, body) {
  const { apiKey, mouserPartNumber, quantity } = body;
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
  if (!mouserPartNumber) return res.status(400).json({ error: "mouserPartNumber is required" });

  const qty = parseInt(quantity) || 1;

  // Step 1: Create cart
  const cartRes = await fetch(`${MOUSER_CART_API}/items/insert?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      CartKey: "",
      CartItems: [{ MouserPartNumber: mouserPartNumber, Quantity: qty }],
    }),
  });

  if (!cartRes.ok) {
    const errText = await cartRes.text().catch(() => "");
    return res.status(cartRes.status).json({ error: `Cart API error: ${cartRes.status}`, detail: errText.slice(0, 500) });
  }

  const cartData = await cartRes.json();
  if (cartData.Errors?.length) {
    return res.status(400).json({ error: cartData.Errors.map(e => e.Message).join(", ") });
  }

  const cartKey = cartData.CartKey;
  const cartItems = cartData.CartItems || [];

  // Step 2: Get order options (where AdditionalFees appear)
  const optRes = await fetch(`${MOUSER_ORDER_API}/options/query?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ CartKey: cartKey }),
  });

  let options = {};
  if (optRes.ok) {
    options = await optRes.json();
  }

  const fees = [];
  let totalFees = 0;
  const allItems = [...cartItems, ...(options.CartItems || [])];

  for (const ci of allItems) {
    const itemFees = ci.AdditionalFees || ci.CartAdditionalFee || [];
    for (const fee of (Array.isArray(itemFees) ? itemFees : [])) {
      const amt = parseFloat(fee.ExtendedAmount || fee.Amount || 0);
      if (amt > 0) {
        fees.push({
          mpn: ci.MouserPartNumber || ci.PartNumber || mouserPartNumber,
          fee: amt, code: fee.Code || "tariff",
          description: fee.Description || "Tariff/Surcharge",
        });
        totalFees += amt;
      }
    }
  }

  const summaryFees = parseFloat(options.AdditionalFeesTotal || 0);
  if (summaryFees > 0 && totalFees === 0) totalFees = summaryFees;

  return res.status(200).json({
    cartKey, fees, totalFees,
    merchandiseTotal: parseFloat(options.MerchandiseTotal || options.SubTotal || 0),
    orderTotal: parseFloat(options.OrderTotal || options.Total || 0),
    hasTariff: totalFees > 0 || fees.length > 0,
    _cartItemCount: cartItems.length,
    _optionKeys: Object.keys(options),
  });
}

// ── Order History — fetch all past orders, then detail for each
async function handleOrderHistory(res, body) {
  const { apiKey, dateFilter, startDate, endDate } = body;
  if (!apiKey) return res.status(400).json({ error: "apiKey (Order API key) is required" });

  // Step 1: Get order list
  let historyUrl;
  if (startDate && endDate) {
    historyUrl = `${MOUSER_HISTORY_API}/ByDateRange?apiKey=${encodeURIComponent(apiKey)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  } else {
    historyUrl = `${MOUSER_HISTORY_API}/ByDateFilter?apiKey=${encodeURIComponent(apiKey)}&dateFilter=${encodeURIComponent(dateFilter || "All")}`;
  }

  const histRes = await fetch(historyUrl, {
    headers: { "Accept": "application/json" },
  });

  // Check for HTML response (wrong API key or invalid endpoint)
  const contentType = histRes.headers.get("content-type") || "";
  if (contentType.includes("text/html") || !contentType.includes("json")) {
    return res.status(403).json({
      error: "Mouser returned HTML instead of JSON — your Search API key won't work for Order History. You need a separate Order API key from mouser.com/api-hub (under 'Order API').",
    });
  }

  if (!histRes.ok) {
    const errText = await histRes.text().catch(() => "");
    return res.status(histRes.status).json({ error: `Mouser History API error: ${histRes.status}`, detail: errText.slice(0, 500) });
  }

  const histData = await histRes.json();
  if (histData.Errors?.length) {
    return res.status(400).json({ error: histData.Errors.map(e => e.Message).join(", ") });
  }

  const orderList = histData.OrderHistoryItems || [];

  // Step 2: Fetch detail for each order (with line items, tracking, pricing)
  const orders = [];
  for (const summary of orderList) {
    const soNum = summary.SalesOrderNumber;
    if (!soNum) continue;

    try {
      const detUrl = `${MOUSER_HISTORY_API}/salesOrderNumber?apiKey=${encodeURIComponent(apiKey)}&salesOrderNumber=${encodeURIComponent(soNum)}`;
      const detRes = await fetch(detUrl, { headers: { "Accept": "application/json" } });
      if (!detRes.ok) {
        // Still include the summary even if detail fails
        orders.push({
          salesOrderNumber: soNum,
          webOrderNumber: summary.WebOrderNumber || "",
          poNumber: summary.PoNumber || "",
          date: summary.DateCreated || "",
          status: summary.OrderStatusDisplay || "",
          buyer: summary.BuyerName || "",
          items: [],
          tracking: [],
          total: null,
          detailError: `${detRes.status}`,
        });
        continue;
      }
      const det = await detRes.json();
      const detail = det.OrderDetail || det;

      const items = (detail.OrderLines || []).map(line => ({
        mouserPN: line.ProductInfo?.MouserPartNumber || "",
        mpn: line.ProductInfo?.ManufacturerPartNumber || "",
        manufacturer: line.ProductInfo?.ManufacturerName || "",
        description: line.ProductInfo?.PartDescription || "",
        quantity: line.Quantity || 0,
        unitPrice: line.UnitPrice || 0,
        extPrice: line.ExtPrice || 0,
        tariffFees: (line.AdditionalFees || []).reduce((s, f) => s + parseFloat(f.extendedAmount || f.amount || 0), 0),
      }));

      const tracking = (detail.DeliveryDetail?.TrackingDetails || []).map(t => ({
        number: t.Number || "",
        link: t.Link || "",
      }));

      orders.push({
        salesOrderNumber: soNum,
        webOrderNumber: detail.WebOrderId || summary.WebOrderNumber || "",
        poNumber: detail.PaymentDetail?.PoNumber || summary.PoNumber || "",
        date: detail.OrderDate || summary.DateCreated || "",
        status: detail.OrderStatusName || summary.OrderStatusDisplay || "",
        buyer: detail.BuyerName || summary.BuyerName || "",
        shippingMethod: detail.DeliveryDetail?.ShippingMethodName || "",
        items,
        tracking,
        merchandiseTotal: detail.SummaryDetail?.MerchandiseTotal || "",
        orderTotal: detail.SummaryDetail?.OrderTotal || "",
        feesTotal: detail.SummaryDetail?.AdditionalFeesTotal || "",
      });
    } catch (e) {
      orders.push({
        salesOrderNumber: soNum,
        date: summary.DateCreated || "",
        status: summary.OrderStatusDisplay || "",
        items: [],
        tracking: [],
        detailError: e.message,
      });
    }
  }

  return res.status(200).json({
    totalOrders: orderList.length,
    orders,
    syncedAt: new Date().toISOString(),
  });
}

// ── Single order detail lookup
async function handleOrderDetail(res, body) {
  const { apiKey, salesOrderNumber } = body;
  if (!apiKey || !salesOrderNumber) return res.status(400).json({ error: "apiKey and salesOrderNumber required" });

  const detUrl = `${MOUSER_HISTORY_API}/salesOrderNumber?apiKey=${encodeURIComponent(apiKey)}&salesOrderNumber=${encodeURIComponent(salesOrderNumber)}`;
  const detRes = await fetch(detUrl, { headers: { "Accept": "application/json" } });
  if (!detRes.ok) {
    const errText = await detRes.text().catch(() => "");
    return res.status(detRes.status).json({ error: `Detail API error: ${detRes.status}`, detail: errText.slice(0, 500) });
  }
  return res.status(200).json(await detRes.json());
}

// ── Factory pack qty lookup + Supabase cache write
async function handlePackQty(res, body) {
  const { mpn, partId, apiKey, supabaseUrl, supabaseKey } = body;
  if (!mpn)    return res.status(400).json({ error: "mpn is required" });
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

  const mouserRes = await fetch(
    `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ SearchByPartRequest: { mouserPartNumber: mpn, partSearchOptions: "Exact" } }),
    }
  );

  if (!mouserRes.ok) {
    const errText = await mouserRes.text().catch(() => "");
    console.error(`[pack-qty] ${mpn}: Mouser ${mouserRes.status}`, errText.slice(0, 200));
    return res.json({ packQty: 0, error: `Mouser ${mouserRes.status}` });
  }

  const data = await mouserRes.json();
  if (data.Errors?.length) {
    return res.json({ packQty: 0, error: data.Errors.map(e => e.Message || e.Code).join(", ") });
  }

  const part    = data?.SearchResults?.Parts?.[0];
  const packQty = parseInt(part?.FactoryPackQty || part?.MultPackQty) || 0;
  const mouserPartNumber = part?.MouserPartNumber || "";

  // Write into parts.pricing.mouser so Phase 1 cache scan finds it on future runs
  if (packQty > 0 && partId && supabaseUrl && supabaseKey) {
    try {
      const fetchRes = await fetch(
        `${supabaseUrl}/rest/v1/parts?id=eq.${encodeURIComponent(partId)}&select=pricing`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (fetchRes.ok) {
        const rows = await fetchRes.json();
        const existing = rows?.[0]?.pricing || {};
        const merged = { ...existing, mouser: { ...(existing.mouser||{}), factoryPackQty: packQty, mouserPartNumber: mouserPartNumber || (existing.mouser?.mouserPartNumber) || "" } };
        await fetch(`${supabaseUrl}/rest/v1/parts?id=eq.${encodeURIComponent(partId)}`, {
          method: "PATCH",
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ pricing: merged }),
        });
      }
    } catch (e) { console.warn(`[pack-qty] ${mpn}: cache write failed —`, e.message); }
  }

  return res.json({ packQty, mouserPartNumber, source: "Mouser" });
}
