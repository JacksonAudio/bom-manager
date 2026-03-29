// api/lcsc-search.js — LCSC Electronics API proxy
// Auth: SHA1(key=xxx&nonce=xxx&secret=xxx&timestamp=xxx)
// Apply for credentials: support@lcsc.com

import crypto from "crypto";

const BASE_URL = "https://lcsc.com/api";

export function buildSignature(key, secret, nonce, timestamp) {
  const str = `key=${key}&nonce=${nonce}&secret=${secret}&timestamp=${timestamp}`;
  return crypto.createHash("sha1").update(str).digest("hex");
}

function randomNonce(length = 16) {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { mpn, action = "search" } = req.query;
  const { key, secret } = req.body || {};

  if (!key || !secret) {
    return res.status(400).json({ error: "Missing LCSC API key or secret" });
  }
  if (!mpn) {
    return res.status(400).json({ error: "Missing MPN" });
  }

  const nonce     = randomNonce();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign      = buildSignature(key, secret, nonce, timestamp);

  const authParams = { key, nonce, timestamp, sign };

  try {
    if (action === "search") {
      // Keyword search — returns list of matching products
      const params = new URLSearchParams({
        ...authParams,
        keyword:      mpn,
        in_stock:     "true",
        current_page: "1",
        page_size:    "5",
      });

      const r = await fetch(`${BASE_URL}/search/v2/products?${params}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: `LCSC search failed: ${r.status}`, detail: txt.slice(0, 300) });
      }

      const data = await r.json();
      if (!data.success) {
        return res.status(200).json({ error: data.message || "LCSC API error", code: data.code });
      }

      // Find best match — prefer exact MPN match
      const products = data.result?.productList || data.result?.list || [];
      const exact = products.find(p =>
        (p.productModel || p.mpn || "").toLowerCase() === mpn.toLowerCase()
      ) || products[0];

      if (!exact) {
        return res.status(200).json({ error: "Part not found at LCSC" });
      }

      return res.status(200).json(formatProduct(exact));
    }

    if (action === "detail") {
      // Product detail by LCSC product code
      const params = new URLSearchParams({ ...authParams, productCode: mpn });
      const r = await fetch(`${BASE_URL}/product/detail?${params}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: `LCSC detail failed: ${r.status}`, detail: txt.slice(0, 300) });
      }

      const data = await r.json();
      if (!data.success) {
        return res.status(200).json({ error: data.message || "LCSC API error", code: data.code });
      }

      return res.status(200).json(formatProduct(data.result || {}));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export function formatProduct(p) {
  // Normalize price breaks from LCSC's productPriceList format
  const priceBreaks = (p.productPriceList || p.priceList || []).map(pb => ({
    breakQty: pb.ladder  || pb.quantity || pb.startQty || 1,
    unitPrice: parseFloat(pb.price || pb.usdPrice || 0),
    currency: pb.currencySymbol || "USD",
  })).filter(pb => pb.unitPrice > 0);

  const stock = parseInt(p.stockNumber || p.stock || p.inventory || 0);
  const unitPrice = priceBreaks.length > 0 ? priceBreaks[0].unitPrice : null;

  return {
    mpn:           p.productModel  || p.mpn        || "",
    manufacturer:  p.brandName     || p.manufacturer || p.manufacturerName || "",
    description:   p.productName   || p.description || "",
    stock,
    unitPrice,
    priceBreaks,
    currency:      "USD",
    moq:           parseInt(p.minImage || p.moq || p.minOrder || 1),
    leadTime:      p.deliveryTime  || null,
    countryOfOrigin: p.countryOfOrigin || p.originCountry || null,
    lcscCode:      p.productCode   || p.lcscCode    || "",
    productUrl:    p.productCode   ? `https://www.lcsc.com/product-detail/${p.productCode}.html` : null,
    datasheet:     p.pdfUrl        || p.datasheetUrl || null,
    rohs:          p.rohs          || null,
  };
}
