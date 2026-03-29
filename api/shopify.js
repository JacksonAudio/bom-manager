// Vercel Serverless Function — Shopify Combined Proxy
// Combines: shopify-orders, shopify-products, shopify-sales-prices, shopify-history
// Route via ?action=orders|products|sales-prices|history

// ── Pure helpers (exported for testing) ─────────────────────────────────────

// Extract the "next" URL from a Shopify Link header
export function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

// Determine if a line item title is a non-product (shipping, gift card, etc.)
const NON_PRODUCT_WORDS = ["shipping", "gift card", "tip", "gratuity", "donation", "insurance", "handling", "gift wrap", "express shipping"];
export function isNonProduct(title) {
  const t = (title || "").toLowerCase();
  return NON_PRODUCT_WORDS.some(w => t.includes(w));
}

// Calculate the effective per-unit price after discount allocations
export function calcEffectiveLinePrice(linePrice, discountAllocations, quantity) {
  const totalDiscount = (discountAllocations || []).reduce(
    (sum, d) => sum + (parseFloat(d.amount) || 0), 0
  );
  const perItemDiscount = quantity > 0 ? totalDiscount / quantity : 0;
  return linePrice - perItemDiscount;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, domain, client_id, client_secret } = req.query;

  if (!action) return res.status(400).json({ error: "Missing action param (orders|products|sales-prices|history)" });
  if (!domain || !client_id || !client_secret) {
    return res.status(400).json({ error: "Missing domain, client_id, or client_secret" });
  }

  try {
    // Exchange client credentials for access token
    const tokenRes = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}`,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      console.error("[shopify] Token failed:", tokenRes.status, errText.slice(0, 300));
      return res.status(tokenRes.status).json({
        error: `Shopify API error: ${tokenRes.status}`,
        detail: errText.slice(0, 500),
      });
    }

    const { access_token } = await tokenRes.json();

    switch (action) {
      case "orders":
        return await handleOrders(req, res, domain, access_token);
      case "products":
        return await handleProducts(req, res, domain, access_token);
      case "sales-prices":
        return await handleSalesPrices(req, res, domain, access_token);
      case "history":
        return await handleHistory(req, res, domain, access_token);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error(`shopify (${action}) error:`, e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Orders ──────────────────────────────────────────────────────────────────────
async function handleOrders(req, res, domain, access_token) {
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
}

// ── Products ────────────────────────────────────────────────────────────────────
async function handleProducts(req, res, domain, access_token) {
  const allProducts = [];
  let url = `https://${domain}/admin/api/2024-01/products.json?fields=id,title,variants,status,product_type,vendor,tags,images&limit=250`;

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
    allProducts.push(...(data.products || []));

    const linkHeader = shopRes.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }

  const products = allProducts.map(p => ({
    id: String(p.id),
    title: p.title,
    status: p.status,
    productType: p.product_type || "",
    vendor: p.vendor || "",
    tags: p.tags || "",
    imageUrl: p.images?.[0]?.src || null,
    variants: (p.variants || []).map(v => ({
      id: String(v.id),
      title: v.title,
      sku: v.sku || "",
      price: v.price || "",
      barcode: v.barcode || "",
      inventoryQuantity: v.inventory_quantity ?? null,
      option1: v.option1 || null,
      option2: v.option2 || null,
      option3: v.option3 || null,
    })),
  }));

  return res.status(200).json({ products });
}

// ── Sales Prices ────────────────────────────────────────────────────────────────
async function handleSalesPrices(req, res, domain, access_token) {
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

    if (!shopRes.ok) break;

    const data = await shopRes.json();
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
  const productMap = {};

  for (const order of allOrders) {
    if (order.cancelled_at) continue;

    for (const li of (order.line_items || [])) {
      const productId = String(li.product_id);
      if (!productId || productId === "null") continue;

      const linePrice = parseFloat(li.price) || 0;
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
      for (let i = 0; i < quantity; i++) {
        entry.prices.push(effectivePrice);
      }
      entry.totalUnits += quantity;
      entry.totalRevenue += effectivePrice * quantity;
    }
  }

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
}

// ── History ─────────────────────────────────────────────────────────────────────
async function handleHistory(req, res, domain, access_token) {
  const since = new Date();
  since.setMonth(since.getMonth() - 24);
  const createdAtMin = since.toISOString();

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

  // Also fetch closed orders
  let closedUrl = `https://${domain}/admin/api/2024-01/orders.json?status=closed&created_at_min=${encodeURIComponent(createdAtMin)}&limit=250`;
  const seenIds = new Set(allOrders.map(o => o.id));

  while (closedUrl) {
    const shopRes = await fetch(closedUrl, {
      headers: {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json",
      },
    });

    if (!shopRes.ok) break;

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

  const monthlyMap = {};

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
}
