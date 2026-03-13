// ============================================================
// src/App.jsx — Jackson Audio BOM Manager v4.01
// Thursday, March 12, 2026 — 9:43 PM
//
// Changelog:
//   [1] Fix Nexar query — inline MPN string instead of GraphQL variable (fixes 400)
//   [2] Auto-connect APIs on page load using saved keys from DB
//   [3] Debug console logging for Nexar response parsing
// ============================================================

import { useState, useCallback, useRef, useEffect } from "react";
import AuthScreen from "./components/AuthScreen.jsx";
import {
  onAuthChange, signOut,
  fetchProducts, createProduct, deleteProduct,
  fetchParts,   createPart,   updatePart as dbUpdatePart,
  deletePart as dbDeletePart, deletePartsMany, upsertParts,
  fetchApiKeys, saveAllApiKeys,
  subscribeToProducts, subscribeToParts,
} from "./lib/db.js";

// ─────────────────────────────────────────────
// API CONFIGURATION
// All keys are entered by user in Settings tab
// Never hardcode API keys — store in component state only
// ─────────────────────────────────────────────
const DEFAULT_KEYS = {
  nexar_client_id:     "",   // nexar.com — covers Mouser, DigiKey, Arrow, LCSC, Allied + 900 more
  nexar_client_secret: "",   // nexar.com
  mouser_api_key:      "",   // mouser.com/api-hub (optional — Nexar already covers Mouser)
  digikey_client_id:   "",   // developer.digikey.com (optional — Nexar already covers DigiKey)
  digikey_client_secret: "", // developer.digikey.com
  arrow_api_key:       "",   // developers.arrow.com (optional — Nexar already covers Arrow)
  arrow_login:         "",   // Arrow also requires a login email
  notify_email:        "",   // Email to receive low-stock alerts
  supplier_emails:     "",   // JSON: { "mouser": "orders@mouser.com", ... }
  tariffs_json:        "",   // JSON: { "CN": 145, "TW": 32, ... } — % tariff by country code
};

// Default tariff rates by country (% of goods value), updated March 2026
// These are editable in Settings and stored in the DB
const DEFAULT_TARIFFS = {
  "CN": 145,   // China
  "TW": 32,    // Taiwan
  "DE": 20,    // Germany (EU)
  "FR": 20,    // France (EU)
  "IT": 20,    // Italy (EU)
  "PL": 20,    // Poland (EU)
  "UK": 10,    // United Kingdom
  "JP": 24,    // Japan
  "KR": 25,    // South Korea
  "IN": 26,    // India
  "CA": 25,    // Canada
  "MX": 25,    // Mexico
  "AU": 10,    // Australia
  "VN": 46,    // Vietnam
  "TH": 36,    // Thailand
};

// ─────────────────────────────────────────────
// SUPPLIER DISPLAY CONFIG
// ─────────────────────────────────────────────
const SUPPLIERS = [
  { id: "mouser",   name: "Mouser",   color: "#e8500a", bg: "#2d1a0e", logo: "M",  shipping: 7.99,  searchUrl: (pn) => `https://www.mouser.com/Search/Refine?Keyword=${encodeURIComponent(pn)}` },
  { id: "digikey",  name: "Digi-Key", color: "#cc0000", bg: "#2d0e0e", logo: "DK", shipping: 6.99,  searchUrl: (pn) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(pn)}` },
  { id: "arrow",    name: "Arrow",    color: "#005eb8", bg: "#0a1a2d", logo: "A",  shipping: 0,     searchUrl: (pn) => `https://www.arrow.com/en/products/search?q=${encodeURIComponent(pn)}` },
  { id: "lcsc",     name: "LCSC",     color: "#0a8f4c", bg: "#0a1f15", logo: "LC", shipping: 20.00, searchUrl: (pn) => `https://www.lcsc.com/search?q=${encodeURIComponent(pn)}` },
  { id: "allied",   name: "Allied",   color: "#7c3aed", bg: "#1a0d2d", logo: "AL", shipping: 9.99,  searchUrl: (pn) => `https://www.alliedelec.com/search/?q=${encodeURIComponent(pn)}` },
  { id: "amazon",   name: "Amazon",   color: "#f90",    bg: "#1f1800", logo: "Az", shipping: 0,     searchUrl: (pn) => `https://www.amazon.com/s?k=${encodeURIComponent(pn)}` },
];
const DEFAULT_SHIPPING = 15.00; // for distributors not in SUPPLIERS list
const supplierById = (id) => SUPPLIERS.find((s) => s.id === id) || SUPPLIERS[0];

// Map Nexar distributor names → our supplier IDs
const NEXAR_DIST_MAP = {
  "Mouser Electronics": "mouser",
  "Digi-Key":           "digikey",
  "Arrow Electronics":  "arrow",
  "LCSC":               "lcsc",
  "Allied Electronics": "allied",
  "Newark":             "allied",
};

// Known distributor countries — fallback when API doesn't return country
const DIST_COUNTRY = {
  "mouser":"US","digikey":"US","arrow":"US","allied":"US","newark":"US","amazon":"US",
  "Mouser Electronics":"US","Digi-Key":"US","Arrow Electronics":"US","Allied Electronics":"US","Newark":"US",
  "Farnell":"UK","element14":"AU","Schukat":"DE","TTI Europe":"DE","Maritex":"IT",
  "Bravo Electro":"US","JRH Electronics":"US","TRC Electronics":"US",
  "LCSC":"CN","TME":"PL","Verical":"US","Avnet":"US","Future Electronics":"CA",
  "RS Components":"UK","Chip1Stop":"JP","CoreStaff":"JP","Heilind":"US","Master Electronics":"US",
  "Rutronik":"DE","Sager Electronics":"US","Symmetry Electronics":"US","Bisco Industries":"US",
  "Ameya360":"CN","Win Source":"CN","OnlineComponents.com":"US",
};

// Format price: up to 4 decimals, strip trailing zeroes, keep min 2
const fmtPrice = (v) => { const s = parseFloat(v).toFixed(4); return s.replace(/0{1,2}$/, ""); };

// Get country code for a supplier ID (from DIST_COUNTRY or SUPPLIERS)
const getSupplierCountry = (supplierId) => DIST_COUNTRY[supplierId] || "";

// Get tariff % for a country code given current tariff settings
const getTariffRate = (countryCode, tariffs) => {
  if (!countryCode || countryCode === "US") return 0;
  return tariffs[countryCode.toUpperCase()] || 0;
};

