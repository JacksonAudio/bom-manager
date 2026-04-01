// Vercel Serverless Function — Zoho Books Combined Proxy
// Combines: zoho-orders, zoho-history
// Route via ?action=orders|history

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Accept params from query string (GET) or body (POST)
  const params = req.method === "POST" ? { ...(req.body || {}), ...(req.query || {}) } : (req.query || {});
  const { action, org_id, client_id, client_secret, refresh_token, grant_code } = params;

  if (!action) return res.status(400).json({ error: "Missing action param" });

  // ── Grant code exchange — swap a Self Client authorization code for a refresh token
  // This must run before the standard refresh_token check below
  if (action === "exchange") {
    if (!client_id || !client_secret || !grant_code) {
      return res.status(400).json({ error: "Missing client_id, client_secret, or grant_code" });
    }
    const { region } = params;
    const ZOHO_ACCOUNTS = {
      com: "https://accounts.zoho.com",
      eu:  "https://accounts.zoho.eu",
      in:  "https://accounts.zoho.in",
      au:  "https://accounts.zoho.com.au",
      jp:  "https://accounts.zoho.jp",
      uk:  "https://accounts.zoho.uk",
      ca:  "https://accounts.zohocloud.ca",
    };
    const accountsBase = ZOHO_ACCOUNTS[region] || ZOHO_ACCOUNTS.com;
    try {
      const r = await fetch(`${accountsBase}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&client_id=${encodeURIComponent(client_id)}&client_secret=${encodeURIComponent(client_secret)}&redirect_uri=&code=${encodeURIComponent(grant_code)}`,
      });
      const data = await r.json();
      console.log("[zoho exchange] response:", JSON.stringify(data).slice(0, 300));
      if (data.error) return res.status(400).json({ error: data.error, detail: JSON.stringify(data) });
      if (!data.refresh_token) return res.status(400).json({ error: "No refresh_token in response", detail: JSON.stringify(data) });
      return res.status(200).json({ ok: true, refresh_token: data.refresh_token, access_token: data.access_token });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!org_id || !client_id || !client_secret || !refresh_token) {
    return res.status(400).json({ error: "Missing org_id, client_id, client_secret, or refresh_token" });
  }

  try {
    // Exchange refresh token for access token (shared by all actions)
    const { region } = params;
    const ZOHO_ACCOUNTS_REFRESH = { com:"https://accounts.zoho.com", eu:"https://accounts.zoho.eu", in:"https://accounts.zoho.in", au:"https://accounts.zoho.com.au", jp:"https://accounts.zoho.jp", uk:"https://accounts.zoho.uk", ca:"https://accounts.zohocloud.ca" };
    const accountsBase = ZOHO_ACCOUNTS_REFRESH[region] || ZOHO_ACCOUNTS_REFRESH.com;
    const tokenRes = await fetch(`${accountsBase}/oauth/v2/token`, {
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

    switch (action) {
      case "ping":
        return res.status(200).json({ ok: true, msg: `Authenticated — org ${org_id}`, org_id });
      case "orders":
        return await handleOrders(req, res, org_id, access_token);
      case "history":
        return await handleHistory(req, res, org_id, access_token);
      case "contacts":
        return await handleContacts(req, res, org_id, access_token);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error(`zoho (${action}) error:`, e);
    return res.status(500).json({ error: e.message });
  }
}

// ── Orders ──────────────────────────────────────────────────────────────────────
async function handleOrders(req, res, org_id, access_token) {
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
    if (page > 20) break;
  }

  // For each order, fetch line item details
  const orderSummaries = [];
  const demand = {};

  for (const order of allOrders) {
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
        quantityShipped: Math.round(li.quantity_shipped || 0),
        quantityPacked: Math.round(li.quantity_packed || 0),
        rate: li.rate || 0,
        amount: li.item_total || 0,
      }));
    }

    // Extract full contact/shipping info from detail
    const contact = orderDetail.contact_persons?.[0] || {};
    const billing = orderDetail.billing_address || {};
    const shipping = orderDetail.shipping_address || {};

    orderSummaries.push({
      id: String(order.salesorder_id),
      name: order.salesorder_number || order.reference_number || `SO-${order.salesorder_id}`,
      referenceNumber: order.reference_number || "",
      dealerPO: orderDetail.reference_number || order.reference_number || "",
      dueDate: orderDetail.delivery_date || orderDetail.shipment_date || order.delivery_date || "",
      date: order.date || order.created_time,
      createdAt: order.created_time || order.date,
      status: order.status,
      // dealerName = actual customer/buyer (e.g. "Sound Sharing Co.")
      // brandName  = Zoho org/seller (e.g. "Fulltone USA Inc.")
      dealerName: order.customer_name || "",
      customerName: order.customer_name || "",
      companyName: order.customer_name || "",
      brandName: orderDetail.company_name || "",
      contactName: contact.first_name ? `${contact.first_name} ${contact.last_name || ""}`.trim() : "",
      email: contact.email || orderDetail.email || "",
      phone: contact.phone || contact.mobile || orderDetail.phone || "",
      shippingAddress: {
        attention: shipping.attention || "",
        street: shipping.address || shipping.street2 || "",
        city: shipping.city || "",
        state: shipping.state || "",
        zip: shipping.zip || "",
        country: shipping.country || "",
        phone: shipping.phone || "",
      },
      billingAddress: {
        attention: billing.attention || "",
        street: billing.address || billing.street2 || "",
        city: billing.city || "",
        state: billing.state || "",
        zip: billing.zip || "",
        country: billing.country || "",
      },
      shippingMethod: orderDetail.shipping_charge_name || orderDetail.delivery_method || "",
      notes: orderDetail.notes || "",
      terms: orderDetail.terms || "",
      total: order.total || 0,
      subTotal: orderDetail.sub_total || order.total || 0,
      shippingCharge: orderDetail.shipping_charge || 0,
      discount: orderDetail.discount_total || orderDetail.discount || 0,
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
}

// ── History ─────────────────────────────────────────────────────────────────────
async function handleHistory(req, res, org_id, access_token) {
  const since = new Date();
  since.setMonth(since.getMonth() - 24);
  const dateStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

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

      if (!soRes.ok) break;

      const data = await soRes.json();
      const orders = data.salesorders || [];
      allOrders.push(...orders);

      hasMore = data.page_context?.has_more_page || false;
      page++;
      if (page > 50) break;
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
  const monthlyMap = {};

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
}

// ── Contacts ─────────────────────────────────────────────────────────────────
// Fetches ALL customer contacts from Zoho Books with full detail.
// Used to populate/update the Dealer Directory.
async function handleContacts(req, res, org_id, access_token) {
  const allContacts = [];
  let page = 1;
  let hasMore = true;

  // Fetch all contacts (no contact_type filter — filter vendor-only on client side)
  while (hasMore) {
    const url = `https://www.zohoapis.com/books/v3/contacts?organization_id=${encodeURIComponent(org_id)}&page=${page}&per_page=200`;
    const r = await fetch(url, { headers: { "Authorization": `Zoho-oauthtoken ${access_token}` } });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      console.error("[zoho contacts] list failed:", r.status, err.slice(0, 300));
      return res.status(r.status).json({ error: `Zoho contacts list failed: ${r.status}`, detail: err.slice(0, 500) });
    }
    const data = await r.json();
    console.log(`[zoho contacts] page ${page}: ${(data.contacts||[]).length} contacts, has_more=${data.page_context?.has_more_page}`);
    // Keep customers and contacts without a type (exclude vendor-only)
    const batch = (data.contacts || []).filter(c => !c.contact_type || c.contact_type !== "vendor");
    allContacts.push(...batch);
    hasMore = data.page_context?.has_more_page || false;
    page++;
    if (page > 50) break;
  }
  console.log(`[zoho contacts] total after filter: ${allContacts.length}`);

  // Fetch full detail for each contact to get addresses + contact persons
  const results = [];
  for (const c of allContacts) {
    let detail = c;
    const dr = await fetch(
      `https://www.zohoapis.com/books/v3/contacts/${c.contact_id}?organization_id=${encodeURIComponent(org_id)}`,
      { headers: { "Authorization": `Zoho-oauthtoken ${access_token}` } }
    );
    if (dr.ok) {
      const dd = await dr.json();
      detail = dd.contact || c;
    }

    const billing  = detail.billing_address  || {};
    const shipping = detail.shipping_address || {};

    // Collect all contact persons
    const persons = (detail.contact_persons || []).map(p => ({
      name:   [p.first_name, p.last_name].filter(Boolean).join(" ").trim(),
      email:  p.email  || "",
      phone:  p.phone  || p.mobile || "",
      isPrimary: !!p.is_primary_contact,
    })).filter(p => p.name || p.email || p.phone);

    const primaryPerson = persons.find(p => p.isPrimary) || persons[0] || null;

    results.push({
      zoho_contact_id:   String(c.contact_id),
      name:              detail.contact_name  || c.contact_name  || "",
      company_name:      detail.company_name  || c.company_name  || "",
      email:             detail.email         || c.email         || primaryPerson?.email || "",
      phone:             detail.phone         || c.phone         || c.mobile || primaryPerson?.phone || "",
      website:           detail.website       || c.website       || "",
      notes:             detail.notes         || "",
      payment_terms:     detail.payment_terms_label || detail.payment_terms || "",
      currency_code:     detail.currency_code || "",
      outstanding:       detail.outstanding_receivable_amount || 0,
      contact_persons:   persons,
      primary_contact:   primaryPerson,
      billing_address: {
        attention: billing.attention || billing.address2 || "",
        street:    billing.address   || billing.street   || "",
        city:      billing.city      || "",
        state:     billing.state     || billing.state_code || "",
        zip:       billing.zip       || billing.zip_code  || "",
        country:   billing.country   || billing.country_code || "",
        phone:     billing.phone     || "",
        fax:       billing.fax       || "",
      },
      shipping_address: {
        attention: shipping.attention || shipping.address2 || "",
        street:    shipping.address   || shipping.street   || "",
        city:      shipping.city      || "",
        state:     shipping.state     || shipping.state_code || "",
        zip:       shipping.zip       || shipping.zip_code  || "",
        country:   shipping.country   || shipping.country_code || "",
        phone:     shipping.phone     || "",
        fax:       shipping.fax       || "",
      },
    });
  }

  return res.status(200).json({
    contacts: results,
    total: results.length,
    syncedAt: new Date().toISOString(),
  });
}
