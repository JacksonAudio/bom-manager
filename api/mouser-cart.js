// ============================================================
// api/mouser-cart.js — Mouser Cart + Order Options Proxy
//
// Creates a temp cart and fetches order options to detect
// tariff surcharges (AdditionalFees). Runs server-side to
// avoid CORS issues with api.mouser.com.
// ============================================================

const MOUSER_CART_API = "https://api.mouser.com/api/v2/cart";
const MOUSER_ORDER_API = "https://api.mouser.com/api/v1/order";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { apiKey, mouserPartNumber, quantity } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: "apiKey is required" });
  if (!mouserPartNumber) return res.status(400).json({ error: "mouserPartNumber is required" });

  const qty = parseInt(quantity) || 1;

  try {
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
    } else {
      console.warn("[mouser-cart] Order options failed:", optRes.status);
    }

    // Parse fees from both responses
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
            fee: amt,
            code: fee.Code || "tariff",
            description: fee.Description || "Tariff/Surcharge",
          });
          totalFees += amt;
        }
      }
    }

    // Check order-level summary
    const summaryFees = parseFloat(options.AdditionalFeesTotal || 0);
    if (summaryFees > 0 && totalFees === 0) totalFees = summaryFees;

    const merchandiseTotal = parseFloat(options.MerchandiseTotal || options.SubTotal || 0);
    const orderTotal = parseFloat(options.OrderTotal || options.Total || 0);

    return res.status(200).json({
      cartKey,
      fees,
      totalFees,
      merchandiseTotal,
      orderTotal,
      hasTariff: totalFees > 0 || fees.length > 0,
      // Debug: raw response excerpts
      _cartItemCount: cartItems.length,
      _optionKeys: Object.keys(options),
      _optionCartItemCount: (options.CartItems || []).length,
      _firstCartItem: allItems[0] ? JSON.stringify(allItems[0]).slice(0, 500) : null,
      _rawOptions: JSON.stringify(options).slice(0, 500),
    });
  } catch (err) {
    console.error("[mouser-cart] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