// ─────────────────────────────────────────────
// BOM PARSER
// ─────────────────────────────────────────────
function parseBOM(raw) {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const firstLine = lines[0].split(delim).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  // Detect if first line is a header row
  const hasHeader = firstLine.some((h) => ["pn","mpn","part number","quantity","qty","reference","value","mfr part #"].includes(h));
  const startIdx = hasHeader ? 1 : 0;
  const colMap = {
    reference:    ["reference", "ref", "designator", "refdes", "references"],
    value:        ["value", "val", "component", "part value"],
    mpn:          ["mpn", "mfr part #", "manufacturer part", "mfr#", "part number", "pn", "mfr. part #"],
    quantity:     ["quantity", "qty", "count", "amount"],
    description:  ["description", "desc", "comment", "notes"],
    footprint:    ["footprint", "package"],
    manufacturer: ["manufacturer", "mfr", "mfr."],
  };
  // If header detected, map columns; otherwise assume PN,QTY (2-column format)
  const idx = {};
  if (hasHeader) {
    for (const [key, variants] of Object.entries(colMap)) {
      idx[key] = firstLine.findIndex((h) => variants.some((v) => h.includes(v)));
    }
  } else {
    idx.mpn = 0;
    idx.quantity = lines[0].split(delim).length > 1 ? 1 : -1;
    idx.description = lines[0].split(delim).length > 2 ? 2 : -1;
  }
  const parts = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = lines[i].split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
    if (cells.every((c) => !c)) continue;
    const get = (key) => (idx[key] >= 0 ? cells[idx[key]] || "" : "");
    const refRaw = get("reference");
    const refs = refRaw.split(/[\s,;]+/).filter(Boolean);
    const mpn = get("mpn");
    const qty = parseInt(get("quantity")) || refs.length || 1;
    parts.push({
      id: `part-${Date.now()}-${i}`,
      reference: refRaw || mpn, refs, value: get("value"), mpn,
      description: get("description"), footprint: get("footprint"),
      manufacturer: get("manufacturer"), quantity: qty,
      unitCost: "", projectId: null, reorderQty: "", stockQty: "",
      preferredSupplier: "mouser", orderQty: "", flaggedForOrder: false,
      // Pricing data — populated by API
      pricing: null,      // { [supplierId]: { unitPrice, stock, moq, priceBreaks: [{qty, price}], url } }
      pricingStatus: "idle",  // idle | loading | done | error | no-mpn
      pricingError: "",
      bestSupplier: null, // supplierId with best price for qty
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// NEXAR / OCTOPART API
// GraphQL endpoint — covers 900+ distributors
// Free: 1,000 matched parts/month
// Sign up: nexar.com
// ─────────────────────────────────────────────
async function fetchNexarToken(clientId, clientSecret) {
  // OAuth2 client_credentials flow
  const res = await fetch("https://identity.nexar.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Nexar token error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// Build inline GraphQL query string with MPN interpolated directly
// Nexar requires inline strings — named variables cause 400 errors
function buildNexarQuery(mpn) {
  // Escape any quotes in the MPN just in case
  const safe = mpn.replace(/"/g, '\\"');
  return `{ supSearchMpn(q: "${safe}", limit: 3, country: "US", currency: "USD") { hits results { part { mpn countryOfOrigin manufacturer { name } sellers { country company { name } offers { clickUrl inventoryLevel moq prices { quantity price currency } } } } } } }`;
}

async function fetchNexarPricing(mpn, quantity, token) {
  const query = buildNexarQuery(mpn);
  console.log("[Nexar] Sending query for MPN:", mpn);
  const res = await fetch("https://api.nexar.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),  // no variables — inline only
  });
  if (!res.ok) throw new Error(`Nexar API error: ${res.status}`);
  const data = await res.json();
  console.log("[Nexar] Raw response:", JSON.stringify(data).slice(0, 500));
  if (data.errors) throw new Error(data.errors[0]?.message || "Nexar GraphQL error");

  // Parse response — supSearchMpn returns data.supSearchMpn.results[].part
  const pricing = {};
  const results = data?.data?.supSearchMpn?.results || [];
  let detectedOrigin = null;

  for (const result of results) {
    // Capture country of origin from part data (for tariff calculation)
    if (result?.part?.countryOfOrigin && !detectedOrigin) {
      detectedOrigin = result.part.countryOfOrigin.toUpperCase();
    }
    for (const seller of (result?.part?.sellers || [])) {
      const distName = seller?.company?.name || "";
      const sellerCountry = (seller?.country || "").toUpperCase();
      const suppId = NEXAR_DIST_MAP[distName];
      const key = suppId || distName.toLowerCase().replace(/\s+/g, "_");

      for (const offer of (seller?.offers || [])) {
        const prices = (offer?.prices || []).sort((a, b) => a.quantity - b.quantity);
        if (!prices.length) continue;

        // Find unit price for requested quantity using price breaks
        let unitPrice = prices[0]?.price || 0;
        for (const pb of prices) {
          if (quantity >= pb.quantity) unitPrice = pb.price;
        }

        if (!pricing[key] || unitPrice < pricing[key].unitPrice) {
          pricing[key] = {
            supplierId: key,
            displayName: distName,
            country: sellerCountry,
            unitPrice: parseFloat(unitPrice) || 0,
            stock: offer.inventoryLevel || 0,
            moq: offer.moq || 1,
            url: offer.clickUrl || "",
            priceBreaks: prices.map((p) => ({ qty: p.quantity, price: parseFloat(p.price) })),
          };
        }
      }
    }
  }
  // Attach countryOfOrigin to the pricing object so callers can access it
  if (detectedOrigin) pricing._countryOfOrigin = detectedOrigin;
  return pricing;
}

// ─────────────────────────────────────────────
// MOUSER DIRECT API (fallback / supplement)
// Endpoint: https://api.mouser.com/api/v1/search/partnumber
// Key: mouser.com/api-hub → Search API
// ─────────────────────────────────────────────
async function fetchMouserPricing(mpn, quantity, apiKey) {
  const res = await fetch(
    `https://api.mouser.com/api/v1/search/partnumber?apiKey=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        SearchByPartRequest: {
          mouserPartNumber: mpn,
          partSearchOptions: "Exact",
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Mouser API ${res.status}`);
  const data = await res.json();
  const parts = data?.SearchResults?.Parts || [];
  if (!parts.length) return null;

  const part = parts[0];
  const breaks = (part.PriceBreaks || []).map((pb) => ({
    qty: parseInt(pb.Quantity),
    price: parseFloat(pb.Price?.replace(/[^0-9.]/g, "") || "0"),
  }));

  let unitPrice = breaks[0]?.price || 0;
  for (const pb of breaks) {
    if (quantity >= pb.qty) unitPrice = pb.price;
  }

  const result = {
    supplierId: "mouser",
    displayName: "Mouser Electronics",
    unitPrice,
    stock: parseInt(part.Availability?.replace(/[^0-9]/g, "") || "0"),
    moq: breaks[0]?.qty || 1,
    url: part.ProductDetailUrl || "",
    priceBreaks: breaks,
  };
  // Mouser API may return CountryOfOrigin — capture it for tariff calculation
  if (part.CountryOfOrigin) result.countryOfOrigin = part.CountryOfOrigin.toUpperCase();
  if (part.ROHSStatus) result.rohsStatus = part.ROHSStatus;
  return result;
}

// ─────────────────────────────────────────────
// DIGIKEY DIRECT API v4 (fallback / supplement)
// OAuth2 → access token → product search
// Register: developer.digikey.com
// ─────────────────────────────────────────────
async function fetchDigiKeyToken(clientId, clientSecret) {
  const res = await fetch("https://api.digikey.com/v1/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`DigiKey token error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchDigiKeyPricing(mpn, quantity, clientId, accessToken) {
  const res = await fetch(
    `https://api.digikey.com/products/v4/search/${encodeURIComponent(mpn)}/productdetails`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "X-DIGIKEY-Client-Id": clientId,
        "X-DIGIKEY-Locale-Site": "US",
        "X-DIGIKEY-Locale-Language": "en",
        "X-DIGIKEY-Locale-Currency": "USD",
      },
    }
  );
  if (!res.ok) throw new Error(`DigiKey API ${res.status}`);
  const data = await res.json();
  const product = data?.Product;
  if (!product) return null;

  const variations = product.ProductVariations || [];
  let bestBreaks = [];
  let bestMoq = 1;
  for (const v of variations) {
    const pricing = v.StandardPricing || [];
    if (pricing.length > bestBreaks.length) {
      bestBreaks = pricing.map((p) => ({ qty: p.BreakQuantity, price: p.UnitPrice }));
      bestMoq = pricing[0]?.BreakQuantity || 1;
    }
  }

  let unitPrice = bestBreaks[0]?.price || product.UnitPrice || 0;
  for (const pb of bestBreaks) {
    if (quantity >= pb.qty) unitPrice = pb.price;
  }

  return {
    supplierId: "digikey",
    displayName: "Digi-Key",
    unitPrice: parseFloat(unitPrice),
    stock: product.QuantityAvailable || 0,
    moq: bestMoq,
    url: product.ProductUrl || `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(mpn)}`,
    priceBreaks: bestBreaks,
  };
}

// ─────────────────────────────────────────────
// ARROW DIRECT API v4 (fallback / supplement)
// GET request with login + apikey params
// Register: developers.arrow.com
// ─────────────────────────────────────────────
async function fetchArrowPricing(mpn, quantity, login, apiKey) {
  const url = new URL("https://api.arrow.com/itemservice/v4/en/search/token");
  url.searchParams.set("login", login);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("search_token", mpn);
  url.searchParams.set("rows", "3");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Arrow API ${res.status}`);
  const data = await res.json();

  const parts = data?.itemserviceresult?.data?.[0]?.PartList || [];
  if (!parts.length) return null;

  const part = parts[0];
  const sources = part?.InvOrg?.sources || [];
  let bestOffer = null;
  let bestPrice = Infinity;

  for (const src of sources) {
    const prices = (src?.Prices?.ResaleList || []);
    for (const p of prices) {
      if ((parseFloat(p.price) || 0) < bestPrice) {
        bestPrice = parseFloat(p.price);
        bestOffer = { src, price: p };
      }
    }
  }

  if (!bestOffer) return null;
  const breaks = (bestOffer.src?.Prices?.ResaleList || []).map((p) => ({
    qty: parseInt(p.minQty || p.packSize || 1),
    price: parseFloat(p.price || 0),
  }));

  let unitPrice = bestPrice;
  for (const pb of breaks) {
    if (quantity >= pb.qty) unitPrice = pb.price;
  }

  return {
    supplierId: "arrow",
    displayName: "Arrow Electronics",
    unitPrice,
    stock: parseInt(bestOffer.src?.qty || 0),
    moq: parseInt(breaks[0]?.qty || 1),
    url: (part.resources?.find((r) => r.type === "cloud_part_detail")?.uri) || `https://www.arrow.com/en/products/search?q=${encodeURIComponent(mpn)}`,
    priceBreaks: breaks,
  };
}

// ─────────────────────────────────────────────
// MAIN PRICING ORCHESTRATOR
// Tries Nexar first (best coverage), then
// supplements with direct APIs if configured
// ─────────────────────────────────────────────
async function fetchAllPricing(mpn, quantity, apiKeys, nexarToken, digiKeyToken) {
  if (!mpn) return { error: "No MPN" };
  const pricing = {};

  // 1. Nexar/Octopart — hits all distributors at once
  if (nexarToken) {
    try {
      const nexarData = await fetchNexarPricing(mpn, quantity, nexarToken);
      Object.assign(pricing, nexarData);
    } catch (e) {
      console.warn("Nexar fetch failed:", e.message);
    }
  }

  // 2. Mouser direct — always prefer over Nexar (full price breaks)
  if (apiKeys.mouser_api_key) {
    try {
      const md = await fetchMouserPricing(mpn, quantity, apiKeys.mouser_api_key);
      if (md) pricing.mouser = md;
    } catch (e) { console.warn("Mouser direct failed:", e.message); }
  }

  // 3. DigiKey direct — always prefer over Nexar (full price breaks)
  if (digiKeyToken && apiKeys.digikey_client_id) {
    try {
      const dd = await fetchDigiKeyPricing(mpn, quantity, apiKeys.digikey_client_id, digiKeyToken);
      if (dd) pricing.digikey = dd;
    } catch (e) { console.warn("DigiKey direct failed:", e.message); }
  }

  // 4. Arrow direct
  if (apiKeys.arrow_api_key && apiKeys.arrow_login) {
    try {
      const ad = await fetchArrowPricing(mpn, quantity, apiKeys.arrow_login, apiKeys.arrow_api_key);
      if (ad) pricing.arrow = ad;
    } catch (e) { console.warn("Arrow direct failed:", e.message); }
  }

  // Propagate countryOfOrigin across all entries for this part
  // Sources: Nexar _countryOfOrigin, Mouser countryOfOrigin, or manufacturer-based lookup
  let origin = pricing._countryOfOrigin || null;
  if (!origin) {
    // Check if any direct API returned it
    for (const data of Object.values(pricing)) {
      if (data?.countryOfOrigin) { origin = data.countryOfOrigin; break; }
    }
  }
  if (origin) {
    for (const [key, data] of Object.entries(pricing)) {
      if (key !== "_countryOfOrigin" && data && typeof data === "object") {
        data.countryOfOrigin = origin;
      }
    }
    delete pricing._countryOfOrigin; // clean up internal field
  }

  return pricing;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function bestPriceSupplier(pricing) {
  if (!pricing) return null;
  let best = null, bestPrice = Infinity, bestStock = 0;
  for (const [key, data] of Object.entries(pricing)) {
    if (data.unitPrice > 0 && data.stock > 0) {
      if (data.unitPrice < bestPrice || (data.unitPrice === bestPrice && (data.stock||0) > bestStock)) {
        bestPrice = data.unitPrice; bestStock = data.stock||0; best = key;
      }
    }
  }
  return best;
}

function exportPOasCSV(supplier, lines, poNumber) {
  const header = ["PO#","Supplier","MPN","Reference","Description","Value","Manufacturer","Qty Needed","Unit Cost","Extended Cost"].join(",");
  const rows = lines.map((p) => [
    poNumber, supplier.name, p.mpn || "", p.reference,
    `"${(p.description || "").replace(/"/g, "'")}"`,
    p.value || "", p.manufacturer || "", p.neededQty,
    p.unitCost || "", p.unitCost ? (parseFloat(p.unitCost) * p.neededQty).toFixed(3) : "",
  ].join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `PO-${poNumber}-${supplier.name}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

function printPO(supplier, lines, poNumber) {
  const total = lines.reduce((s, p) => s + (parseFloat(p.unitCost)||0) * p.neededQty, 0);
  const today = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const rows = lines.map((p) => `
    <tr>
      <td>${p.reference}</td><td><strong>${p.mpn||"—"}</strong></td>
      <td>${p.description||p.value||"—"}</td><td>${p.manufacturer||"—"}</td>
      <td style="text-align:center">${p.neededQty}</td>
      <td style="text-align:right">${p.unitCost?"$"+fmtPrice(p.unitCost):"—"}</td>
      <td style="text-align:right">${p.unitCost?"$"+(parseFloat(p.unitCost)*p.neededQty).toFixed(2):"—"}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PO ${poNumber}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:40px;color:#1a1a1a}
  .header{display:flex;justify-content:space-between;margin-bottom:28px;border-bottom:3px solid #f8d377;padding-bottom:18px}
  .company{font-size:20px;font-weight:900}.po-num{font-size:18px;font-weight:800;color:${supplier.color};text-align:right}
  .vbox{background:#f5f5f5;border-left:4px solid ${supplier.color};padding:12px 16px;margin-bottom:20px;border-radius:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  th{background:#1a1a1a;color:#fff;padding:7px 10px;text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase}
  td{padding:7px 10px;border-bottom:1px solid #eee}tr:nth-child(even)td{background:#fafafa}
  .tot td{font-weight:800;border-top:2px solid #000}
  @media print{body{padding:20px}}</style></head><body>
  <div class="header"><div><div class="company">JACKSON AUDIO</div><div style="font-size:10px;color:#666;letter-spacing:2px;margin-top:2px">PURCHASE ORDER</div>
  <div style="margin-top:8px;font-size:11px;color:#444;line-height:1.6">Texas, USA<br>purchasing@jacksonaudio.com</div></div>
  <div class="po-num">PO-${poNumber}<br><span style="font-size:11px;font-weight:400;color:#666">${today}</span></div></div>
  <div class="vbox"><strong style="color:${supplier.color};font-size:14px">${supplier.name}</strong></div>
  <table><thead><tr><th>Reference</th><th>MPN</th><th>Description</th><th>Manufacturer</th>
  <th style="text-align:center">Qty</th><th style="text-align:right">Unit $</th><th style="text-align:right">Extended</th></tr></thead>
  <tbody>${rows}<tr class="tot"><td colspan="4">${lines.length} line items</td>
  <td style="text-align:center">${lines.reduce((s,p)=>s+p.neededQty,0)}</td><td></td>
  <td style="text-align:right">${total>0?"$"+total.toFixed(2):"—"}</td></tr></tbody></table>
  <div style="margin-top:32px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:12px">
  Generated by Jackson Audio BOM Manager · ${new Date().toISOString()}</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
}

function buildPurchaseOrders(parts) {
  const orderParts = parts.filter((p) => {
    if (p.flaggedForOrder) return true;
    const s = parseInt(p.stockQty), r = parseInt(p.reorderQty);
    return !isNaN(s) && !isNaN(r) && s <= r;
  });
  const grouped = {};
  for (const part of orderParts) {
    const sid = part.preferredSupplier || "mouser";
    if (!grouped[sid]) grouped[sid] = [];
    const stock = parseInt(part.stockQty)||0, reorder = parseInt(part.reorderQty)||0;
    const needed = part.flaggedForOrder && isNaN(parseInt(part.reorderQty))
      ? parseInt(part.orderQty)||part.quantity
      : Math.max(reorder - stock, parseInt(part.orderQty)||1);
    grouped[sid].push({ ...part, neededQty: needed });
  }
  return grouped;
}

function genPONumber(sid) {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${sid.slice(0,2).toUpperCase()}-${Math.floor(Math.random()*900+100)}`;
}

function buildPOEmailDraft(supplierName, lines, poNumber) {
  const subject = `Purchase Order ${poNumber} — Jackson Audio`;
  const body = [
    `Hi ${supplierName} Team,`,
    ``,
    `Please quote / process the following order:`,
    ``,
    `PO #: ${poNumber}`,
    `Date: ${new Date().toLocaleDateString()}`,
    ``,
    `Part Number | Qty | Description`,
    `-----------|-----|------------`,
    ...lines.map(l => `${l.mpn} | ${l.neededQty} | ${l.description || l.value || ""}`),
    ``,
    `Please confirm availability, lead time, and total cost.`,
    ``,
    `Thank you,`,
    `Jackson Audio`,
  ].join("\n");
  return { subject, body };
}

function buildLowStockEmailBody(lowParts) {
  if (!lowParts.length) return null;
  const lines = lowParts.map(p => {
    const stock = parseInt(p.stockQty)||0;
    const reorder = parseInt(p.reorderQty)||0;
    return `  ${p.mpn || p.reference} — Stock: ${stock}, Reorder point: ${reorder}, Need: ${Math.max(reorder-stock,0)}`;
  });
  return [
    `Good morning,`,
    ``,
    `${lowParts.length} part${lowParts.length!==1?"s are":" is"} at or below reorder level:`,
    ``,
    ...lines,
    ``,
    `Would you like me to generate a list of POs and draft emails for you?`,
    ``,
    `Log in to review and take action:`,
    `https://jackson-bom.vercel.app`,
    ``,
    `— Jackson Audio BOM Manager`,
  ].join("\n");
}

// ─────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #1a1d26; }
  ::-webkit-scrollbar-thumb { background: #3a4055; border-radius: 3px; }

  .nav-btn { background: none; border: none; cursor: pointer; padding: 10px 18px;
    font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600;
    color: #64748b; transition: all 0.15s; display: flex; align-items: center; gap: 8px;
    border-bottom: 2px solid transparent; }
  .nav-btn:hover { color: #94a3b8; }
  .nav-btn.active { color: #f8d377; border-bottom: 2px solid #f8d377; }

  .supplier-pill { display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 4px; border: none;
    font-size: 11px; font-weight: 800; cursor: pointer;
    font-family: 'Space Grotesk', sans-serif;
    transition: opacity 0.15s; text-decoration: none; white-space: nowrap; }
  .supplier-pill:hover { opacity: 0.75; }

  input[type="text"], input[type="number"], input[type="password"], select, textarea {
    background: #1a1d26; border: 1px solid #2d3248;
    color: #e2e8f0; border-radius: 5px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #f8d377; }

  .card { background: #161922; border: 1px solid #2d3248; border-radius: 10px; padding: 20px; }
  .btn-primary { background: #f8d377; color: #0d0f14; border: none; border-radius: 6px;
    padding: 9px 18px; font-weight: 800; font-family: 'Space Grotesk', sans-serif;
    font-size: 13px; cursor: pointer; transition: background 0.15s; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 8px; }
  .btn-primary:hover { background: #fde68a; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-ghost { background: none; border: 1px solid #2d3248; color: #94a3b8; border-radius: 6px;
    padding: 8px 14px; font-size: 12px; cursor: pointer;
    font-family: 'Space Grotesk', sans-serif; font-weight: 600;
    transition: all 0.15s; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px; }
  .btn-ghost:hover { border-color: #f8d377; color: #f8d377; }
  .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-sm { padding: 5px 10px; font-size: 11px; }

  .drop-zone { border: 2px dashed #2d3248; border-radius: 10px; padding: 48px 24px;
    text-align: center; transition: all 0.2s; cursor: pointer; }
  .drop-zone.drag-over { border-color: #f8d377; background: #1e2130; }
  .drop-zone:hover { border-color: #3a4055; }

  .table-row:hover td { background: #12151e !important; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
    font-family: 'Space Grotesk', sans-serif; }

  .price-card { background: #0d0f14; border: 1px solid #2d3248;
    border-radius: 8px; padding: 12px 14px; min-width: 160px; }
  .price-card.best { border-color: #34d399; background: #0d2318; }

  .po-card { background: #0f1118; border: 1px solid #2d3248; border-radius: 12px; overflow: hidden; margin-bottom: 20px; }
  .po-header { padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .po-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .po-table th { background: #0d0f14; padding: 8px 12px; text-align: left;
    font-size: 10px; letter-spacing: 0.08em; color: #475569;
    font-family: 'Space Grotesk', sans-serif; font-weight: 700;
    border-bottom: 1px solid #1e2130; white-space: nowrap; }
  .po-table td { padding: 9px 12px; border-bottom: 1px solid #161922;
    font-family: 'IBM Plex Mono', monospace; vertical-align: middle; }
  .po-table tr:hover td { background: #161922; }

  .spinner { display: inline-block; width: 12px; height: 12px;
    border: 2px solid #334155; border-top-color: #f8d377;
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .alert-dot { width: 7px; height: 7px; border-radius: 50%; background: #ef4444;
    display: inline-block; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .key-input-row { display: grid; grid-template-columns: 200px 1fr; gap: 12px; align-items: center; margin-bottom: 10px; }
  .key-label { font-size: 12px; color: #94a3b8; font-family: 'Space Grotesk', sans-serif; font-weight: 600; }
  .key-hint { font-size: 10px; color: #475569; margin-top: 2px; }

  .price-break-row { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #64748b; }
  .price-break-row span { color: #34d399; font-weight: 600; }
`;

// ─────────────────────────────────────────────
// TOP-LEVEL APP — handles auth gate
// ─────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out

  useEffect(() => {
    // Subscribe to auth state — setUser is called immediately with current session
    const unsub = onAuthChange(setUser);
    return unsub;
  }, []);

  // While checking session, show nothing (avoids flash)
  if (user === undefined) return (
    <div style={{ minHeight:"100vh",background:"#080a0f",display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ fontFamily:"'Space Grotesk',sans-serif",color:"#475569",fontSize:13 }}>Loading…</div>
    </div>
  );

  if (!user) return <AuthScreen />;
  return <BOMManager user={user} />;
}

// ─────────────────────────────────────────────
// MAIN BOM MANAGER
// ─────────────────────────────────────────────
function BOMManager({ user }) {
  const [parts,       setParts]       = useState([]);
  const [products,    setProducts]    = useState([]);
  const [loading,     setLoading]     = useState(true);  // initial DB fetch in progress
  const [activeView,  setActiveView]  = useState("import");
  const [selProject,  setSelProject]  = useState("all");
  const [search,      setSearch]      = useState("");
  const [pasteText,   setPasteText]   = useState("");
  const [newProjName, setNewProjName] = useState("");
  const [importError, setImportError] = useState("");
  const [importOk,    setImportOk]    = useState("");
  const [dragOver,    setDragOver]    = useState(false);
  const [expandedPart,setExpandedPart]= useState(null);
  const [apiKeys,     setApiKeys]     = useState(DEFAULT_KEYS);
  const [keySaved,    setKeySaved]    = useState(false);
  const [nexarToken,  setNexarToken]  = useState(null);
  const [dkToken,     setDkToken]     = useState(null);
  const [tokenStatus, setTokenStatus] = useState("idle");
  const [tokenMsg,    setTokenMsg]    = useState("");
  const [fetchingAll, setFetchingAll] = useState(false);

  // quickAdd state — one per product card: { partNumber, qty, description, value, manufacturer }
  const [quickAdd,    setQuickAdd]    = useState({}); // { [productId]: { pn, qty, desc, value, mfr, showOptional } }
  const [bomSim,      setBomSim]      = useState({}); // { [productId]: { qty, results, loading } }
  // selectedParts — set of part IDs checked in the Parts Library for bulk delete
  const [selectedParts, setSelectedParts] = useState(new Set());
  const [expandedPricingParts, setExpandedPricingParts] = useState(new Set());
  const [usOnly, setUsOnly] = useState(true);
  const fileRef = useRef();

  // ─────────────────────────────────────────────
  // DB BOOT — fetch initial data on mount
  // ─────────────────────────────────────────────
  useEffect(() => {
    async function boot() {
      try {
        // Parallel fetch products, parts, and api keys
        const [prods, pts, keys] = await Promise.all([
          fetchProducts(),
          fetchParts(),
          fetchApiKeys(),
        ]);

        // Normalize DB rows → UI shape (DB uses snake_case, UI uses camelCase)
        setProducts(prods.map(dbProductToUI));
        setParts(pts.map(dbPartToUI));

        // Merge fetched keys over defaults — store merged copy for auto-connect
        const mergedKeys = { ...DEFAULT_KEYS, ...keys };
        setApiKeys(mergedKeys);

        // Auto-connect APIs silently on page load if keys exist in DB
        // Avoids user having to press "Save & Connect" every session
        if (mergedKeys.nexar_client_id && mergedKeys.nexar_client_secret) {
          console.log("[Boot] Auto-connecting Nexar...");
          try {
            const nToken = await fetchNexarToken(mergedKeys.nexar_client_id, mergedKeys.nexar_client_secret);
            setNexarToken(nToken);
            setTokenStatus("ok");
            setTokenMsg("✓ Nexar/Octopart auto-connected");
            console.log("[Boot] Nexar auto-connect OK, token length:", nToken?.length);
          } catch (e) {
            console.warn("[Boot] Nexar auto-connect failed:", e.message);
          }
        }
      } catch (e) {
        console.error("Boot fetch failed:", e);
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, []); // eslint-disable-line

  // ─────────────────────────────────────────────
  // REALTIME SUBSCRIPTIONS
  // Supabase pushes INSERT/UPDATE/DELETE to all connected clients
  // ─────────────────────────────────────────────
  useEffect(() => {
    // Products channel
    const prodChannel = subscribeToProducts((eventType, newRow, oldRow) => {
      if (eventType === "INSERT") {
        setProducts((prev) => {
          if (prev.find((p) => p.id === newRow.id)) return prev; // already have it
          return [dbProductToUI(newRow), ...prev];
        });
      } else if (eventType === "UPDATE") {
        setProducts((prev) => prev.map((p) => p.id === newRow.id ? dbProductToUI(newRow) : p));
      } else if (eventType === "DELETE") {
        setProducts((prev) => prev.filter((p) => p.id !== oldRow.id));
      }
    });

    // Parts channel
    const partChannel = subscribeToParts((eventType, newRow, oldRow) => {
      if (eventType === "INSERT") {
        setParts((prev) => {
          if (prev.find((p) => p.id === newRow.id)) return prev;
          return [...prev, dbPartToUI(newRow)];
        });
      } else if (eventType === "UPDATE") {
        setParts((prev) => prev.map((p) => p.id === newRow.id ? dbPartToUI(newRow) : p));
      } else if (eventType === "DELETE") {
        setParts((prev) => prev.filter((p) => p.id !== oldRow.id));
        setSelectedParts((prev) => { const n = new Set(prev); n.delete(oldRow.id); return n; });
      }
    });

    return () => {
      prodChannel.unsubscribe();
      partChannel.unsubscribe();
    };
  }, []); // eslint-disable-line

  // ── Authenticate all configured APIs
  const authenticateAPIs = async (keys = apiKeys) => {
    setTokenStatus("loading"); setTokenMsg("");
    let nToken = nexarToken, dToken = dkToken;
    const msgs = [];

    if (keys.nexar_client_id && keys.nexar_client_secret) {
      try {
        nToken = await fetchNexarToken(keys.nexar_client_id, keys.nexar_client_secret);
        setNexarToken(nToken); msgs.push("✓ Nexar/Octopart connected");
      } catch (e) { msgs.push("✗ Nexar: " + e.message); }
    }

    if (keys.digikey_client_id && keys.digikey_client_secret) {
      try {
        dToken = await fetchDigiKeyToken(keys.digikey_client_id, keys.digikey_client_secret);
        setDkToken(dToken); msgs.push("✓ Digi-Key connected");
      } catch (e) { msgs.push("✗ DigiKey: " + e.message); }
    }

    if (keys.mouser_api_key) msgs.push("✓ Mouser key saved");
    if (keys.arrow_api_key && keys.arrow_login) msgs.push("✓ Arrow key saved");

    setTokenStatus(msgs.some((m) => m.startsWith("✓")) ? "ok" : "error");
    setTokenMsg(msgs.join(" · "));
    return { nToken, dToken };
  };

  // ── Fetch pricing for a single part — results saved back to DB
  const fetchPartPricing = async (partId) => {
    const part = parts.find((p) => p.id === partId);
    if (!part || !part.mpn) {
      updatePart(partId, "pricingStatus", "no-mpn");
      return;
    }
    // Optimistic loading state
    setParts((prev) => prev.map((p) => p.id === partId ? { ...p, pricingStatus: "loading" } : p));
    try {
      const pricing  = await fetchAllPricing(part.mpn, part.quantity, apiKeys, nexarToken, dkToken);
      const best     = bestPriceSupplier(pricing);
      const bestPrice = pricing[best]?.unitPrice;
      const newUnitCost = part.unitCost || (bestPrice ? fmtPrice(bestPrice) : part.unitCost);
      const newPref     = best || part.preferredSupplier;

      // Update UI optimistically
      setParts((prev) => prev.map((p) => p.id === partId ? {
        ...p, pricing, pricingStatus: "done", bestSupplier: best,
        unitCost: newUnitCost, preferredSupplier: newPref,
      } : p));

      // Persist to DB (so team sees cached pricing on next load)
      await dbUpdatePart(partId, {
        pricing,
        pricing_status: "done",
        best_supplier:  best,
        unit_cost:      newUnitCost !== "" ? parseFloat(newUnitCost) || null : null,
        preferred_supplier: newPref,
      }, user.id);
    } catch (e) {
      setParts((prev) => prev.map((p) => p.id === partId ? {
        ...p, pricingStatus: "error", pricingError: e.message,
      } : p));
      await dbUpdatePart(partId, { pricing_status: "error", pricing_error: e.message }, user.id)
        .catch(() => {}); // non-critical
    }
  };

  // ── Fetch pricing for ALL parts with MPNs
  const fetchAllPartsPricing = async () => {
    setFetchingAll(true);
    const partsWithMPN = parts.filter((p) => p.mpn && p.pricingStatus !== "loading");
    for (const part of partsWithMPN) {
      await fetchPartPricing(part.id);
      await new Promise((r) => setTimeout(r, 300)); // gentle rate limiting
    }
    setFetchingAll(false);
  };

  // ── BOM import — parse CSV then bulk insert to DB
  const handleImport = useCallback(async (rawText, filename = "") => {
    setImportError(""); setImportOk("");
    try {
      const parsed = parseBOM(rawText);
      if (!parsed.length) { setImportError("No parts found. Check header row."); return; }

      // Filter duplicates by MPN against what's already in DB
      const existingMPNs = new Set(parts.map((p) => p.mpn).filter(Boolean));
      const fresh = parsed.filter((p) => !p.mpn || !existingMPNs.has(p.mpn));
      if (!fresh.length) { setImportError("All parts already exist in the library (matched by MPN)."); return; }

      // Write to DB — upsertParts returns created rows, realtime handles UI update
      const dbRows = fresh.map((p) => uiPartToDB(p));
      await upsertParts(dbRows, user.id);

      setImportOk(`✓ Imported ${fresh.length} parts${filename ? ` from "${filename}"` : ""}.`);
      setActiveView("bom");
    } catch (e) { setImportError("Import error: " + e.message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, user.id]);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleImport(ev.target.result, file.name);
    reader.readAsText(file);
  }, [handleImport]);

  const handleFilePick = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleImport(ev.target.result, file.name);
    reader.readAsText(file);
  };

  // ─────────────────────────────────────────────
  // SHAPE CONVERTERS
  // DB rows use snake_case with nulls; UI uses camelCase with empty strings
  // ─────────────────────────────────────────────
  function dbProductToUI(row) {
    return {
      id:    row.id,
      name:  row.name,
      color: row.color,
      createdBy: row.created_by,
    };
  }

  function dbPartToUI(row) {
    return {
      id:                row.id,
      reference:         row.reference   || "",
      refs:              [row.reference  || ""],
      value:             row.value        || "",
      mpn:               row.mpn          || "",
      description:       row.description  || "",
      footprint:         row.footprint    || "",
      manufacturer:      row.manufacturer || "",
      quantity:          row.quantity     || 1,
      unitCost:          row.unit_cost != null ? String(row.unit_cost) : "",
      projectId: row.product_id || null,
      reorderQty:        row.reorder_qty != null ? String(row.reorder_qty) : "",
      stockQty:          row.stock_qty   != null ? String(row.stock_qty)   : "",
      preferredSupplier: row.preferred_supplier || "mouser",
      orderQty:          row.order_qty   != null ? String(row.order_qty)   : "",
      flaggedForOrder:   row.flagged_for_order  || false,
      pricing:           row.pricing     || null,
      pricingStatus:     row.pricing_status     || "idle",
      pricingError:      row.pricing_error       || "",
      bestSupplier:      row.best_supplier       || null,
      createdBy:         row.created_by,
      updatedBy:         row.updated_by,
    };
  }

  // Convert UI part shape → DB insert/update fields (snake_case, no UI-only fields)
  function uiPartToDB(part) {
    return {
      reference:         part.reference         || "",
      value:             part.value             || "",
      mpn:               part.mpn               || "",
      description:       part.description       || "",
      footprint:         part.footprint         || "",
      manufacturer:      part.manufacturer      || "",
      quantity:          parseInt(part.quantity) || 1,
      unit_cost:         part.unitCost !== "" ? parseFloat(part.unitCost) || null : null,
      product_id:        part.projectId || null,
      reorder_qty:       part.reorderQty !== "" ? parseInt(part.reorderQty) || null : null,
      stock_qty:         part.stockQty   !== "" ? parseInt(part.stockQty)   || null : null,
      preferred_supplier:part.preferredSupplier || "mouser",
      order_qty:         part.orderQty   !== "" ? parseInt(part.orderQty)   || null : null,
      flagged_for_order: part.flaggedForOrder    || false,
      pricing:           part.pricing            || null,
      pricing_status:    part.pricingStatus      || "idle",
      pricing_error:     part.pricingError       || "",
      best_supplier:     part.bestSupplier       || null,
    };
  }

  // ─────────────────────────────────────────────
  // PART MUTATIONS — all write to DB, realtime updates UI
  // ─────────────────────────────────────────────

  // Update a single field on a part (optimistic UI + DB write)
  const updatePart = async (id, field, value) => {
    // Optimistic update — show immediately in UI
    setParts((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));

    // Build DB field name from camelCase field
    const dbFieldMap = {
      unitCost: "unit_cost", projectId: "product_id", reorderQty: "reorder_qty",
      stockQty: "stock_qty", preferredSupplier: "preferred_supplier", orderQty: "order_qty",
      flaggedForOrder: "flagged_for_order", pricingStatus: "pricing_status",
      pricingError: "pricing_error", bestSupplier: "best_supplier",
    };
    const dbField = dbFieldMap[field] || field;
    let dbValue = value;

    // Type coercion for numeric DB fields
    if (["unit_cost"].includes(dbField))    dbValue = value !== "" ? parseFloat(value) || null : null;
    if (["reorder_qty","stock_qty","order_qty","quantity"].includes(dbField)) dbValue = value !== "" ? parseInt(value) || null : null;

    try {
      await dbUpdatePart(id, { [dbField]: dbValue }, user.id);
    } catch (e) {
      console.error("updatePart failed:", e);
    }
  };

  // Toggle the order flag on a part
  const toggleFlag = async (id) => {
    const part = parts.find((p) => p.id === id);
    if (!part) return;
    const next = !part.flaggedForOrder;
    setParts((prev) => prev.map((p) => p.id === id ? { ...p, flaggedForOrder: next } : p));
    try {
      await dbUpdatePart(id, { flagged_for_order: next }, user.id);
    } catch (e) { console.error("toggleFlag failed:", e); }
  };

  // Delete a single part
  const deletePart = async (id) => {
    setParts((prev) => prev.filter((p) => p.id !== id));
    setSelectedParts((prev) => { const n = new Set(prev); n.delete(id); return n; });
    try { await dbDeletePart(id); } catch (e) { console.error("deletePart failed:", e); }
  };

  // ── Bulk selection helpers
  const toggleSelect = (id) =>
    setSelectedParts((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll  = (ids) => setSelectedParts(new Set(ids));
  const selectNone = ()    => setSelectedParts(new Set());

  // Bulk delete selected parts
  const deleteSelected = async () => {
    const ids = [...selectedParts];
    setParts((prev) => prev.filter((p) => !selectedParts.has(p.id)));
    setSelectedParts(new Set());
    try { await deletePartsMany(ids); } catch (e) { console.error("deleteSelected failed:", e); }
  };

  // ── Add a new Product (writes to DB, realtime updates all sessions)
  const addProduct = async () => {
    if (!newProjName.trim()) return;
    const colors = ["#f59e0b","#6366f1","#ef4444","#10b981","#3b82f6","#f97316","#ec4899"];
    const color  = colors[products.length % colors.length];
    const name   = newProjName.trim();
    setNewProjName(""); // clear immediately for responsiveness
    try {
      await createProduct({ name, color, userId: user.id });
      // realtime INSERT fires → setProducts handled in subscription above
    } catch (e) { console.error("addProduct failed:", e); }
  };

  // ── Quick-add a part directly to a product (only PN + Qty required)
  const quickAddPart = async (productId) => {
    const form = quickAdd[productId] || {};
    const pn   = (form.pn || "").trim();
    const qty  = parseInt(form.qty) || 1;
    if (!pn) return;

    // Clear the form immediately
    setQAField(productId, "pn", "");
    setQAField(productId, "qty", "");

    const uiPart = {
      reference: pn, refs: [pn], value: form.value || "", mpn: pn,
      description: form.desc || "", footprint: "", manufacturer: form.mfr || "",
      quantity: qty, unitCost: "", projectId: productId,
      reorderQty: "", stockQty: "", preferredSupplier: "mouser",
      orderQty: "", flaggedForOrder: false,
      pricing: null, pricingStatus: "idle", pricingError: "", bestSupplier: null,
    };

    try {
      await createPart(uiPartToDB(uiPart), user.id);
      // realtime INSERT fires → setParts handled in subscription
    } catch (e) { console.error("quickAddPart failed:", e); }
  };

  // ── Update quick-add form field for a product
  const setQAField = (productId, field, value) =>
    setQuickAdd((prev) => ({ ...prev, [productId]: { ...(prev[productId]||{}), [field]: value } }));

  // ── BOM cost simulator — compares cheapest-per-part vs consolidated strategies
  function getShipping(supplierId) {
    const s = SUPPLIERS.find(x => x.id === supplierId);
    return s ? s.shipping : DEFAULT_SHIPPING;
  }

  // Get best price for a part from a specific supplier at given component qty
  function supplierPriceForPart(part, supplierId, needed) {
    const pricing = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
    if (!pricing || !pricing[supplierId]) return null;
    const data = pricing[supplierId];
    if (data.stock <= 0) return null;
    if (!data.priceBreaks?.length) return data.unitPrice > 0 ? data.unitPrice : null;
    let price = data.priceBreaks[0]?.price || data.unitPrice;
    for (const pb of data.priceBreaks) { if (needed >= pb.qty) price = pb.price; }
    return price > 0 ? price : null;
  }

  // Get cheapest available price across all suppliers for a part
  function cheapestForPart(part, needed) {
    const pricing = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
    if (!pricing) return { price: parseFloat(part.unitCost) || 0, supplier: null };
    let best = { price: Infinity, supplier: null };
    for (const [sid, data] of Object.entries(pricing)) {
      if (data.stock <= 0) continue;
      let price = data.unitPrice;
      if (data.priceBreaks?.length) {
        price = data.priceBreaks[0]?.price || data.unitPrice;
        for (const pb of data.priceBreaks) { if (needed >= pb.qty) price = pb.price; }
      }
      if (price > 0 && price < best.price) best = { price, supplier: sid };
    }
    if (best.price === Infinity) best.price = parseFloat(part.unitCost) || 0;
    return best;
  }

  // Simulate a strategy at a given production qty, returns { partsCost, shipping, total, perUnit, suppliers, assignments }
  function simStrategy(prodParts, prodQty, mode) {
    // mode: "cheapest" | supplierId (consolidate to one) | "smart" (minimize total incl shipping)
    const assignments = []; // { partId, supplierId, unitPrice, needed, lineCost }
    const suppliersUsed = new Set();

    for (const part of prodParts) {
      const needed = part.quantity * prodQty;
      if (mode === "cheapest") {
        const { price, supplier } = cheapestForPart(part, needed);
        assignments.push({ partId: part.id, mpn: part.mpn, supplierId: supplier, unitPrice: price, needed, lineCost: price * needed });
        if (supplier) suppliersUsed.add(supplier);
      } else if (mode === "smart") {
        // Handled after this loop
        assignments.push({ partId: part.id, mpn: part.mpn, needed });
      } else {
        // Consolidate to specific supplier
        const price = supplierPriceForPart(part, mode, needed);
        if (price !== null) {
          assignments.push({ partId: part.id, mpn: part.mpn, supplierId: mode, unitPrice: price, needed, lineCost: price * needed });
          suppliersUsed.add(mode);
        } else {
          // Fallback to cheapest if supplier doesn't have this part
          const { price: fp, supplier } = cheapestForPart(part, needed);
          assignments.push({ partId: part.id, mpn: part.mpn, supplierId: supplier, unitPrice: fp, needed, lineCost: fp * needed });
          if (supplier) suppliersUsed.add(supplier);
        }
      }
    }

    if (mode === "smart") {
      // Smart: for each part, consider paying slightly more to avoid an extra shipment
      // First pass: find cheapest for each part
      const cheapestAssign = prodParts.map(part => {
        const needed = part.quantity * prodQty;
        const { price, supplier } = cheapestForPart(part, needed);
        return { part, needed, price, supplier };
      });
      // Count how many parts each supplier is cheapest for
      const supplierCounts = {};
      for (const a of cheapestAssign) { if (a.supplier) supplierCounts[a.supplier] = (supplierCounts[a.supplier]||0) + 1; }
      // Primary supplier = most parts cheapest
      const primarySup = Object.entries(supplierCounts).sort((a,b) => b[1]-a[1])[0]?.[0];

      for (let i = 0; i < prodParts.length; i++) {
        const part = prodParts[i];
        const needed = part.quantity * prodQty;
        const cheapest = cheapestAssign[i];

        if (cheapest.supplier === primarySup || !primarySup) {
          assignments[i] = { partId: part.id, mpn: part.mpn, supplierId: cheapest.supplier, unitPrice: cheapest.price, needed, lineCost: cheapest.price * needed };
          if (cheapest.supplier) suppliersUsed.add(cheapest.supplier);
        } else {
          // Can we get this from primary supplier? If the extra cost < shipping cost / total parts
          const primaryPrice = supplierPriceForPart(part, primarySup, needed);
          const extraCost = primaryPrice !== null ? (primaryPrice - cheapest.price) * needed : Infinity;
          const shippingSaved = getShipping(cheapest.supplier); // cost of adding that extra supplier
          if (primaryPrice !== null && extraCost < shippingSaved) {
            // Consolidate: pay a bit more but save on shipping
            assignments[i] = { partId: part.id, mpn: part.mpn, supplierId: primarySup, unitPrice: primaryPrice, needed, lineCost: primaryPrice * needed };
            suppliersUsed.add(primarySup);
          } else {
            assignments[i] = { partId: part.id, mpn: part.mpn, supplierId: cheapest.supplier, unitPrice: cheapest.price, needed, lineCost: cheapest.price * needed };
            if (cheapest.supplier) suppliersUsed.add(cheapest.supplier);
          }
        }
      }
    }

    const partsCost = assignments.reduce((s, a) => s + (a.lineCost || 0), 0);

    // Per-supplier shipping breakdown
    const shippingBreakdown = [...suppliersUsed].map(sid => {
      const sup = SUPPLIERS.find(x => x.id === sid);
      return { supplierId: sid, name: sup?.name || sid, cost: getShipping(sid) };
    });
    const shipping = shippingBreakdown.reduce((s, sb) => s + sb.cost, 0);

    // Tariff calculation — based on part's COUNTRY OF ORIGIN, not distributor country
    // A part made in China gets tariffed regardless of whether you buy it from Mouser (US) or LCSC (CN)
    const tariffs = (() => { try { return JSON.parse(apiKeys.tariffs_json || "{}"); } catch { return {}; } })();
    const tariffFallback = { ...DEFAULT_TARIFFS, ...tariffs };
    const tariffBreakdown = [];
    let tariffTotal = 0;
    for (const a of assignments) {
      if (!a.supplierId || !a.lineCost) continue;
      // Get country of origin from the part's pricing data
      const part = prodParts.find(p => p.id === a.partId);
      const pricingData = part?.pricing?.[a.supplierId];
      const origin = pricingData?.countryOfOrigin || "";
      const rate = getTariffRate(origin, tariffFallback);
      if (rate > 0) {
        const cost = a.lineCost * (rate / 100);
        tariffTotal += cost;
        tariffBreakdown.push({
          partId: a.partId, mpn: a.mpn, supplierId: a.supplierId,
          origin, rate, goodsValue: a.lineCost, cost,
        });
      }
    }

    const total = partsCost + shipping + tariffTotal;
    return { partsCost, shipping, shippingBreakdown, tariffTotal, tariffBreakdown, total, perUnit: total / prodQty, suppliers: [...suppliersUsed], assignments };
  }

  async function runBomSimulation(productId) {
    const prodParts = parts.filter((p) => p.projectId === productId);
    if (!prodParts.length) return;
    const baseQty = parseInt(bomSim[productId]?.qty) || 100;
    setBomSim(prev => ({ ...prev, [productId]: { ...prev[productId], loading: true } }));

    // Fetch fresh pricing for any parts that don't have it
    const needsFetch = prodParts.filter(p => !p.pricing && p.mpn);
    for (const p of needsFetch) {
      try { await fetchPartPricing(p.id); } catch {}
    }

    // Re-read parts after fetching (use Promise to guarantee state is read before continuing)
    const freshParts = await new Promise(resolve => {
      setParts(current => { resolve(current.filter((p) => p.projectId === productId)); return current; });
    });

    // Test quantities
    const testQtys = [...new Set([
      baseQty,
      Math.ceil(baseQty * 1.1 / 10) * 10,
      Math.ceil(baseQty * 1.2 / 10) * 10,
      Math.ceil(baseQty * 1.5 / 10) * 10,
      Math.ceil(baseQty * 2 / 10) * 10,
      ...[25, 50, 100, 150, 200, 250, 500, 1000].filter(q => q >= baseQty * 0.8 && q <= baseQty * 3),
    ])].sort((a, b) => a - b);

    // Run 3 strategies at each qty: cheapest-per-part, smart (consolidated), primary-supplier-only
    const results = testQtys.map(q => {
      const cheapest = simStrategy(freshParts, q, "cheapest");
      const smart = simStrategy(freshParts, q, "smart");
      return { qty: q, cheapest, smart };
    });

    setBomSim(prev => ({ ...prev, [productId]: { qty: baseQty, results, loading: false } }));
  }

  // ── Derived state
  const visibleParts = parts.filter((p) => {
    const mP = selProject === "all" || p.projectId === selProject || (selProject === "unassigned" && !p.projectId);
    const q = search.toLowerCase();
    return mP && (!q || p.reference.toLowerCase().includes(q) || p.value.toLowerCase().includes(q) || p.mpn.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  });

  const lowStockParts = parts.filter((p) => { const s=parseInt(p.stockQty)||0, r=parseInt(p.reorderQty); return !isNaN(r) && r > 0 && s <= r; });
  const unassignedCount = parts.filter((p) => !p.projectId).length;
  const purchaseOrders = buildPurchaseOrders(parts);
  const poPartCount = Object.values(purchaseOrders).reduce((s,a)=>s+a.length,0);
  const pricedCount = parts.filter((p) => p.pricingStatus === "done").length;
  const hasAnyKey = nexarToken || apiKeys.mouser_api_key || dkToken || apiKeys.arrow_api_key;

  const productCosts = products.map((prod) => {
    const pp = parts.filter((p) => p.projectId === prod.id);
    const total = pp.reduce((s,p) => s+(parseFloat(p.unitCost)||0)*p.quantity, 0);
    return { ...prod, total, partCount: pp.length, costedCount: pp.filter((p)=>p.unitCost).length };
  });

  // Show loading screen while initial DB fetch completes
  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#080a0f",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14 }}>
      <div style={{ width:36,height:36,border:"3px solid #1e2130",borderTopColor:"#f8d377",borderRadius:"50%",animation:"spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontFamily:"'Space Grotesk',sans-serif",color:"#475569",fontSize:13 }}>Loading workspace…</div>
    </div>
  );

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#0d0f14", color:"#e2e8f0",
      fontFamily:"'IBM Plex Mono','Courier New',monospace", display:"flex", flexDirection:"column" }}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={{ background:"#0d0f14", borderBottom:"1px solid #1e2130",
        padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between",
        height:58, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:34,height:34,background:"#f8d377",borderRadius:7,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontWeight:900,fontSize:14,color:"#0d0f14",fontFamily:"'Space Grotesk',sans-serif" }}>JA</div>
          <div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:14,color:"#f1f5f9" }}>Jackson Audio</div>
            <div style={{ fontSize:9,color:"#475569",letterSpacing:"0.15em" }}>BOM MANAGER</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:20, alignItems:"center" }}>
          {[
            { label:"Parts",    value:parts.length,   warn:false },
            { label:"Priced",   value:pricedCount,    warn:false },
            { label:"To Order", value:poPartCount,    warn:poPartCount>0 },
            { label:"Low Stock",value:lowStockParts.length, warn:lowStockParts.length>0 },
          ].map((s) => (
            <div key={s.label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:17,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif",
                color:s.warn&&s.value>0?"#f87171":"#f8d377" }}>{s.value}</div>
              <div style={{ fontSize:9,color:"#475569",letterSpacing:"0.08em" }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
          {/* API status indicator */}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:8,height:8,borderRadius:"50%",
              background: tokenStatus==="ok" ? "#34d399" : tokenStatus==="loading" ? "#f8d377" : "#475569" }} />
            <span style={{ fontSize:10, color:"#475569" }}>
              {tokenStatus==="ok" ? "APIs live" : tokenStatus==="loading" ? "connecting…" : "no API keys"}
            </span>
          </div>
          {/* User + sign out */}
          <div style={{ display:"flex",alignItems:"center",gap:10,borderLeft:"1px solid #1e2130",paddingLeft:14 }}>
            <span style={{ fontSize:10,color:"#475569",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
              {user.email}
            </span>
            <button className="btn-ghost btn-sm" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      {/* ── NAV ── */}
      <nav style={{ display:"flex", padding:"0 28px", borderBottom:"1px solid #1e2130",
        background:"#0d0f14", gap:2 }}>
        {[
          { id:"import",    icon:"⬆", label:"Import BOM" },
          { id:"bom",       icon:"🔩", label:`Parts (${parts.length})` },
          { id:"pricing",   icon:"💰", label:`Pricing ${pricedCount>0?`(${pricedCount}/${parts.length})`:""}` },
          { id:"purchasing",icon:"🛒", label:`Purchasing${poPartCount>0?` (${poPartCount})`:""}` },
          { id:"projects",  icon:"📦", label:"Products" },
          { id:"alerts",    icon:"⚠",  label:`Alerts${lowStockParts.length>0?` (${lowStockParts.length})`:""}` },
          { id:"settings",  icon:"⚙",  label:"Settings" },
        ].map((tab) => (
          <button key={tab.id}
            className={`nav-btn ${activeView===tab.id?"active":""}`}
            onClick={() => setActiveView(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ flex:1, padding:"24px 28px", overflowY:"auto" }}>

        {/* ══════════════════════════════════════
            IMPORT
        ══════════════════════════════════════ */}
        {activeView === "import" && (
          <div style={{ maxWidth:760 }}>
            <h2 style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:21,fontWeight:800,marginBottom:6 }}>Import Bill of Materials</h2>
            <p style={{ color:"#64748b",fontSize:13,marginBottom:24 }}>CSV/TSV from KiCad, Altium, Eagle, or paste directly.</p>

            <div className={`drop-zone ${dragOver?"drag-over":""}`}
              onDragOver={(e)=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={handleDrop}
              onClick={()=>fileRef.current.click()}>
              <div style={{ fontSize:34,marginBottom:10 }}>📋</div>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:14,marginBottom:6 }}>Drop BOM file here</div>
              <div style={{ color:"#475569",fontSize:12 }}>CSV · TSV · TXT — or click to browse</div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display:"none" }} onChange={handleFilePick} />
            </div>

            <div style={{ display:"flex",alignItems:"center",gap:14,margin:"20px 0" }}>
              <div style={{ flex:1,height:1,background:"#1e2130" }} />
              <span style={{ color:"#475569",fontSize:12 }}>or paste directly</span>
              <div style={{ flex:1,height:1,background:"#1e2130" }} />
            </div>

            <textarea rows={8} placeholder={"PN,QTY,DESC\nCRCW060310K0FKEA,4,Resistor 10k 0603\nGRM188R71C104KA01D,2,Cap 100nF 0402\nLM358DR,1,Op-Amp SOIC-8\n\n— or full BOM with headers —\nReference,Value,MPN,Quantity"}
              value={pasteText} onChange={(e)=>setPasteText(e.target.value)}
              style={{ width:"100%",padding:"12px",borderRadius:8,fontSize:12,lineHeight:1.7,resize:"vertical",border:"1px solid #2d3248" }} />
            <div style={{ display:"flex",gap:10,marginTop:12 }}>
              <button className="btn-primary" onClick={()=>handleImport(pasteText)}>↑ Parse & Import</button>
              <button className="btn-ghost" onClick={()=>setPasteText("")}>Clear</button>
            </div>

            {importError && <div style={{ marginTop:14,padding:"11px 16px",background:"#2d1515",border:"1px solid #ef4444",borderRadius:8,color:"#f87171",fontSize:13 }}>⚠ {importError}</div>}
            {importOk    && <div style={{ marginTop:14,padding:"11px 16px",background:"#0d2318",border:"1px solid #10b981",borderRadius:8,color:"#34d399",fontSize:13 }}>{importOk}</div>}
          </div>
        )}

        {/* ══════════════════════════════════════
            PARTS LIBRARY
        ══════════════════════════════════════ */}
        {activeView === "bom" && (
          <div>
            {/* ── Toolbar */}
            <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center" }}>
              <input type="text" placeholder="Search ref, value, MPN…"
                value={search} onChange={(e)=>setSearch(e.target.value)}
                style={{ padding:"8px 13px",borderRadius:7,width:260,fontSize:13 }} />
              <select value={selProject} onChange={(e)=>setSelProject(e.target.value)}
                style={{ padding:"8px 11px",borderRadius:7,fontSize:13 }}>
                <option value="all">All Products</option>
                <option value="unassigned">Unassigned</option>
                {products.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ color:"#475569",fontSize:12,marginLeft:"auto" }}>{visibleParts.length}/{parts.length} parts</span>
              <button className="btn-ghost btn-sm" onClick={()=>setActiveView("import")}>+ Import</button>
            </div>

            {/* ── Bulk-action bar — only visible when parts are selected */}
            {selectedParts.size > 0 && (
              <div style={{ display:"flex",alignItems:"center",gap:14,padding:"10px 16px",
                background:"#1a0e00",border:"1px solid #f8d37750",borderRadius:8,marginBottom:14 }}>
                <span style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:13,color:"#f8d377" }}>
                  {selectedParts.size} part{selectedParts.size!==1?"s":""} selected
                </span>
                <button
                  onClick={deleteSelected}
                  style={{ background:"#ef4444",color:"#fff",border:"none",borderRadius:6,
                    padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",
                    fontFamily:"'Space Grotesk',sans-serif",display:"flex",alignItems:"center",gap:7 }}>
                  🗑 Delete Selected
                </button>
                <button className="btn-ghost btn-sm" onClick={selectNone}>Cancel</button>
              </div>
            )}

            {parts.length === 0 ? (
              <div style={{ textAlign:"center",padding:"80px 20px",color:"#334155" }}>
                <div style={{ fontSize:44,marginBottom:14 }}>🔩</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:15 }}>No parts yet — import a BOM to get started</div>
              </div>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #1e2130" }}>
                      {/* ── Select-all checkbox */}
                      <th style={{ padding:"7px 8px",width:32 }}>
                        <input
                          type="checkbox"
                          title={selectedParts.size === visibleParts.length && visibleParts.length > 0 ? "Deselect all" : "Select all visible"}
                          style={{ width:16,height:16,cursor:"pointer",accentColor:"#f8d377" }}
                          checked={visibleParts.length > 0 && visibleParts.every((p) => selectedParts.has(p.id))}
                          ref={(el) => {
                            // Indeterminate state — some but not all selected
                            if (el) el.indeterminate = selectedParts.size > 0 && !visibleParts.every((p) => selectedParts.has(p.id));
                          }}
                          onChange={(e) => {
                            if (e.target.checked) selectAll(visibleParts.map((p) => p.id));
                            else selectNone();
                          }}
                        />
                      </th>
                      {/* ── 🚩 order flag column */}
                      <th style={{ padding:"7px 4px",width:28,textAlign:"center",color:"#475569",
                        fontFamily:"'Space Grotesk',sans-serif",fontSize:10,fontWeight:700 }}>🚩</th>
                      {["Reference","Value","MPN","Qty","Desc","Product","Supplier","Unit $","Ext $","Stock","Reorder","Search",""].map((h,i)=>(
                        <th key={i} style={{ textAlign:"left",padding:"7px 8px",color:"#475569",
                          fontFamily:"'Space Grotesk',sans-serif",fontSize:10,fontWeight:700,
                          letterSpacing:"0.07em",whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleParts.map((part,i) => {
                      const extCost = (parseFloat(part.unitCost)||0)*part.quantity;
                      const sn=parseInt(part.stockQty)||0,rn=parseInt(part.reorderQty);
                      const isLow = !isNaN(rn)&&rn>0&&sn<=rn;
                      const sup = supplierById(part.preferredSupplier);
                      return (
                        <tr key={part.id} className="table-row"
                          style={{ borderBottom:"1px solid #1a1d26",
                            background: selectedParts.has(part.id) ? "#1a1200"
                              : part.flaggedForOrder ? "#1a1500"
                              : i%2===0 ? "transparent" : "#0f1118" }}>
                          {/* Row select checkbox */}
                          <td style={{ padding:"7px 8px" }}>
                            <input type="checkbox"
                              style={{ width:16,height:16,cursor:"pointer",accentColor:"#f8d377" }}
                              checked={selectedParts.has(part.id)}
                              onChange={() => toggleSelect(part.id)} />
                          </td>
                          {/* Order flag */}
                          <td style={{ padding:"7px 4px",textAlign:"center" }}>
                            <input type="checkbox" style={{ width:16,height:16,cursor:"pointer",accentColor:"#e8500a" }}
                              checked={part.flaggedForOrder} onChange={()=>toggleFlag(part.id)}
                              title="Flag for purchase order" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="text" value={part.reference}
                              onChange={(e)=>updatePart(part.id,"reference",e.target.value)}
                              style={{ width:100,padding:"3px 5px",borderRadius:4,color:"#f8d377",fontWeight:600 }} />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="text" value={part.value||""}
                              onChange={(e)=>updatePart(part.id,"value",e.target.value)}
                              style={{ width:80,padding:"3px 5px",borderRadius:4,color:"#cbd5e1" }} placeholder="—" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="text" value={part.mpn||""}
                              onChange={(e)=>updatePart(part.id,"mpn",e.target.value)}
                              style={{ width:140,padding:"3px 5px",borderRadius:4,color:"#7dd3fc" }} placeholder="—" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="number" value={part.quantity} min="1"
                              onChange={(e)=>updatePart(part.id,"quantity",parseInt(e.target.value)||1)}
                              style={{ width:52,padding:"3px 5px",borderRadius:4,color:"#94a3b8" }} />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="text" value={part.description||""}
                              onChange={(e)=>updatePart(part.id,"description",e.target.value)}
                              style={{ width:120,padding:"3px 5px",borderRadius:4,color:"#94a3b8",fontSize:11 }} placeholder="—" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <div style={{ maxWidth:140 }}>
                              <select value={part.projectId||""} onChange={(e)=>updatePart(part.id,"projectId",e.target.value||null)}
                                style={{ padding:"3px 5px",borderRadius:4,fontSize:11,maxWidth:120 }}>
                                <option value="">Unassigned</option>
                                {products.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <select value={part.preferredSupplier||"mouser"}
                              onChange={(e)=>updatePart(part.id,"preferredSupplier",e.target.value)}
                              style={{ padding:"3px 5px",borderRadius:4,fontSize:11,borderColor:sup.color,color:sup.color,fontWeight:700 }}>
                              {SUPPLIERS.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <div style={{ display:"flex",alignItems:"center" }}>
                              <span style={{ color:"#475569",marginRight:2,fontSize:11 }}>$</span>
                              <input type="number" placeholder="0.00" value={part.unitCost}
                                onChange={(e)=>updatePart(part.id,"unitCost",e.target.value)}
                                style={{ width:64,padding:"3px 5px",borderRadius:4 }} step="0.0001" min="0" />
                            </div>
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            {part.unitCost
                              ? <span style={{ color:"#34d399",fontWeight:600 }}>${extCost.toFixed(2)}</span>
                              : <span style={{ color:"#334155" }}>—</span>}
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="number" placeholder="0" value={part.stockQty}
                              onChange={(e)=>updatePart(part.id,"stockQty",e.target.value)}
                              style={{ width:52,padding:"3px 5px",borderRadius:4,borderColor:isLow?"#ef4444":undefined }} min="0" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            <input type="number" placeholder="0" value={part.reorderQty}
                              onChange={(e)=>updatePart(part.id,"reorderQty",e.target.value)}
                              style={{ width:52,padding:"3px 5px",borderRadius:4 }} min="0" />
                          </td>
                          <td style={{ padding:"7px 8px" }}>
                            {part.mpn ? (
                              <div style={{ display:"flex",gap:3,flexWrap:"wrap" }}>
                                {SUPPLIERS.map((s)=>(
                                  <a key={s.id} href={s.searchUrl(part.mpn)} target="_blank" rel="noopener noreferrer"
                                    className="supplier-pill" style={{ background:s.color,color:"#fff" }}>{s.logo}</a>
                                ))}
                              </div>
                            ) : <span style={{ color:"#334155",fontSize:11 }}>No MPN</span>}
                          </td>
                          <td style={{ padding:"7px 4px" }}>
                            <button onClick={()=>deletePart(part.id)}
                              style={{ background:"none",border:"none",cursor:"pointer",color:"#334155",fontSize:13,padding:"2px 5px",borderRadius:4,transition:"color 0.15s" }}
                              onMouseOver={(e)=>e.target.style.color="#ef4444"}
                              onMouseOut={(e)=>e.target.style.color="#334155"}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            LIVE PRICING VIEW — Clean List
        ══════════════════════════════════════ */}
        {activeView === "pricing" && (
          <div style={{ background:"#f5f5f7",borderRadius:16,padding:"28px 24px",margin:"-8px -4px",minHeight:"60vh" }}>
            {/* Header */}
            <div style={{ marginBottom:28 }}>
              <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:"#1d1d1f",marginBottom:4 }}>Live Pricing</h2>
              <p style={{ fontSize:14,color:"#86868b" }}>Real-time pricing across all distributors. Click any part to expand.</p>
              <div style={{ display:"flex",gap:10,marginTop:14,flexWrap:"wrap" }}>
                {!hasAnyKey && (
                  <button onClick={()=>setActiveView("settings")}
                    style={{ padding:"8px 18px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #ff9500",color:"#ff9500",background:"none" }}>
                    Configure API Keys
                  </button>
                )}
                <button
                  disabled={!hasAnyKey || fetchingAll || parts.filter(p=>p.mpn).length===0}
                  onClick={fetchAllPartsPricing}
                  style={{ padding:"8px 18px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#0071e3",color:"#fff",opacity:(!hasAnyKey||fetchingAll)?"0.4":"1" }}>
                  {fetchingAll ? "Fetching…" : "Fetch All Prices"}
                </button>
                <button onClick={()=>setUsOnly(v=>!v)}
                  style={{ padding:"8px 18px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                    border:usOnly?"none":"1px solid #d2d2d7",
                    background:usOnly?"#1d1d1f":"none",
                    color:usOnly?"#fff":"#1d1d1f" }}>
                  {usOnly ? "US Only" : "All Countries"}
                </button>
              </div>
            </div>

            {parts.length === 0 ? (
              <div style={{ textAlign:"center",padding:60,color:"#86868b" }}>
                <div style={{ fontSize:14,fontFamily:"-apple-system,sans-serif" }}>Import a BOM first</div>
              </div>
            ) : (
              <>
                {/* Best price badges */}
                {(() => {
                  const allPriced = parts.filter(p => p.pricing && typeof p.pricing === "object");
                  if (!allPriced.length) return null;
                  const p100 = (d) => { let p = d.unitPrice; if (d.priceBreaks?.length) { for (const pb of d.priceBreaks) { if (100 >= pb.qty) p = pb.price; } } return parseFloat(p) || d.unitPrice; };
                  const gc = (d) => d.country || DIST_COUNTRY[d.displayName] || DIST_COUNTRY[d.supplierId] || "";
                  let globalBestUS = null, globalBestIntl = null;
                  for (const part of allPriced) {
                    for (const d of Object.values(part.pricing)) {
                      if (!d.stock || d.stock <= 0) continue;
                      const c = gc(d); const price = p100(d);
                      if (c === "US" && (!globalBestUS || price < globalBestUS.price)) globalBestUS = { ...d, price };
                      if (c && c !== "US" && (!globalBestIntl || price < globalBestIntl.price)) globalBestIntl = { ...d, price };
                    }
                  }
                  if (!globalBestUS && !globalBestIntl) return null;
                  let userTariffs; try { userTariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { userTariffs = { ...DEFAULT_TARIFFS }; }
                  return (
                    <div style={{ display:"flex",gap:12,marginBottom:24,flexWrap:"wrap" }}>
                      {globalBestUS && (
                        <div style={{ flex:1,minWidth:200,background:"#fff",borderRadius:16,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                          <div style={{ fontSize:11,fontWeight:600,letterSpacing:"0.5px",color:"#86868b",textTransform:"uppercase" }}>Best USA</div>
                          <div style={{ fontSize:30,fontWeight:700,letterSpacing:"-1px",marginTop:4,color:"#34c759" }}>{"$"}{fmtPrice(globalBestUS.price)}</div>
                          <div style={{ fontSize:12,color:"#86868b",marginTop:4 }}>{globalBestUS.displayName} · {(globalBestUS.stock||0).toLocaleString()} in stock</div>
                        </div>
                      )}
                      {globalBestIntl && !usOnly && (() => {
                        const origin = globalBestIntl.countryOfOrigin || gc(globalBestIntl);
                        const rate = getTariffRate(origin, userTariffs);
                        const landed = rate > 0 ? globalBestIntl.price * (1 + rate / 100) : 0;
                        return (
                          <div style={{ flex:1,minWidth:200,background:"#fff",borderRadius:16,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                            <div style={{ fontSize:11,fontWeight:600,letterSpacing:"0.5px",color:"#86868b",textTransform:"uppercase" }}>Best International</div>
                            <div style={{ fontSize:30,fontWeight:700,letterSpacing:"-1px",marginTop:4,color:"#ff9500" }}>{"$"}{fmtPrice(globalBestIntl.price)}</div>
                            <div style={{ fontSize:12,color:"#86868b",marginTop:4 }}>{globalBestIntl.displayName} ({gc(globalBestIntl)}) · {(globalBestIntl.stock||0).toLocaleString()} in stock</div>
                            {landed > 0 && <div style={{ fontSize:11,color:"#ff3b30",marginTop:2 }}>Landed: {"$"}{fmtPrice(landed)} (+{rate}% tariff)</div>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Part list */}
                <div style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden" }}>
                  {parts.map((part, partIdx) => {
                    const pricingObj = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
                    const hasPricing = pricingObj && Object.keys(pricingObj).length > 0;
                    const best = part.bestSupplier || (hasPricing ? bestPriceSupplier(pricingObj) : null);
                    const bestData = hasPricing && best ? pricingObj[best] : null;
                    const effectiveStatus = hasPricing ? "done" : part.pricingStatus;
                    const isOpen = expandedPart === part.id;

                    // Sort suppliers
                    const p100 = (d) => { let p = d.unitPrice; if (d.priceBreaks?.length) { for (const pb of d.priceBreaks) { if (100 >= pb.qty) p = pb.price; } } return parseFloat(p) || d.unitPrice; };
                    const getCountry = (d) => d.country || DIST_COUNTRY[d.displayName] || DIST_COUNTRY[d.supplierId] || "";
                    const isNonUS = (d) => { const c = getCountry(d); return c && c !== "US"; };
                    const sorted = hasPricing ? Object.entries(pricingObj)
                      .filter(([,d]) => d.stock > 0 && (!usOnly || !isNonUS(d)))
                      .sort((a,b) => {
                        const aUS = getCountry(a[1])==="US"?0:1, bUS = getCountry(b[1])==="US"?0:1;
                        if (aUS !== bUS) return aUS - bUS;
                        return (p100(a[1])||Infinity) - (p100(b[1])||Infinity);
                      }) : [];

                    // Tariff helpers
                    let userTariffs; try { userTariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { userTariffs = { ...DEFAULT_TARIFFS }; }

                    // Best display price
                    const bestDisplayPrice = bestData ? p100(bestData) : null;

                    return (
                      <div key={part.id} style={{ borderBottom: partIdx < parts.length-1 ? "1px solid #f0f0f2" : "none" }}>
                        {/* Collapsed row — click to expand */}
                        <div onClick={() => setExpandedPart(isOpen ? null : part.id)}
                          style={{ display:"flex",alignItems:"center",padding:"14px 22px",cursor:"pointer",
                            transition:"background 0.15s",background:isOpen?"rgba(0,0,0,0.02)":"transparent" }}
                          onMouseOver={e=>{if(!isOpen)e.currentTarget.style.background="rgba(0,0,0,0.02)"}}
                          onMouseOut={e=>{if(!isOpen)e.currentTarget.style.background="transparent"}}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:15,fontWeight:600,color:"#1d1d1f",display:"flex",alignItems:"center",gap:6 }}>
                              {part.mpn || part.reference}
                              <span style={{ fontSize:11,color:"#86868b",fontWeight:400,transition:"transform 0.2s",display:"inline-block",
                                transform:isOpen?"rotate(90deg)":"none" }}>›</span>
                            </div>
                            <div style={{ fontSize:12,color:"#86868b",marginTop:1 }}>
                              {part.description ? `${part.description} · ` : ""}{part.value ? `${part.value} · ` : ""}qty {part.quantity}
                            </div>
                          </div>
                          <div style={{ textAlign:"right",minWidth:100 }}>
                            {effectiveStatus === "done" && bestDisplayPrice ? (
                              <>
                                <div style={{ fontSize:20,fontWeight:600,letterSpacing:"-0.3px",color:"#1d1d1f" }}>{"$"}{fmtPrice(bestDisplayPrice)}</div>
                                <div style={{ fontSize:11,color:"#86868b",marginTop:1 }}>
                                  <span style={{ display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#34c759",marginRight:4,verticalAlign:"middle" }}></span>
                                  {bestData?.displayName || best}
                                </div>
                              </>
                            ) : part.pricingStatus === "loading" ? (
                              <span style={{ fontSize:12,color:"#86868b" }}>Fetching…</span>
                            ) : part.pricingStatus === "error" ? (
                              <span style={{ fontSize:11,color:"#ff3b30" }}>Error</span>
                            ) : (
                              <button onClick={(e)=>{e.stopPropagation();if(part.mpn&&hasAnyKey)fetchPartPricing(part.id);}}
                                disabled={!part.mpn||!hasAnyKey}
                                style={{ padding:"5px 12px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                  border:"1px solid #d2d2d7",background:"none",color:"#1d1d1f",opacity:(!part.mpn||!hasAnyKey)?"0.4":"1" }}>
                                {!part.mpn ? "No MPN" : "Fetch Price"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Expanded panel */}
                        {isOpen && (
                          <div style={{ padding:"0 22px 18px",animation:"none" }}>
                            {/* Supplier cards */}
                            {sorted.length > 0 ? (
                              <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:14 }}>
                                {sorted.map(([key, data]) => {
                                  const isBest = key === best;
                                  const ctry = getCountry(data);
                                  const displayPrice = p100(data);
                                  const origin = data.countryOfOrigin || "";
                                  const tariffRate = getTariffRate(origin, userTariffs);
                                  const landedPrice = tariffRate > 0 ? displayPrice * (1 + tariffRate / 100) : 0;
                                  return (
                                    <div key={key} style={{
                                      background: isBest ? "rgba(0,113,227,0.06)" : "#f5f5f7",
                                      border: isBest ? "1.5px solid rgba(0,113,227,0.2)" : "1.5px solid transparent",
                                      borderRadius:12, padding:"12px 16px", minWidth:150, flex:1, maxWidth:200,
                                      transition:"all 0.15s"
                                    }}>
                                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                        <span style={{ fontSize:12,fontWeight:500,color:"#86868b" }}>{data.displayName}</span>
                                        <span style={{ fontSize:10,color:"#aeaeb2",fontWeight:500 }}>{ctry}</span>
                                      </div>
                                      <div style={{ fontSize:18,fontWeight:700,letterSpacing:"-0.3px",marginTop:4,
                                        color:isBest?"#0071e3":"#1d1d1f" }}>{"$"}{fmtPrice(displayPrice)}</div>
                                      <div style={{ fontSize:10,color:"#aeaeb2",marginTop:4 }}>Stock: {data.stock.toLocaleString()} · MOQ: {data.moq}</div>
                                      {landedPrice > 0 && (
                                        <div style={{ fontSize:10,color:"#ff3b30",marginTop:3,fontWeight:500 }}>
                                          Landed: {"$"}{fmtPrice(landedPrice)} ({origin} +{tariffRate}%)
                                        </div>
                                      )}
                                      {data.priceBreaks?.length > 1 && (
                                        <div style={{ marginTop:8,borderTop:"1px solid rgba(0,0,0,0.06)",paddingTop:6 }}>
                                          {data.priceBreaks.map((pb, i) => (
                                            <div key={i} style={{ display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0" }}>
                                              <span style={{ color:"#aeaeb2" }}>{pb.qty}+</span>
                                              <span style={{ color:isBest?"#0071e3":"#1d1d1f",fontWeight:500 }}>{"$"}{fmtPrice(pb.price)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {data.url && (
                                        <a href={data.url} target="_blank" rel="noopener noreferrer"
                                          style={{ display:"block",marginTop:8,fontSize:11,color:"#0071e3",textDecoration:"none",fontWeight:500 }}
                                          onClick={e=>e.stopPropagation()}>
                                          View on site →
                                        </a>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : effectiveStatus === "done" ? (
                              <div style={{ padding:16,textAlign:"center",color:"#aeaeb2",fontSize:13 }}>No suppliers with stock{usOnly ? " (US Only filter is on)" : ""}</div>
                            ) : (
                              <div style={{ padding:16,textAlign:"center",color:"#aeaeb2",fontSize:13 }}>No pricing data yet</div>
                            )}

                            {/* Refresh button */}
                            {effectiveStatus === "done" && (
                              <div style={{ marginBottom:14 }}>
                                <button onClick={(e)=>{e.stopPropagation();fetchPartPricing(part.id);}}
                                  style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                    border:"1px solid #d2d2d7",background:"none",color:"#86868b" }}>
                                  Refresh Prices
                                </button>
                              </div>
                            )}

                            {/* Inline edit */}
                            <div style={{ padding:"14px 16px",background:"#f5f5f7",borderRadius:12,display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end" }}>
                              <div>
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Reference</div>
                                <input type="text" value={part.reference}
                                  onChange={e=>updatePart(part.id,"reference",e.target.value)}
                                  style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:100 }} />
                              </div>
                              <div>
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>MPN</div>
                                <input type="text" value={part.mpn}
                                  onChange={e=>updatePart(part.id,"mpn",e.target.value)}
                                  style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:160 }} />
                              </div>
                              <div>
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Qty</div>
                                <input type="number" value={part.quantity} min="1"
                                  onChange={e=>updatePart(part.id,"quantity",parseInt(e.target.value)||1)}
                                  style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:70 }} />
                              </div>
                              <div>
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Description</div>
                                <input type="text" value={part.description||""}
                                  onChange={e=>updatePart(part.id,"description",e.target.value)}
                                  style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:160 }} />
                              </div>
                              <div>
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Value</div>
                                <input type="text" value={part.value||""}
                                  onChange={e=>updatePart(part.id,"value",e.target.value)}
                                  style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:80 }} />
                              </div>
                              <button onClick={()=>{deletePart(part.id);setExpandedPart(null);}}
                                style={{ padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                  border:"1px solid #ff3b30",background:"none",color:"#ff3b30" }}>
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            PURCHASING / POs
        ══════════════════════════════════════ */}
        {activeView === "purchasing" && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12 }}>
              <div>
                <h2 style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:21,fontWeight:800,marginBottom:4 }}>Purchase Orders</h2>
                <p style={{ color:"#64748b",fontSize:13 }}>Parts grouped by preferred supplier. One PO per vendor.</p>
              </div>
              <button className="btn-ghost" onClick={()=>setActiveView("bom")}>✏ Edit Parts & Flags</button>
            </div>

            {poPartCount === 0 ? (
              <div className="card" style={{ textAlign:"center",padding:"60px 30px" }}>
                <div style={{ fontSize:44,marginBottom:14 }}>🛒</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:16,marginBottom:8 }}>No parts flagged for ordering</div>
                <div style={{ color:"#64748b",fontSize:13,maxWidth:400,margin:"0 auto 20px" }}>
                  Flag parts in the Parts Library with the 🚩 checkbox, or set stock/reorder thresholds.
                </div>
                <button className="btn-primary" onClick={()=>setActiveView("bom")}>Go to Parts Library</button>
              </div>
            ) : (
              SUPPLIERS.map((sup) => {
                const lines = purchaseOrders[sup.id];
                if (!lines?.length) return null;
                const poNum = genPONumber(sup.id);
                const poTotal = lines.reduce((s,p)=>s+(parseFloat(p.unitCost)||0)*p.neededQty, 0);
                const totalUnits = lines.reduce((s,p)=>s+p.neededQty, 0);
                return (
                  <div key={sup.id} className="po-card" style={{ borderTop:`3px solid ${sup.color}` }}>
                    <div className="po-header" style={{ background:sup.bg }}>
                      <div style={{ display:"flex",alignItems:"center",gap:14 }}>
                        <div style={{ width:38,height:38,background:sup.color,borderRadius:8,display:"flex",
                          alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:12,color:"#fff",
                          fontFamily:"'Space Grotesk',sans-serif" }}>{sup.logo}</div>
                        <div>
                          <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:17,color:sup.color }}>{sup.name}</div>
                          <div style={{ fontSize:11,color:"#64748b" }}>{lines.length} lines · {totalUnits} units{poTotal>0?` · est. $${poTotal.toFixed(2)}`:""}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                        <a href={sup.searchUrl("")} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}>
                          <button className="btn-primary" style={{ background:sup.color,color:"#fff" }}>🛒 Order on {sup.name}</button>
                        </a>
                        <button className="btn-ghost" onClick={()=>exportPOasCSV(sup,lines,poNum)}>↓ CSV</button>
                        <button className="btn-ghost" onClick={()=>printPO(sup,lines,poNum)}>🖨 Print PO</button>
                        {(() => {
                          let emails = {};
                          try { emails = JSON.parse(apiKeys.supplier_emails || "{}"); } catch {}
                          const email = emails[sup.id];
                          if (!email) return null;
                          const draft = buildPOEmailDraft(sup.name, lines, poNum);
                          return (
                            <button className="btn-ghost" onClick={() => {
                              window.location.href = `mailto:${email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
                            }}>✉ Draft Email to {sup.name}</button>
                          );
                        })()}
                      </div>
                    </div>
                    <div style={{ overflowX:"auto" }}>
                      <table className="po-table">
                        <thead><tr>
                          <th>Reference</th><th>MPN</th><th>Description</th><th>Mfr</th>
                          <th style={{ textAlign:"center" }}>Need</th><th style={{ textAlign:"center" }}>Stock</th>
                          <th style={{ textAlign:"right" }}>Unit $</th><th style={{ textAlign:"right" }}>Ext $</th>
                          <th>Search</th><th>Remove</th>
                        </tr></thead>
                        <tbody>
                          {lines.map((part) => {
                            const ext = (parseFloat(part.unitCost)||0)*part.neededQty;
                            return (
                              <tr key={part.id}>
                                <td style={{ color:"#f8d377",fontWeight:600 }}>{part.reference}</td>
                                <td style={{ color:"#7dd3fc" }}>{part.mpn||"—"}</td>
                                <td style={{ color:"#94a3b8" }}>{part.description||part.value||"—"}</td>
                                <td style={{ color:"#64748b" }}>{part.manufacturer||"—"}</td>
                                <td style={{ textAlign:"center" }}>
                                  <input type="number" min="1" value={part.orderQty||part.neededQty}
                                    onChange={(e)=>updatePart(part.id,"orderQty",e.target.value)}
                                    style={{ width:56,padding:"3px 6px",borderRadius:4,textAlign:"center",
                                      border:"1px solid #f8d37750",color:"#f8d377",fontWeight:700 }} />
                                </td>
                                <td style={{ textAlign:"center",color:"#64748b" }}>{part.stockQty||"—"}</td>
                                <td style={{ textAlign:"right" }}>
                                  {part.unitCost ? <span style={{ color:"#94a3b8" }}>${fmtPrice(part.unitCost)}</span> : <span style={{ color:"#334155" }}>—</span>}
                                </td>
                                <td style={{ textAlign:"right" }}>
                                  {part.unitCost ? <span style={{ color:"#34d399",fontWeight:700 }}>${ext.toFixed(2)}</span> : <span style={{ color:"#334155" }}>—</span>}
                                </td>
                                <td>
                                  {part.mpn ? (
                                    <div style={{ display:"flex",gap:3 }}>
                                      {SUPPLIERS.map((s)=>(
                                        <a key={s.id} href={s.searchUrl(part.mpn)} target="_blank" rel="noopener noreferrer"
                                          className="supplier-pill" style={{ background:s.color,color:"#fff",padding:"2px 7px" }}>{s.logo}</a>
                                      ))}
                                    </div>
                                  ) : "—"}
                                </td>
                                <td>
                                  <button style={{ background:"none",border:"1px solid #ef444430",color:"#ef4444",
                                    borderRadius:5,padding:"4px 8px",fontSize:11,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif" }}
                                    onClick={()=>{ updatePart(part.id,"flaggedForOrder",false); updatePart(part.id,"orderQty",""); }}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr style={{ background:"#0d0f14",borderTop:"2px solid #1e2130" }}>
                            <td colSpan={4} style={{ padding:"10px 12px",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,color:"#64748b",fontSize:12 }}>{lines.length} LINE ITEMS</td>
                            <td style={{ textAlign:"center",color:"#f8d377",fontWeight:800,fontFamily:"'Space Grotesk',sans-serif" }}>{totalUnits}</td>
                            <td colSpan={2} />
                            <td style={{ textAlign:"right",color:poTotal>0?"#34d399":"#334155",fontWeight:800,fontFamily:"'Space Grotesk',sans-serif",fontSize:14 }}>{poTotal>0?`$${poTotal.toFixed(2)}`:"—"}</td>
                            <td colSpan={2} />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            PRODUCTS
        ══════════════════════════════════════ */}
        {activeView === "projects" && (
          <div>
            {/* Header + new product form */}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexWrap:"wrap",gap:12 }}>
              <div>
                <h2 style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:21,fontWeight:800,marginBottom:4 }}>Products</h2>
                <p style={{ color:"#64748b",fontSize:13 }}>Add parts directly to any product. Only Part Number and Quantity required.</p>
              </div>
              <div style={{ display:"flex",gap:10 }}>
                <input type="text" placeholder="New product name…" value={newProjName}
                  onChange={(e)=>setNewProjName(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&addProduct()}
                  style={{ padding:"8px 13px",borderRadius:7,fontSize:13,width:220 }} />
                <button className="btn-primary" onClick={addProduct}>+ New Product</button>
              </div>
            </div>

            {products.length === 0 && (
              <div className="card" style={{ textAlign:"center",padding:60,color:"#334155" }}>
                <div style={{ fontSize:40,marginBottom:12 }}>📦</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:15 }}>No products yet — create one above</div>
              </div>
            )}

            {/* One card per product */}
            {productCosts.map((prod) => {
              const cov = prod.partCount>0 ? Math.round(prod.costedCount/prod.partCount*100) : 0;
              const prodParts = parts.filter((p) => p.projectId === prod.id);
              const qa = quickAdd[prod.id] || {};
              const showOpt = qa.showOptional || false;

              return (
                <div key={prod.id} className="card"
                  style={{ borderTop:`3px solid ${prod.color}`, marginBottom:16 }}>

                  {/* ── Product header row */}
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10 }}>
                    <div>
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:17,color:"#f1f5f9",marginBottom:3 }}>
                        {prod.name}
                      </div>
                      <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                        <span className="badge" style={{ background:prod.color+"22",color:prod.color }}>
                          {prod.partCount} part{prod.partCount!==1?"s":""}
                        </span>
                        <span style={{ fontSize:12,color:"#34d399",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700 }}>
                          BOM: ${prod.total.toFixed(2)}
                        </span>
                        {prod.partCount > 0 && (
                          <span style={{ fontSize:11,color:"#475569" }}>
                            {cov}% costed
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                      <button className="btn-ghost" style={{ fontSize:11 }}
                        disabled={!prodParts.some(p => p.mpn) || prodParts.some(p => p.pricingStatus === "loading")}
                        onClick={async () => {
                          const toFetch = prodParts.filter(p => p.mpn);
                          for (const p of toFetch) {
                            await fetchPartPricing(p.id);
                            await new Promise(r => setTimeout(r, 300));
                          }
                        }}>
                        {prodParts.some(p => p.pricingStatus === "loading")
                          ? <><span className="spinner" /> Refreshing…</>
                          : `↻ Refresh Prices (${prodParts.filter(p=>p.mpn).length})`}
                      </button>
                      <button className="btn-ghost" style={{ fontSize:11 }}
                        onClick={()=>{ setSelProject(prod.id); setActiveView("bom"); }}>
                        View in Parts Library →
                      </button>
                    </div>
                  </div>

                  {/* ── Quick-add part form */}
                  <div style={{ background:"#0d0f14",borderRadius:8,padding:"14px 16px",marginBottom:prodParts.length>0?14:0 }}>
                    <div style={{ fontSize:10,color:"#475569",letterSpacing:"0.1em",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,marginBottom:10 }}>
                      + ADD PART TO {prod.name.toUpperCase()}
                    </div>

                    {/* Required row: Part Number + Qty + Add button */}
                    <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" }}>
                      <div style={{ flex:"1 1 200px" }}>
                        <div style={{ fontSize:10,color:"#64748b",marginBottom:3 }}>Part Number <span style={{ color:"#ef4444" }}>*</span></div>
                        <input
                          type="text"
                          placeholder="e.g. LOP-300-24"
                          value={qa.pn || ""}
                          onChange={(e) => setQAField(prod.id, "pn", e.target.value)}
                          onKeyDown={(e) => { if(e.key==="Enter") quickAddPart(prod.id); }}
                          style={{ padding:"8px 12px",borderRadius:6,width:"100%",
                            fontSize:13,fontWeight:600,
                            borderColor: qa.pn ? prod.color : undefined }}
                        />
                      </div>

                      <div style={{ flex:"0 0 80px" }}>
                        <div style={{ fontSize:10,color:"#64748b",marginBottom:3 }}>Qty <span style={{ color:"#ef4444" }}>*</span></div>
                        <input
                          type="number"
                          placeholder="1"
                          min="1"
                          value={qa.qty || ""}
                          onChange={(e) => setQAField(prod.id, "qty", e.target.value)}
                          onKeyDown={(e) => { if(e.key==="Enter") quickAddPart(prod.id); }}
                          style={{ padding:"8px 10px",borderRadius:6,width:"100%",fontSize:13 }}
                        />
                      </div>

                      <div style={{ flex:"0 0 auto",alignSelf:"flex-end" }}>
                        <button
                          className="btn-primary"
                          disabled={!qa.pn?.trim()}
                          onClick={() => quickAddPart(prod.id)}
                          style={{ background: qa.pn?.trim() ? prod.color : undefined,
                            color: qa.pn?.trim() ? "#fff" : undefined }}>
                          + Add Part
                        </button>
                      </div>

                      {/* Toggle optional fields */}
                      <div style={{ flex:"0 0 auto",alignSelf:"flex-end" }}>
                        <button className="btn-ghost" style={{ fontSize:11 }}
                          onClick={() => setQAField(prod.id, "showOptional", !showOpt)}>
                          {showOpt ? "▲ Less" : "▼ More fields"}
                        </button>
                      </div>
                    </div>

                    {/* Optional fields — shown when expanded */}
                    {showOpt && (
                      <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginTop:10 }}>
                        <div style={{ flex:"1 1 160px" }}>
                          <div style={{ fontSize:10,color:"#64748b",marginBottom:3 }}>Description</div>
                          <input type="text" placeholder="e.g. 24V Power Supply"
                            value={qa.desc || ""}
                            onChange={(e) => setQAField(prod.id, "desc", e.target.value)}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12 }} />
                        </div>
                        <div style={{ flex:"1 1 100px" }}>
                          <div style={{ fontSize:10,color:"#64748b",marginBottom:3 }}>Value</div>
                          <input type="text" placeholder="e.g. 10k"
                            value={qa.value || ""}
                            onChange={(e) => setQAField(prod.id, "value", e.target.value)}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12 }} />
                        </div>
                        <div style={{ flex:"1 1 140px" }}>
                          <div style={{ fontSize:10,color:"#64748b",marginBottom:3 }}>Manufacturer</div>
                          <input type="text" placeholder="e.g. Mean Well"
                            value={qa.mfr || ""}
                            onChange={(e) => setQAField(prod.id, "mfr", e.target.value)}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12 }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Parts list for this product */}
                  {prodParts.length > 0 && (
                    <div style={{ overflowX:"auto" }}>
                      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                        <thead>
                          <tr style={{ borderBottom:"1px solid #1e2130" }}>
                            {["Part Number","Qty","Description","Value","Mfr","Unit $","Ext $",""].map((h,i)=>(
                              <th key={i} style={{ padding:"6px 10px",textAlign:"left",
                                fontSize:10,fontWeight:700,letterSpacing:"0.07em",
                                color:"#475569",fontFamily:"'Space Grotesk',sans-serif",
                                whiteSpace:"nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {prodParts.map((part,i) => {
                            const ext = (parseFloat(part.unitCost)||0)*part.quantity;
                            return (
                              <tr key={part.id}
                                style={{ borderBottom:"1px solid #1a1d26",
                                  background:i%2===0?"transparent":"#0f1118" }}>
                                <td style={{ padding:"7px 10px" }}>
                                  <input type="text" value={part.mpn||""}
                                    onChange={(e)=>{updatePart(part.id,"mpn",e.target.value);if(!part.reference)updatePart(part.id,"reference",e.target.value);}}
                                    style={{ width:140,padding:"2px 6px",borderRadius:4,fontSize:12,color:"#f8d377",fontWeight:700 }} placeholder="Part #" />
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  <input type="number" min="1" value={part.quantity}
                                    onChange={(e)=>updatePart(part.id,"quantity",parseInt(e.target.value)||1)}
                                    style={{ width:52,padding:"2px 6px",borderRadius:4,fontSize:12 }} />
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  <input type="text" value={part.description||""}
                                    onChange={(e)=>updatePart(part.id,"description",e.target.value)}
                                    style={{ width:140,padding:"2px 6px",borderRadius:4,fontSize:12,color:"#64748b" }} placeholder="—" />
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  <input type="text" value={part.value||""}
                                    onChange={(e)=>updatePart(part.id,"value",e.target.value)}
                                    style={{ width:80,padding:"2px 6px",borderRadius:4,fontSize:12,color:"#cbd5e1" }} placeholder="—" />
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  <input type="text" value={part.manufacturer||""}
                                    onChange={(e)=>updatePart(part.id,"manufacturer",e.target.value)}
                                    style={{ width:100,padding:"2px 6px",borderRadius:4,fontSize:12,color:"#64748b" }} placeholder="—" />
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  <div style={{ display:"flex",alignItems:"center" }}>
                                    <span style={{ color:"#475569",marginRight:2,fontSize:11 }}>$</span>
                                    <input type="number" placeholder="0.00" value={part.unitCost}
                                      onChange={(e)=>updatePart(part.id,"unitCost",e.target.value)}
                                      style={{ width:60,padding:"2px 5px",borderRadius:4,fontSize:12 }}
                                      step="0.0001" min="0" />
                                  </div>
                                </td>
                                <td style={{ padding:"7px 10px" }}>
                                  {part.unitCost
                                    ? <span style={{ color:"#34d399",fontWeight:600 }}>${ext.toFixed(2)}</span>
                                    : <span style={{ color:"#334155" }}>—</span>}
                                </td>
                                <td style={{ padding:"7px 6px" }}>
                                  <button onClick={()=>deletePart(part.id)}
                                    style={{ background:"none",border:"none",cursor:"pointer",
                                      color:"#334155",fontSize:13,padding:"2px 6px",
                                      borderRadius:4,transition:"color 0.15s" }}
                                    onMouseOver={(e)=>e.target.style.color="#ef4444"}
                                    onMouseOut={(e)=>e.target.style.color="#334155"}>✕</button>
                                </td>
                              </tr>
                            );
                          })}
                          {/* BOM total row */}
                          <tr style={{ background:"#0d0f14",borderTop:"1px solid #2d3248" }}>
                            <td colSpan={5} style={{ padding:"8px 10px",fontSize:11,color:"#475569",
                              fontFamily:"'Space Grotesk',sans-serif",fontWeight:700 }}>
                              {prodParts.length} PARTS
                            </td>
                            <td colSpan={2} style={{ padding:"8px 10px",textAlign:"right",
                              color:"#34d399",fontWeight:800,fontFamily:"'Space Grotesk',sans-serif",fontSize:14 }}>
                              ${prod.total.toFixed(2)}
                            </td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                  {/* ── BOM Cost Simulator */}
                  {prodParts.length > 0 && (
                    <div style={{ marginTop:16,background:"#0d0f14",borderRadius:8,padding:"14px 16px" }}>
                      <div style={{ fontSize:10,color:"#6366f1",letterSpacing:"0.1em",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,marginBottom:10 }}>
                        PRODUCTION RUN SIMULATOR
                      </div>
                      <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12 }}>
                        <span style={{ fontSize:12,color:"#94a3b8" }}>If I build</span>
                        <input type="number" min="1" placeholder="100"
                          value={bomSim[prod.id]?.qty || ""}
                          onChange={(e) => setBomSim(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], qty: e.target.value } }))}
                          style={{ width:80,padding:"6px 10px",borderRadius:5,fontSize:14,fontWeight:700,textAlign:"center" }} />
                        <span style={{ fontSize:12,color:"#94a3b8" }}>units of <strong style={{ color:"#f1f5f9" }}>{prod.name}</strong>…</span>
                        <button className="btn-primary" style={{ fontSize:12 }}
                          disabled={bomSim[prod.id]?.loading || !parseInt(bomSim[prod.id]?.qty)}
                          onClick={() => runBomSimulation(prod.id)}>
                          {bomSim[prod.id]?.loading ? <><span className="spinner" /> Calculating…</> : "Run Simulation"}
                        </button>
                      </div>

                      {bomSim[prod.id]?.results && (() => {
                        const results = bomSim[prod.id].results;
                        const baseQty = parseInt(bomSim[prod.id].qty) || 100;
                        const baseResult = results.find(r => r.qty === baseQty);
                        if (!baseResult) return null;

                        const cheapBase = baseResult.cheapest;
                        const smartBase = baseResult.smart;
                        const smartSavings = cheapBase.total - smartBase.total;

                        // Find sweet spot across all qtys using smart strategy
                        const smartResults = results.map(r => ({ qty: r.qty, ...r.smart }));
                        const bestQty = smartResults.reduce((a, b) => a.perUnit < b.perUnit ? a : b);

                        return (
                          <div>
                            {/* Strategy comparison at base qty */}
                            <div style={{ display:"flex",gap:12,flexWrap:"wrap",marginBottom:16 }}>
                              {/* Cheapest per part */}
                              <div style={{ background:"#1a1d26",borderRadius:8,padding:"12px 16px",minWidth:200,flex:1 }}>
                                <div style={{ fontSize:10,color:"#f59e0b",fontWeight:700,letterSpacing:"0.06em",marginBottom:4 }}>
                                  CHEAPEST PER PART
                                </div>
                                <div style={{ fontSize:22,fontWeight:800,fontFamily:"'Space Grotesk',sans-serif",color:"#e2e8f0" }}>
                                  ${fmtPrice(cheapBase.perUnit)}<span style={{ fontSize:12,color:"#64748b",fontWeight:400 }}> / unit</span>
                                </div>
                                <div style={{ fontSize:11,color:"#64748b",marginTop:4 }}>
                                  Parts: {"$"}{cheapBase.partsCost.toFixed(2)}
                                </div>
                                <div style={{ fontSize:11,color:"#64748b" }}>
                                  Shipping: {"$"}{cheapBase.shipping.toFixed(2)} ({cheapBase.suppliers.length} vendor{cheapBase.suppliers.length!==1?"s":""})
                                </div>
                                {cheapBase.tariffTotal > 0 && (
                                  <div style={{ fontSize:11,color:"#ef4444" }}>
                                    Tariffs: {"$"}{cheapBase.tariffTotal.toFixed(2)}
                                  </div>
                                )}
                                {/* Per-vendor shipping */}
                                <div style={{ fontSize:10,color:"#475569",marginTop:6 }}>
                                  {cheapBase.shippingBreakdown.map(sb => (
                                    <div key={sb.supplierId}>{sb.name}: {"$"}{sb.cost.toFixed(2)} shipping</div>
                                  ))}
                                </div>
                                {/* Tariff detail — by part origin country */}
                                {cheapBase.tariffBreakdown?.length > 0 && (
                                  <div style={{ fontSize:10,color:"#b45454",marginTop:4 }}>
                                    {cheapBase.tariffBreakdown.map((t,i) => (
                                      <div key={i}>{t.mpn} (made in {t.origin}): {t.rate}% on {"$"}{t.goodsValue.toFixed(2)} = {"$"}{t.cost.toFixed(2)}</div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Smart consolidated */}
                              <div style={{ background:smartSavings>0?"#0d2318":"#1a1d26",
                                border:smartSavings>0?"1px solid #34d399":"1px solid #2d3248",
                                borderRadius:8,padding:"12px 16px",minWidth:200,flex:1 }}>
                                <div style={{ fontSize:10,color:"#34d399",fontWeight:700,letterSpacing:"0.06em",marginBottom:4 }}>
                                  SMART CONSOLIDATED {smartSavings > 0 ? "— RECOMMENDED" : ""}
                                </div>
                                <div style={{ fontSize:22,fontWeight:800,fontFamily:"'Space Grotesk',sans-serif",color:"#34d399" }}>
                                  ${fmtPrice(smartBase.perUnit)}<span style={{ fontSize:12,color:"#64748b",fontWeight:400 }}> / unit</span>
                                </div>
                                <div style={{ fontSize:11,color:"#64748b",marginTop:4 }}>
                                  Parts: {"$"}{smartBase.partsCost.toFixed(2)}
                                </div>
                                <div style={{ fontSize:11,color:"#64748b" }}>
                                  Shipping: {"$"}{smartBase.shipping.toFixed(2)} ({smartBase.suppliers.length} vendor{smartBase.suppliers.length!==1?"s":""})
                                </div>
                                {smartBase.tariffTotal > 0 && (
                                  <div style={{ fontSize:11,color:"#ef4444" }}>
                                    Tariffs: {"$"}{smartBase.tariffTotal.toFixed(2)}
                                  </div>
                                )}
                                {/* Per-vendor shipping */}
                                <div style={{ fontSize:10,color:"#475569",marginTop:6 }}>
                                  {smartBase.shippingBreakdown.map(sb => (
                                    <div key={sb.supplierId}>{sb.name}: {"$"}{sb.cost.toFixed(2)} shipping</div>
                                  ))}
                                </div>
                                {/* Tariff detail — by part origin country */}
                                {smartBase.tariffBreakdown?.length > 0 && (
                                  <div style={{ fontSize:10,color:"#b45454",marginTop:4 }}>
                                    {smartBase.tariffBreakdown.map((t,i) => (
                                      <div key={i}>{t.mpn} (made in {t.origin}): {t.rate}% on {"$"}{t.goodsValue.toFixed(2)} = {"$"}{t.cost.toFixed(2)}</div>
                                    ))}
                                  </div>
                                )}
                                {smartSavings > 0 && (
                                  <div style={{ fontSize:12,color:"#34d399",fontWeight:700,marginTop:6 }}>
                                    Saves {"$"}{smartSavings.toFixed(2)} total vs cheapest-per-part
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Qty comparison table using smart strategy */}
                            <div style={{ fontSize:10,color:"#6366f1",fontWeight:700,letterSpacing:"0.06em",marginBottom:6,fontFamily:"'Space Grotesk',sans-serif" }}>
                              QUANTITY COMPARISON (Smart Consolidated)
                            </div>
                            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12,maxWidth:600 }}>
                              <thead>
                                <tr style={{ borderBottom:"1px solid #1e2130" }}>
                                  {["Units","Parts","Shipping","Tariffs","Total","Per Unit","Vendors","vs Base"].map((h,i)=>(
                                    <th key={i} style={{ padding:"5px 10px",textAlign:i>0?"right":"left",
                                      fontSize:10,color:"#475569",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {results.map((r) => {
                                  const s = r.smart;
                                  const diff = smartBase.perUnit - s.perUnit;
                                  const isBase = r.qty === baseQty;
                                  const isBest = r.qty === bestQty.qty && r.qty !== baseQty;
                                  return (
                                    <tr key={r.qty} style={{
                                      borderBottom:"1px solid #1a1d26",
                                      background: isBest ? "#0d2318" : isBase ? "#1a1d26" : "transparent"
                                    }}>
                                      <td style={{ padding:"5px 10px",fontWeight:isBase||isBest?700:400,
                                        color:isBest?"#34d399":isBase?"#f1f5f9":"#94a3b8" }}>
                                        {r.qty}{isBest?" ★":""}{isBase?" (base)":""}
                                      </td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",color:"#94a3b8" }}>{"$"}{s.partsCost.toFixed(2)}</td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",color:"#94a3b8" }}>{"$"}{s.shipping.toFixed(2)}</td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",color:s.tariffTotal>0?"#ef4444":"#475569" }}>
                                        {s.tariffTotal > 0 ? `$${s.tariffTotal.toFixed(2)}` : "—"}
                                      </td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",color:"#e2e8f0",fontWeight:600 }}>{"$"}{s.total.toFixed(2)}</td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",fontFamily:"'Space Grotesk',sans-serif",
                                        fontWeight:700,color:isBest?"#34d399":"#e2e8f0" }}>${fmtPrice(s.perUnit)}</td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",color:"#94a3b8",fontSize:11 }}>
                                        {s.suppliers.length}
                                      </td>
                                      <td style={{ padding:"5px 10px",textAlign:"right",
                                        color:diff>0?"#34d399":diff<0?"#f87171":"#475569",fontWeight:diff!==0?600:400 }}>
                                        {isBase ? "—" : diff > 0 ? `-$${fmtPrice(diff)}/ea` : diff < 0 ? `+$${fmtPrice(Math.abs(diff))}/ea` : "same"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                </div>
              );
            })}
          </div>
        )}

        {/* ══════════════════════════════════════
            ALERTS
        ══════════════════════════════════════ */}
        {activeView === "alerts" && (
          <div style={{ maxWidth:860 }}>
            <h2 style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:21,fontWeight:800,marginBottom:6 }}>Low Stock Alerts</h2>
            <p style={{ color:"#64748b",fontSize:13,marginBottom:22 }}>Parts at or below reorder threshold.</p>
            {lowStockParts.length===0 ? (
              <div className="card" style={{ textAlign:"center",padding:60 }}>
                <div style={{ fontSize:40,marginBottom:12 }}>✅</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:15,color:"#34d399" }}>All parts above reorder thresholds</div>
              </div>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {lowStockParts.map((part) => {
                  const projList = products.filter((p)=>part.projectId === p.id);
                  const sup = supplierById(part.preferredSupplier);
                  return (
                    <div key={part.id} className="card" style={{ borderLeft:"3px solid #ef4444",display:"flex",alignItems:"center",gap:16,padding:"14px 18px",flexWrap:"wrap" }}>
                      <span className="alert-dot" />
                      <div style={{ flex:1,minWidth:200 }}>
                        <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:4,flexWrap:"wrap" }}>
                          <span style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,color:"#f8d377" }}>{part.reference}</span>
                          <span style={{ color:"#94a3b8",fontSize:12 }}>{part.value}</span>
                          <span style={{ color:"#7dd3fc",fontSize:12 }}>{part.mpn}</span>
                          {projList.map(pr=><span key={pr.id} className="badge" style={{ background:pr.color+"22",color:pr.color }}>{pr.name}</span>)}
                        </div>
                        <div style={{ fontSize:12,color:"#64748b" }}>
                          Stock: <span style={{ color:"#f87171",fontWeight:700 }}>{part.stockQty}</span>
                          &nbsp;· Reorder at: <span style={{ color:"#94a3b8" }}>{part.reorderQty}</span>
                          &nbsp;· Via: <span style={{ color:sup.color,fontWeight:700 }}>{sup.name}</span>
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                        <input type="checkbox" style={{ width:16,height:16,cursor:"pointer",accentColor:"#f8d377" }}
                          checked={part.flaggedForOrder} onChange={()=>toggleFlag(part.id)} />
                        <span style={{ fontSize:11,color:"#64748b" }}>Flag for PO</span>
                        {part.mpn && (
                          <a href={sup.searchUrl(part.mpn)} target="_blank" rel="noopener noreferrer">
                            <button className="btn-ghost" style={{ fontSize:11 }}>Order on {sup.name} →</button>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop:8,display:"flex",gap:10 }}>
                  <button className="btn-primary"
                    onClick={()=>{ setParts((prev)=>prev.map((p)=>{ const s=parseInt(p.stockQty),r=parseInt(p.reorderQty); if(!isNaN(s)&&!isNaN(r)&&s<=r) return {...p,flaggedForOrder:true}; return p; })); setActiveView("purchasing"); }}>
                    🚩 Flag All & Go to Purchasing
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            API KEYS / SETTINGS
        ══════════════════════════════════════ */}
        {activeView === "settings" && (
          <div style={{ maxWidth:760 }}>
            <h2 style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:21,fontWeight:800,marginBottom:6 }}>Settings</h2>
            <p style={{ color:"#64748b",fontSize:13,marginBottom:24 }}>
              Keys are stored in the shared team database — one set for everyone.
              They are not end-to-end encrypted; do not store keys here if that is a concern.
            </p>

            {/* ── Nexar / Octopart — PRIMARY */}
            <div className="card" style={{ marginBottom:16,borderTop:"3px solid #6366f1" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
                <div>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:15,color:"#a5b4fc" }}>
                    Nexar / Octopart ⭐ Recommended
                  </div>
                  <div style={{ fontSize:12,color:"#64748b",marginTop:4 }}>
                    One API covers Mouser, Digi-Key, Arrow, LCSC, Allied + 900 more distributors simultaneously.
                    Free: 1,000 matched parts/month.
                  </div>
                  <a href="https://nexar.com" target="_blank" rel="noopener noreferrer"
                    style={{ fontSize:11,color:"#6366f1",textDecoration:"none" }}>Get keys at nexar.com →</a>
                </div>
                {nexarToken && <span className="badge" style={{ background:"#34d39922",color:"#34d399" }}>Connected</span>}
              </div>
              <div className="key-input-row">
                <div>
                  <div className="key-label">Client ID</div>
                  <div className="key-hint">From your Nexar app</div>
                </div>
                <input type="password" placeholder="nexar-client-id" value={apiKeys.nexar_client_id}
                  onChange={(e)=>setApiKeys((k)=>({...k,nexar_client_id:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
              <div className="key-input-row">
                <div>
                  <div className="key-label">Client Secret</div>
                  <div className="key-hint">From your Nexar app</div>
                </div>
                <input type="password" placeholder="nexar-client-secret" value={apiKeys.nexar_client_secret}
                  onChange={(e)=>setApiKeys((k)=>({...k,nexar_client_secret:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
            </div>

            {/* ── Mouser Direct */}
            <div className="card" style={{ marginBottom:16,borderTop:`3px solid #e8500a` }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:14,color:"#e8500a",marginBottom:4 }}>
                Mouser Direct API <span style={{ fontSize:11,fontWeight:400,color:"#64748b" }}>(Optional supplement)</span>
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                Provides deeper Mouser-specific detail. Free at
                <a href="https://www.mouser.com/api-hub/" target="_blank" rel="noopener noreferrer"
                  style={{ color:"#e8500a",marginLeft:4 }}>mouser.com/api-hub →</a>
              </div>
              <div className="key-input-row">
                <div className="key-label">Search API Key</div>
                <input type="password" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={apiKeys.mouser_api_key}
                  onChange={(e)=>setApiKeys((k)=>({...k,mouser_api_key:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
            </div>

            {/* ── DigiKey Direct */}
            <div className="card" style={{ marginBottom:16,borderTop:`3px solid #cc0000` }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:14,color:"#cc0000",marginBottom:4 }}>
                Digi-Key Direct API v4 <span style={{ fontSize:11,fontWeight:400,color:"#64748b" }}>(Optional supplement)</span>
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                OAuth2 client credentials. Register at
                <a href="https://developer.digikey.com" target="_blank" rel="noopener noreferrer"
                  style={{ color:"#cc0000",marginLeft:4 }}>developer.digikey.com →</a>
              </div>
              <div className="key-input-row">
                <div className="key-label">Client ID</div>
                <input type="password" placeholder="DigiKey client ID" value={apiKeys.digikey_client_id}
                  onChange={(e)=>setApiKeys((k)=>({...k,digikey_client_id:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
              <div className="key-input-row">
                <div className="key-label">Client Secret</div>
                <input type="password" placeholder="DigiKey client secret" value={apiKeys.digikey_client_secret}
                  onChange={(e)=>setApiKeys((k)=>({...k,digikey_client_secret:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
            </div>

            {/* ── Arrow Direct */}
            <div className="card" style={{ marginBottom:16,borderTop:`3px solid #005eb8` }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:14,color:"#005eb8",marginBottom:4 }}>
                Arrow Direct API v4 <span style={{ fontSize:11,fontWeight:400,color:"#64748b" }}>(Optional supplement)</span>
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                Requires login + API key. Free at
                <a href="https://developers.arrow.com" target="_blank" rel="noopener noreferrer"
                  style={{ color:"#005eb8",marginLeft:4 }}>developers.arrow.com →</a>
              </div>
              <div className="key-input-row">
                <div className="key-label">Login Email</div>
                <input type="text" placeholder="your@email.com" value={apiKeys.arrow_login}
                  onChange={(e)=>setApiKeys((k)=>({...k,arrow_login:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
              <div className="key-input-row">
                <div className="key-label">API Key</div>
                <input type="password" placeholder="Arrow API key" value={apiKeys.arrow_api_key}
                  onChange={(e)=>setApiKeys((k)=>({...k,arrow_api_key:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
            </div>

            {/* ── Shipping Costs (used by BOM Simulator) */}
            <div className="card" style={{ marginBottom:16,borderTop:"3px solid #8b5cf6" }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:15,color:"#8b5cf6",marginBottom:4 }}>
                Shipping Costs
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                Used by the Production Run Simulator to compare consolidation strategies. Adjust to match your actual shipping rates.
              </div>
              <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                {SUPPLIERS.map((s) => (
                  <div key={s.id} style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:12,color:s.color,fontWeight:700,minWidth:70 }}>{s.name}</span>
                    <span style={{ fontSize:11,color:"#475569" }}>$</span>
                    <input type="number" step="0.01" min="0" value={s.shipping}
                      onChange={(e) => { const v = parseFloat(e.target.value)||0; SUPPLIERS.find(x=>x.id===s.id).shipping = v; }}
                      style={{ width:60,padding:"4px 6px",borderRadius:4,fontSize:12 }} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11,color:"#475569",marginTop:8 }}>
                Default for unlisted distributors: ${DEFAULT_SHIPPING.toFixed(2)}
              </div>
            </div>

            {/* ── Import Tariff Rates */}
            <div className="card" style={{ marginBottom:16,borderTop:"3px solid #ef4444" }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:15,color:"#ef4444",marginBottom:4 }}>
                Import Tariff Rates
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                Applied in the Production Run Simulator when parts come from non-US distributors. Rates are % of goods value.
              </div>
              <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                {(() => {
                  let tariffs;
                  try { tariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { tariffs = { ...DEFAULT_TARIFFS }; }
                  const countries = Object.keys(tariffs).sort();
                  return countries.map(cc => (
                    <div key={cc} style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <span style={{ fontSize:12,color:"#e2e8f0",fontWeight:700,minWidth:28 }}>{cc}</span>
                      <input type="number" step="1" min="0" max="500"
                        value={tariffs[cc]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          const updated = { ...tariffs, [cc]: v };
                          setApiKeys(k => ({ ...k, tariffs_json: JSON.stringify(updated) }));
                        }}
                        style={{ width:52,padding:"4px 6px",borderRadius:4,fontSize:12,textAlign:"right" }} />
                      <span style={{ fontSize:11,color:"#475569" }}>%</span>
                    </div>
                  ));
                })()}
              </div>
              <div style={{ marginTop:10,display:"flex",gap:8,alignItems:"center" }}>
                <button className="btn-ghost" style={{ fontSize:11 }}
                  onClick={() => {
                    const cc = prompt("Add country code (e.g. BR, SG, IL):");
                    if (!cc || cc.length < 2) return;
                    const rate = parseFloat(prompt(`Tariff % for ${cc.toUpperCase()}:`) || "0");
                    let tariffs;
                    try { tariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { tariffs = { ...DEFAULT_TARIFFS }; }
                    tariffs[cc.toUpperCase()] = rate;
                    setApiKeys(k => ({ ...k, tariffs_json: JSON.stringify(tariffs) }));
                  }}>
                  + Add Country
                </button>
                <span style={{ fontSize:10,color:"#475569" }}>Rates saved with your API keys</span>
              </div>
            </div>

            {/* ── Notifications & Email */}
            <div className="card" style={{ marginBottom:16,borderTop:"3px solid #f59e0b" }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:15,color:"#f59e0b",marginBottom:4 }}>
                Email Notifications & PO Drafts
              </div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:12 }}>
                Get daily low-stock alerts and auto-draft purchase order emails to your distributors.
              </div>
              <div className="key-input-row">
                <div>
                  <div className="key-label">Your Email</div>
                  <div className="key-hint">Receives daily low-stock alerts</div>
                </div>
                <input type="email" placeholder="you@company.com" value={apiKeys.notify_email}
                  onChange={(e)=>setApiKeys((k)=>({...k,notify_email:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
              </div>
              <div style={{ marginTop:12,fontSize:11,color:"#64748b",fontWeight:700,letterSpacing:"0.06em",marginBottom:8 }}>DISTRIBUTOR ORDER EMAILS</div>
              {SUPPLIERS.map((s) => {
                let emails = {};
                try { emails = JSON.parse(apiKeys.supplier_emails || "{}"); } catch {}
                return (
                  <div key={s.id} className="key-input-row" style={{ paddingTop:6,paddingBottom:6 }}>
                    <div className="key-label" style={{ color:s.color,minWidth:80 }}>{s.name}</div>
                    <input type="email" placeholder={`orders@${s.id}.com`}
                      value={emails[s.id] || ""}
                      onChange={(e) => {
                        const updated = { ...emails, [s.id]: e.target.value };
                        setApiKeys((k) => ({ ...k, supplier_emails: JSON.stringify(updated) }));
                      }}
                      style={{ padding:"6px 10px",borderRadius:5,width:"100%",fontSize:12 }} />
                  </div>
                );
              })}
              {apiKeys.notify_email && lowStockParts.length > 0 && (
                <div style={{ marginTop:14 }}>
                  <button className="btn-ghost" onClick={() => {
                    const body = buildLowStockEmailBody(lowStockParts);
                    if (body) window.location.href = `mailto:${apiKeys.notify_email}?subject=${encodeURIComponent("Low Stock Alert — Jackson Audio BOM")}&body=${encodeURIComponent(body)}`;
                  }}>
                    Preview Low-Stock Alert Email
                  </button>
                  <span style={{ fontSize:11,color:"#64748b",marginLeft:8 }}>{lowStockParts.length} parts below reorder level</span>
                </div>
              )}
            </div>

            {/* Connect + save button */}
            <div style={{ display:"flex",gap:12,alignItems:"center",marginTop:8 }}>
              <button className="btn-primary" onClick={async () => {
                // Save keys to DB first so whole team gets them, then authenticate
                try { await saveAllApiKeys(apiKeys, user.id); } catch(e) { console.warn("Key save failed:", e); }
                authenticateAPIs();
              }}>
                {tokenStatus==="loading" ? <><span className="spinner" /> Connecting…</> : "⚡ Save & Connect APIs"}
              </button>
              <button className="btn-ghost" onClick={()=>{ setApiKeys(DEFAULT_KEYS); setNexarToken(null); setDkToken(null); setTokenStatus("idle"); setTokenMsg(""); }}>
                Clear All Keys
              </button>
            </div>

            {/* Status message */}
            {tokenMsg && (
              <div style={{ marginTop:14,padding:"11px 16px",
                background: tokenStatus==="ok" ? "#0d2318" : "#2d1515",
                border: `1px solid ${tokenStatus==="ok"?"#10b981":"#ef4444"}`,
                borderRadius:8, fontSize:12,
                color: tokenStatus==="ok" ? "#34d399" : "#f87171" }}>
                {tokenMsg}
              </div>
            )}

            {/* Key acquisition guide */}
            <div className="card" style={{ marginTop:24 }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:12,color:"#64748b",letterSpacing:"0.08em",marginBottom:14 }}>HOW TO GET YOUR API KEYS</div>
              {[
                { name:"Nexar (covers everything)", steps:["Go to nexar.com and create a free account","Click 'Create App' in the API portal","Copy your Client ID and Client Secret here","Free tier: 1,000 matched parts/month"], color:"#6366f1" },
                { name:"Mouser", steps:["Go to mouser.com and log into your account","Navigate to My Account → API","Select 'Search API' and generate a key","Copy the key here"], color:"#e8500a" },
                { name:"Digi-Key", steps:["Go to developer.digikey.com","Create an Organization and App","Select 'Product Information' API","Copy Client ID and Secret here"], color:"#cc0000" },
                { name:"Arrow", steps:["Email api@arrow.com or contact your sales rep","They will issue you a login + API key","Enter both here"], color:"#005eb8" },
              ].map((src)=>(
                <div key={src.name} style={{ marginBottom:16,paddingLeft:12,borderLeft:`2px solid ${src.color}` }}>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:13,color:src.color,marginBottom:6 }}>{src.name}</div>
                  <ol style={{ paddingLeft:16 }}>
                    {src.steps.map((step,i)=>(
                      <li key={i} style={{ fontSize:12,color:"#64748b",marginBottom:3 }}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer style={{ borderTop:"1px solid #1e2130",padding:"10px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"#334155" }}>
        <span style={{ fontFamily:"'Space Grotesk',sans-serif" }}>Jackson Audio BOM Manager v4.0</span>
        <span>Thursday, March 12, 2026</span>
      </footer>
    </div>
  );
}
