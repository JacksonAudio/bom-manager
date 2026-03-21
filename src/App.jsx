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
import QRLabelModal from "./components/QRLabelModal.jsx";
import ScannerView from "./components/ScannerView.jsx";
import Scoreboard from "./components/Scoreboard.jsx";
import BuildView from "./components/BuildView.jsx";
import InvoiceView from "./components/InvoiceView.jsx";
import PriceChart from "./components/PriceChart.jsx";
import {
  onAuthChange, signOut,
  fetchProducts, createProduct, deleteProduct,
  fetchParts,   createPart,   updatePart as dbUpdatePart,
  deletePart as dbDeletePart, deletePartsMany, upsertParts,
  fetchApiKeys, saveAllApiKeys,
  subscribeToProducts, subscribeToParts,
  fetchTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember,
  fetchBuildOrders, createBuildOrder, updateBuildOrder, deleteBuildOrder,
  fetchBuildAssignments, createBuildAssignment, updateBuildAssignment,
  subscribeToTeamMembers, subscribeToBuildOrders, subscribeToBuildAssignments,
  recordPrice, fetchPriceHistory, fetchAllPriceHistory,
  saveBomSnapshot, fetchBomSnapshots,
  fetchPOHistory, createPORecord, updatePORecord,
} from "./lib/db.js";
import { supabase } from "./lib/supabase.js";

// ─────────────────────────────────────────────
// API CONFIGURATION
// All keys are entered by user in Settings tab
// Never hardcode API keys — store in component state only
// ─────────────────────────────────────────────
const DEFAULT_KEYS = {
  nexar_client_id:     "",   // nexar.com — covers Mouser, DigiKey, Arrow, LCSC, Allied + 900 more
  nexar_client_secret: "",   // nexar.com
  mouser_api_key:      "",   // mouser.com/api-hub (optional — Nexar already covers Mouser)
  mouser_order_api_key:"",   // mouser.com/api-hub — separate key for Cart + Order API
  digikey_client_id:   "",   // developer.digikey.com (optional — Nexar already covers DigiKey)
  digikey_client_secret: "", // developer.digikey.com
  arrow_api_key:       "",   // developers.arrow.com (optional — Nexar already covers Arrow)
  arrow_login:         "",   // Arrow also requires a login email
  notify_email:        "",   // Email to receive low-stock alerts
  supplier_emails:     "",   // JSON: { "mouser": "orders@mouser.com", ... }
  tariffs_json:        "",   // JSON: { "CN": 145, "TW": 32, ... } — % tariff by country code
  shipping_json:       "",   // JSON: { "mouser": 7.99, "digikey": 6.99, ... } — per-supplier shipping
  shopify_stores_json: "",   // JSON array: [{ name, domain, token }]
  company_name:    "Jackson Audio",
  company_address: "",   // Your company address for POs
  distributor_names: "",  // JSON: { "raw_key": "Display Name", ... } — rename distributors
  supplier_order_modes: "", // JSON: { "mouser": "api", "digikey": "api", "arrow": "rep", ... } — api|rep|manual
  anthropic_api_key: "",  // anthropic.com — Claude AI for invoice parsing
  twilio_account_sid: "", // twilio.com — SMS notifications to builders
  twilio_auth_token: "",  // twilio.com
  twilio_phone_number: "", // twilio.com — your Twilio phone number (e.g. +1234567890)
  labor_rate_hourly: "25", // $/hr labor rate for profit analysis
  ad_spend_pct: "35",     // % of sales price spent on ads (Facebook, Google, etc.)
  preferred_distributors: '["mouser"]', // JSON array of preferred supplier IDs — get priority in pricing
  shipping_cost_per_unit: "8", // avg shipping cost per unit sold
  fb_ja_access_token: "",    // Facebook — Jackson Audio access token
  fb_ja_ad_account_id: "",   // Facebook — Jackson Audio ad account (act_XXX)
  fb_ft_access_token: "",    // Facebook — Fulltone USA access token
  fb_ft_ad_account_id: "",   // Facebook — Fulltone USA ad account (act_XXX)
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
  "GB": 10,    // United Kingdom (ISO)
  "JP": 24,    // Japan
  "KR": 25,    // South Korea
  "IN": 26,    // India
  "CA": 25,    // Canada
  "MX": 25,    // Mexico
  "AU": 10,    // Australia
  "VN": 46,    // Vietnam
  "TH": 36,    // Thailand
  "HK": 0,     // Hong Kong (duty-free)
  "SG": 0,     // Singapore (duty-free)
  "MY": 24,    // Malaysia
  "PH": 17,    // Philippines
  "IL": 17,    // Israel
};

// ─────────────────────────────────────────────
// EXCHANGE RATES — convert foreign currency prices to USD
// ─────────────────────────────────────────────
// Fetch latest rates from Frankfurter (free, no API key, ECB data)
// Returns { GBP: 0.79, EUR: 0.92, ... } — rates relative to USD
let _cachedRates = null;
let _ratesFetchedAt = 0;
async function fetchExchangeRates() {
  // Cache for 4 hours
  if (_cachedRates && Date.now() - _ratesFetchedAt < 4 * 60 * 60 * 1000) return _cachedRates;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD");
    if (!res.ok) throw new Error(`Exchange rate fetch failed: ${res.status}`);
    const data = await res.json();
    _cachedRates = data.rates; // { GBP: 0.79, EUR: 0.92, CNY: 7.24, ... }
    _ratesFetchedAt = Date.now();
    console.log("[FX] Exchange rates loaded:", Object.keys(_cachedRates).length, "currencies");
    return _cachedRates;
  } catch (e) {
    console.warn("[FX] Failed to fetch exchange rates:", e.message);
    // Fallback rates (approximate) so the app doesn't break
    return { GBP: 0.79, EUR: 0.92, CNY: 7.24, JPY: 154, KRW: 1380, CAD: 1.37, AUD: 1.55, SGD: 1.35, HKD: 7.82, TWD: 32, INR: 83, SEK: 10.5, CHF: 0.88 };
  }
}

// Convert a price from source currency to USD
function toUSD(price, currency, rates) {
  if (!currency || currency === "USD" || !rates) return price;
  const rate = rates[currency];
  if (!rate) return price; // Unknown currency, assume USD
  return price / rate;
}

// ─────────────────────────────────────────────
// SUPPLIER DISPLAY CONFIG
// ─────────────────────────────────────────────
const SUPPLIERS = [
  { id: "mouser",   name: "Mouser Electronics",   color: "#e8500a", bg: "rgba(232,80,10,0.06)", logo: "M",  shipping: 7.99,  address: "1000 N. Main Street\nMansfield, TX 76063\nUSA", searchUrl: (pn) => `https://www.mouser.com/Search/Refine?Keyword=${encodeURIComponent(pn)}` },
  { id: "digikey",  name: "Digi-Key Electronics", color: "#cc0000", bg: "rgba(204,0,0,0.06)", logo: "DK", shipping: 6.99,  address: "701 Brooks Avenue South\nThief River Falls, MN 56701\nUSA", searchUrl: (pn) => `https://www.digikey.com/en/products/result?keywords=${encodeURIComponent(pn)}` },
  { id: "arrow",    name: "Arrow Electronics",    color: "#005eb8", bg: "rgba(0,94,184,0.06)", logo: "A",  shipping: 0,     address: "9201 E. Dry Creek Road\nCentennial, CO 80112\nUSA", searchUrl: (pn) => `https://www.arrow.com/en/products/search?q=${encodeURIComponent(pn)}` },
  { id: "lcsc",     name: "LCSC Electronics",     color: "#0a8f4c", bg: "rgba(10,143,76,0.06)", logo: "LC", shipping: 20.00, address: "Shenzhen, Guangdong\nChina", searchUrl: (pn) => `https://www.lcsc.com/search?q=${encodeURIComponent(pn)}` },
  { id: "allied",   name: "Allied Electronics",   color: "#7c3aed", bg: "rgba(124,58,237,0.06)", logo: "AL", shipping: 9.99,  address: "7151 Jack Newell Blvd S\nFort Worth, TX 76118\nUSA", searchUrl: (pn) => `https://www.alliedelec.com/search/?q=${encodeURIComponent(pn)}` },
  { id: "amazon",   name: "Amazon",   color: "#f90",    bg: "rgba(255,153,0,0.06)", logo: "Az", shipping: 0,     address: "", searchUrl: (pn) => `https://www.amazon.com/s?k=${encodeURIComponent(pn)}` },
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
const fmtDollar = (v) => parseFloat(v).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });

// Get country code for a supplier ID (from DIST_COUNTRY or SUPPLIERS)
const getSupplierCountry = (supplierId) => DIST_COUNTRY[supplierId] || "";

// Get tariff % for a country code given current tariff settings
const COUNTRY_ALIAS = { "GB":"UK", "UK":"UK" }; // normalize country codes
const getTariffRate = (countryCode, tariffs) => {
  if (!countryCode || countryCode === "US") return 0;
  const code = COUNTRY_ALIAS[countryCode.toUpperCase()] || countryCode.toUpperCase();
  return tariffs[code] || 0;
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
  return `{ supSearchMpn(q: "${safe}", limit: 3) { hits results { part { mpn manufacturer { name } sellers { country company { name } offers { clickUrl inventoryLevel moq prices { quantity price currency } } } } } } }`;
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
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[Nexar] Error response:", errText.slice(0, 500));
    throw new Error(`Nexar API error: ${res.status}`);
  }
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

        // Capture the currency from the first price entry
        const currency = (prices[0]?.currency || "USD").toUpperCase();

        if (!pricing[key] || unitPrice < pricing[key].unitPrice) {
          pricing[key] = {
            supplierId: key,
            displayName: distName,
            country: sellerCountry,
            currency,
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
    mouserPartNumber: part.MouserPartNumber || "",
  };
  // Capture extended part data from Mouser Search API
  if (part.CountryOfOrigin) result.countryOfOrigin = part.CountryOfOrigin.toUpperCase();
  if (part.ROHSStatus) result.rohsStatus = part.ROHSStatus;
  if (part.LifecycleStatus) result.lifecycleStatus = part.LifecycleStatus;
  if (part.DataSheetUrl) result.datasheetUrl = part.DataSheetUrl;
  if (part.Description) result.partDescription = part.Description;
  if (part.Manufacturer) result.manufacturer = part.Manufacturer;
  if (part.Category) result.category = part.Category;
  if (part.LeadTime) result.leadTime = part.LeadTime;
  if (part.SuggestedReplacement) result.suggestedReplacement = part.SuggestedReplacement;
  if (part.ImagePath) result.imagePath = part.ImagePath;
  if (part.ProductCompliance) result.compliance = part.ProductCompliance;
  return result;
}

// ─────────────────────────────────────────────
// MOUSER CART + ORDER API
// Create cart, add items, preview order, submit order
// ─────────────────────────────────────────────
const MOUSER_CART_API = "https://api.mouser.com/api/v2/cart";
const MOUSER_ORDER_API = "https://api.mouser.com/api/v1/order";

async function mouserCreateCart(orderApiKey, items) {
  // items: [{ mouserPartNumber, quantity }]
  const res = await fetch(`${MOUSER_CART_API}/items/insert?apiKey=${orderApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      CartKey: "",  // empty = create new cart
      CartItems: items.map(i => ({
        MouserPartNumber: i.mouserPartNumber,
        Quantity: i.quantity,
      })),
    }),
  });
  if (!res.ok) throw new Error(`Mouser Cart API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.Errors?.length) throw new Error(data.Errors.map(e => e.Message).join(", "));
  return {
    cartKey: data.CartKey,
    cartItems: data.CartItems || [],
    cartUrl: `https://www.mouser.com/Cart/?cartKey=${data.CartKey}`,
  };
}

async function mouserGetOrderOptions(orderApiKey, cartKey) {
  const res = await fetch(`${MOUSER_ORDER_API}/options/query?apiKey=${orderApiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ CartKey: cartKey }),
  });
  if (!res.ok) throw new Error(`Mouser Order Options ${res.status}`);
  return await res.json();
}

// ─────────────────────────────────────────────
// DIGIKEY CART URL BUILDER
// Builds a URL that opens DigiKey with parts pre-loaded into shopping cart
// ─────────────────────────────────────────────
function buildDigiKeyCartUrl(items) {
  // items: [{ partNumber, quantity }]
  // DigiKey URL format: https://www.digikey.com/ordering/shoppingcart?newproducts=PART1|QTY1,PART2|QTY2
  const parts = items.map(i => `${encodeURIComponent(i.partNumber)}|${i.quantity}`).join(",");
  return `https://www.digikey.com/ordering/shoppingcart?newproducts=${parts}`;
}

// ─────────────────────────────────────────────
// SUPPLIER QUICK-ORDER URLS
// Build URLs that open supplier websites with parts pre-loaded or for quick search
// ─────────────────────────────────────────────
const SUPPLIER_WEBSITE_URLS = {
  mouser:  "https://www.mouser.com",
  digikey: "https://www.digikey.com",
  arrow:   "https://www.arrow.com",
  lcsc:    "https://www.lcsc.com",
  allied:  "https://www.alliedelec.com",
  amazon:  "https://www.amazon.com",
};

function getSupplierOrderMode(supplierId, orderModesJson) {
  let modes = {};
  try { modes = JSON.parse(orderModesJson || "{}"); } catch {}
  return modes[supplierId] || "manual";
}

// Get full reel quantity — uses part's reel_qty field, falls back to pricing data
function getReelQty(part) {
  if (part.reelQty && parseInt(part.reelQty) > 0) return parseInt(part.reelQty);
  return null;
}

const ORDER_MODE_CONFIG = {
  api:    { label: "API",    color: "#34c759", bg: "rgba(52,199,89,0.12)", description: "Direct API ordering" },
  rep:    { label: "Rep",    color: "#0071e3", bg: "rgba(0,113,227,0.10)", description: "Email PO to sales rep" },
  manual: { label: "Manual", color: "#86868b", bg: "rgba(142,142,147,0.10)", description: "Order on website" },
};

// ─────────────────────────────────────────────
// MOUSER KEYWORD SEARCH (for finding alternatives)
// Uses Search API key
// ─────────────────────────────────────────────
async function mouserKeywordSearch(keyword, apiKey, records = 10) {
  const res = await fetch(
    `https://api.mouser.com/api/v1/search/keyword?apiKey=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        SearchByKeywordRequest: {
          keyword,
          records,
          startingRecord: 0,
          searchOptions: "",
          searchWithYourSignUpLanguage: "",
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Mouser Keyword Search ${res.status}`);
  const data = await res.json();
  return data?.SearchResults?.Parts || [];
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

  // Convert non-USD prices to USD using live exchange rates
  const rates = await fetchExchangeRates();
  for (const [key, data] of Object.entries(pricing)) {
    if (!data || typeof data !== "object" || !data.currency || data.currency === "USD") continue;
    const origCurrency = data.currency;
    const rate = rates[origCurrency];
    if (!rate) continue;
    // Convert unitPrice and all price breaks to USD
    data.originalCurrency = origCurrency;
    data.originalUnitPrice = data.unitPrice;
    data.unitPrice = toUSD(data.unitPrice, origCurrency, rates);
    if (data.priceBreaks?.length) {
      data.priceBreaks = data.priceBreaks.map(pb => ({
        ...pb,
        originalPrice: pb.price,
        price: toUSD(pb.price, origCurrency, rates),
      }));
    }
    data.currency = "USD"; // now converted
    data.fxRate = rate; // store for display
    console.log(`[FX] ${data.displayName}: ${origCurrency} → USD (rate: ${rate})`);
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

function printPO(supplier, lines, poNumber, companyInfo) {
  const fmtN = (n) => n.toLocaleString("en-US");
  const fmtD = (v) => parseFloat(v).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
  const total = lines.reduce((s, p) => s + (parseFloat(p.unitCost)||0) * p.neededQty, 0);
  const today = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const coName = companyInfo?.name || "Jackson Audio";
  const coAddr = (companyInfo?.address || "").replace(/\n/g, "<br>");
  const supAddr = (supplier.address || "").replace(/\n/g, "<br>");
  const rows = lines.map((p) => `
    <tr>
      <td>${p.reference}</td><td><strong>${p.mpn||"—"}</strong></td>
      <td>${p.description||p.value||"—"}</td><td>${p.manufacturer||"—"}</td>
      <td style="text-align:center">${fmtN(p.neededQty)}</td>
      <td style="text-align:right">${p.unitCost?"$"+fmtPrice(p.unitCost):"—"}</td>
      <td style="text-align:right">${p.unitCost?"$"+fmtD(parseFloat(p.unitCost)*p.neededQty):"—"}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PO ${poNumber}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:40px;color:#1a1a1a}
  .header{display:flex;justify-content:space-between;margin-bottom:28px;border-bottom:3px solid #0071e3;padding-bottom:18px}
  .company{font-size:20px;font-weight:900}.po-num{font-size:18px;font-weight:800;color:${supplier.color};text-align:right}
  .addr-row{display:flex;gap:40px;margin-bottom:20px}
  .addr-box{flex:1;background:#f5f5f5;border-radius:6px;padding:14px 18px;font-size:11px;line-height:1.6;color:#444}
  .addr-box strong{display:block;font-size:13px;color:#1a1a1a;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  th{background:#1a1a1a;color:#fff;padding:7px 10px;text-align:left;font-size:10px;letter-spacing:1px;text-transform:uppercase}
  td{padding:7px 10px;border-bottom:1px solid #eee}tr:nth-child(even)td{background:#fafafa}
  .tot td{font-weight:800;border-top:2px solid #000}
  @media print{body{padding:20px}}</style></head><body>
  <div class="header"><div><div class="company">${coName.toUpperCase()}</div><div style="font-size:10px;color:#666;letter-spacing:2px;margin-top:2px">PURCHASE ORDER</div></div>
  <div class="po-num">PO-${poNumber}<br><span style="font-size:11px;font-weight:400;color:#666">${today}</span></div></div>
  <div class="addr-row">
    <div class="addr-box"><strong>Ship To</strong>${coAddr || "Address not configured"}</div>
    <div class="addr-box" style="border-left:4px solid ${supplier.color}"><strong style="color:${supplier.color}">${supplier.name}</strong>${supAddr || ""}</div>
  </div>
  <table><thead><tr><th>Reference</th><th>MPN</th><th>Description</th><th>Manufacturer</th>
  <th style="text-align:center">Qty</th><th style="text-align:right">Unit $</th><th style="text-align:right">Extended</th></tr></thead>
  <tbody>${rows}<tr class="tot"><td colspan="4">${lines.length} line items</td>
  <td style="text-align:center">${fmtN(lines.reduce((s,p)=>s+p.neededQty,0))}</td><td></td>
  <td style="text-align:right">${total>0?"$"+fmtD(total):"—"}</td></tr></tbody></table>
  <div style="margin-top:32px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:12px">
  Generated by ${coName} BOM Manager · ${new Date().toISOString()}</div>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
}

function buildPurchaseOrders(parts) {
  const orderParts = parts.filter((p) => {
    if (p.isInternal) return false; // internal parts have their own section
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

function buildPOEmailDraft(supplierName, lines, poNumber, companyInfo) {
  const coName = companyInfo?.name || "Jackson Audio";
  const coAddr = companyInfo?.address || "";
  const subject = `Purchase Order ${poNumber} — ${coName}`;
  const body = [
    `Hi ${supplierName} Team,`,
    ``,
    `Please quote / process the following order:`,
    ``,
    `PO #: ${poNumber}`,
    `Date: ${new Date().toLocaleDateString()}`,
    ...(coAddr ? [`Ship To:\n${coAddr}`, ``] : [``]),
    `Part Number | Qty | Description`,
    `-----------|-----|------------`,
    ...lines.map(l => `${l.mpn} | ${l.neededQty.toLocaleString()} | ${l.description || l.value || ""}`),
    ``,
    `Please confirm availability, lead time, and total cost.`,
    ``,
    `Thank you,`,
    coName,
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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { min-height: 100vh; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #f5f5f7; }
  ::-webkit-scrollbar-thumb { background: #d2d2d7; border-radius: 3px; }

  .nav-btn { background: none; border: none; border-right: 1px solid #e5e5ea;
    cursor: pointer; padding: 0; height: 36px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    font-size: 12px; font-weight: 500; color: #86868b; transition: all 0.15s;
    text-align: center; display: flex; align-items: center; justify-content: center; }
  .nav-btn:nth-child(7) { border-right: none; }
  .nav-btn:last-child { border-right: none; }
  .nav-btn:nth-child(n+8) { border-top: 1px solid #e5e5ea; }
  .nav-btn:hover { color: #1d1d1f; background: rgba(0,0,0,0.03); }
  .nav-btn.active { color: #0071e3; font-weight: 700; background: rgba(0,113,227,0.06); }

  .supplier-pill { display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 4px; border: none;
    font-size: 11px; font-weight: 800; cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    transition: opacity 0.15s; text-decoration: none; white-space: nowrap; }
  .supplier-pill:hover { opacity: 0.75; }

  input[type="text"], input[type="number"], input[type="password"], select, textarea {
    background: #fff; border: 1px solid #d2d2d7;
    color: #1d1d1f; border-radius: 5px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; font-size: 12px; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #0071e3; }

  .card { background: #fff; border: 1px solid #e5e5ea; border-radius: 10px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .btn-primary { background: #0071e3; color: #fff; border: none; border-radius: 980px;
    padding: 9px 18px; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    font-size: 13px; cursor: pointer; transition: background 0.15s; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 8px; }
  .btn-primary:hover { background: #0077ED; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-ghost { background: none; border: 1px solid #d2d2d7; color: #86868b; border-radius: 980px;
    padding: 8px 14px; font-size: 12px; cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; font-weight: 600;
    transition: all 0.15s; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px; }
  .btn-ghost:hover { border-color: #0071e3; color: #0071e3; }
  .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-sm { padding: 5px 10px; font-size: 11px; }

  .drop-zone { border: 2px dashed #d2d2d7; border-radius: 10px; padding: 48px 24px;
    text-align: center; transition: all 0.2s; cursor: pointer; background: #fff; }
  .drop-zone.drag-over { border-color: #0071e3; background: rgba(0,113,227,0.04); }
  .drop-zone:hover { border-color: #aeaeb2; }

  .table-row:hover td { background: rgba(0,0,0,0.02) !important; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 20px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; }

  .price-card { background: #fff; border: 1px solid #e5e5ea;
    border-radius: 8px; padding: 12px 14px; min-width: 160px; }
  .price-card.best { border-color: #34c759; background: rgba(52,199,89,0.06); }

  .po-card { background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; overflow: hidden; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .po-header { padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  .po-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .po-table th { background: #f5f5f7; padding: 8px 12px; text-align: left;
    font-size: 10px; letter-spacing: 0.08em; color: #86868b;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; font-weight: 700;
    border-bottom: 1px solid #e5e5ea; white-space: nowrap; }
  .po-table td { padding: 9px 12px; border-bottom: 1px solid #f0f0f2;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; vertical-align: middle; }
  .po-table tr:hover td { background: #f5f5f7; }

  .spinner { display: inline-block; width: 12px; height: 12px;
    border: 2px solid #d2d2d7; border-top-color: #0071e3;
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .alert-dot { width: 7px; height: 7px; border-radius: 50%; background: #ff3b30;
    display: inline-block; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  .key-input-row { display: grid; grid-template-columns: 200px 1fr; gap: 12px; align-items: center; margin-bottom: 10px; }
  .key-label { font-size: 12px; color: #86868b; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif; font-weight: 600; }
  .key-hint { font-size: 10px; color: #aeaeb2; margin-top: 2px; }

  .price-break-row { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #86868b; }
  .price-break-row span { color: #34c759; font-weight: 600; }

  /* ── Dark Mode ── */
  .dark { color-scheme: dark; color: #f5f5f7 !important; }
  .dark ::-webkit-scrollbar-track { background: #1a1a1e; }
  .dark ::-webkit-scrollbar-thumb { background: #3a3a3e; }

  .dark .nav-btn { color: #98989d; border-right-color: #3a3a3e; }
  .dark .nav-btn:nth-child(n+8) { border-top-color: #3a3a3e; }
  .dark .nav-btn:hover { color: #f5f5f7; background: rgba(255,255,255,0.05); }
  .dark .nav-btn.active { color: #64d2ff; background: rgba(100,210,255,0.08); }

  /* Override ALL inline backgrounds inside .dark */
  /* Standalone inputs — visible borders */
  .dark input[type="text"], .dark input[type="number"], .dark input[type="password"],
  .dark select, .dark textarea {
    background: #1c1c1e !important; border-color: #3a3a3e !important; color: #f5f5f7 !important; }
  .dark input:focus, .dark select:focus, .dark textarea:focus { border-color: #64d2ff !important; }
  /* Table inputs — seamless/transparent like light mode */
  .dark table input[type="text"], .dark table input[type="number"] {
    background: transparent !important; border-color: transparent !important; }
  .dark table input:focus { border-color: #3a3a3e !important; background: #2c2c2e !important; }
  .dark input::placeholder, .dark textarea::placeholder { color: #636366 !important; }
  .dark option { background: #1c1c1e; color: #f5f5f7; }

  /* Headings and text */
  .dark h2, .dark h3, .dark h4 { color: #f5f5f7 !important; }
  .dark p { color: #98989d !important; }
  .dark span { color: inherit; }
  .dark label { color: #98989d !important; }
  .dark td { color: #f5f5f7 !important; }
  .dark th { color: #c7c7cc !important; }

  /* Major layout sections — override inline backgrounds */
  .dark main > div { background: #000000 !important; }
  .dark main > div > div[style*="background"] { background: #1c1c1e !important; }

  /* Cards, tables, containers */
  .dark .card { background: #1c1c1e !important; border-color: #3a3a3e !important; box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important; }
  .dark table { background: #1c1c1e !important; }
  .dark thead tr { background: #2c2c2e !important; }
  .dark thead th { background: #2c2c2e !important; color: #c7c7cc !important; }
  .dark tbody tr { border-bottom-color: #2c2c2e !important; }
  .dark tbody td { background: transparent !important; }
  .dark .table-row:hover td { background: rgba(255,255,255,0.04) !important; }
  .dark tr[style*="borderBottom"] { border-bottom-color: #2c2c2e !important; }

  /* Buttons */
  .dark .btn-primary { background: #0a84ff !important; }
  .dark .btn-primary:hover { background: #409cff !important; }
  .dark .btn-ghost { border-color: #3a3a3e !important; color: #98989d !important; }
  .dark .btn-ghost:hover { border-color: #64d2ff !important; color: #64d2ff !important; }

  /* Drop zone */
  .dark .drop-zone { border-color: #3a3a3e !important; background: #1c1c1e !important; }
  .dark .drop-zone.drag-over { border-color: #0a84ff !important; background: rgba(10,132,255,0.08) !important; }
  .dark .drop-zone:hover { border-color: #636366 !important; }

  /* Price cards */
  .dark .price-card { background: #1c1c1e !important; border-color: #3a3a3e !important; }
  .dark .price-card.best { border-color: #30d158 !important; background: rgba(48,209,88,0.08) !important; }

  /* PO cards */
  .dark .po-card { background: #1c1c1e !important; border-color: #3a3a3e !important; box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important; }
  .dark .po-table th { background: #2c2c2e !important; color: #98989d !important; border-bottom-color: #3a3a3e !important; }
  .dark .po-table td { border-bottom-color: #2c2c2e !important; }
  .dark .po-table tr:hover td { background: #2c2c2e !important; }

  /* Spinner */
  .dark .spinner { border-color: #3a3a3e; border-top-color: #0a84ff; }

  /* Nuclear dark mode: override ALL div, section, main backgrounds */
  .dark main { background: #000000 !important; }
  .dark main div { border-color: #2c2c2e; }
  .dark main > div > div { background: #000000 !important; border-color: #3a3a3e !important; }
  .dark main > div > div > div { background: #1c1c1e !important; border-color: #3a3a3e !important; }
  .dark main > div > div > div > div { border-color: #2c2c2e !important; }

  /* Product/pricing/purchasing row items */
  .dark main div[style] { border-color: #2c2c2e !important; }

  /* All white backgrounds → dark */
  .dark [style*="background"][style*="fff"] { background: #1c1c1e !important; }
  .dark [style*="background"][style*="f5f5f7"] { background: #000000 !important; }
  .dark [style*="background"][style*="f5f5f7"] > div { background: #1c1c1e !important; }

  /* Borders */
  .dark [style*="border"][style*="e5e5ea"] { border-color: #3a3a3e !important; }
  .dark [style*="border"][style*="f0f0f2"] { border-color: #2c2c2e !important; }
  .dark [style*="border"][style*="d2d2d7"] { border-color: #3a3a3e !important; }

  /* Box shadows */
  .dark [style*="box-shadow"] { box-shadow: 0 1px 4px rgba(0,0,0,0.4) !important; }

  /* Force ALL text inside dark mode to be light */
  .dark main div, .dark main span, .dark main a, .dark main li, .dark main ol,
  .dark main td, .dark main th, .dark main label, .dark footer div, .dark footer span {
    color: #f5f5f7 !important;
  }
  /* Restore subdued text for items that should be dimmer */
  .dark main [style*="font-size: 12px"], .dark main [style*="fontSize:12"],
  .dark main [style*="font-size: 11px"], .dark main [style*="fontSize:11"],
  .dark main [style*="font-size: 10px"], .dark main [style*="fontSize:10"],
  .dark main [style*="font-size: 9px"], .dark main [style*="fontSize:9"] {
    color: #98989d !important;
  }
  /* Keep colored elements their original colors */
  .dark main [style*="color: rgb(0, 113, 227)"],
  .dark main [style*="color:#0071e3"] { color: #64d2ff !important; }
  .dark main [style*="color: rgb(255, 59, 48)"],
  .dark main [style*="color:#ff3b30"] { color: #ff453a !important; }
  .dark main [style*="color: rgb(52, 199, 89)"],
  .dark main [style*="color:#34c759"] { color: #30d158 !important; }
  .dark main [style*="color: rgb(255, 149, 0)"],
  .dark main [style*="color:#ff9500"] { color: #ff9f0a !important; }
  .dark main [style*="color: rgb(88, 86, 214)"],
  .dark main [style*="color:#5856d6"] { color: #bf5af2 !important; }

  /* Table header row */
  .dark [style*="background"][style*="b8bdd1"] { background: #2c2c2e !important; }

  /* Key input rows in settings */
  .dark .key-label { color: #c7c7cc !important; }
  .dark .key-hint { color: #636366 !important; }
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
    <div style={{ minHeight:"100vh",background:"#f5f5f7",display:"flex",alignItems:"center",justifyContent:"center" }}>
      <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",color:"#aeaeb2",fontSize:13 }}>Loading…</div>
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
  const [activeView,  setActiveView]  = useState("dashboard");
  const [selProject,  setSelProject]  = useState("all");
  const [selBrand,    setSelBrand]    = useState("all");
  const [collapsedBrands, setCollapsedBrands] = useState(new Set());
  const [newProjBrand, setNewProjBrand] = useState("Jackson Audio");
  const [search,      setSearch]      = useState("");
  const [pricingSearch, setPricingSearch] = useState("");
  const [pasteText,   setPasteText]   = useState("");
  const [showImport,  setShowImport]  = useState(false);
  const [showResGen,  setShowResGen]  = useState(false);
  const [resGenCfg,   setResGenCfg]   = useState({
    prefix: "0603WAF", suffix: "T5E", manufacturer: "Royalohm",
    descPrefix: "Resistor 0603 1% 1/10W Thick Film",
    decades: { 0:false, 1:true, 2:true, 3:true, 4:true, 5:true, 6:false },
  });
  const [resGenPreview, setResGenPreview] = useState(false);
  const [compGenType, setCompGenType] = useState("resistor"); // resistor | capacitor
  const [capGenCfg, setCapGenCfg] = useState({
    prefix: "GRM188R61E", suffix: "KA73D", manufacturer: "Murata",
    descPrefix: "Capacitor 0603 X5R 25V MLCC",
    decades: { 0:false, 1:true, 2:true, 3:true, 4:true, 5:true, 6:true },
  });
  const [capGenPreview, setCapGenPreview] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [importError, setImportError] = useState("");
  const [importOk,    setImportOk]    = useState("");
  const [dragOver,    setDragOver]    = useState(false);
  const [expandedPart,setExpandedPart]= useState(null);
  const [expandedProducts, setExpandedProducts] = useState(new Set());
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [collapsedSettings, setCollapsedSettings] = useState(new Set(["company","distributors","nexar","mouser","digikey","arrow","shopify","shipping","tariffs","email","ai","sms","facebook","guide"]));
  const [buildQueue, setBuildQueue] = useState([]);
  const [buildQtyInputs, setBuildQtyInputs] = useState({}); // { [productId]: "50" } — temp input values
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
  const [countryFilter, setCountryFilter] = useState("us"); // "us" or "rest"
  const [buyQtys, setBuyQtys] = useState({}); // { [partId]: number } — qty to price at per part
  const [simUsOnly, setSimUsOnly] = useState(false); // simulation: US suppliers only
  const [shopifyDemand, setShopifyDemand] = useState(null); // { products, orders, syncedAt, loading, error }
  const [shopifyProducts, setShopifyProducts] = useState([]); // Shopify product list for mapping
  const [shopifySalesPrices, setShopifySalesPrices] = useState(null); // { products: [{ shopifyProductId, title, avgPrice, minPrice, maxPrice, unitsSold, totalRevenue }] }
  const [customSupplierForm, setCustomSupplierForm] = useState(null); // { partId, name, url, country, stock, breaks: [{qty,price}] }
  const [mouserCartStatus, setMouserCartStatus] = useState(null); // { loading, error, cartUrl, cartKey, items }
  // Order tracker — DB-backed via poHistory
  const [trackedOrders, setTrackedOrders] = useState([]);
  const [poHistory, setPoHistory] = useState([]); // DB-backed PO history
  const [bomSnapshots, setBomSnapshots] = useState([]); // DB-backed BOM snapshots
  const [bomHistoryOpen, setBomHistoryOpen] = useState(false); // collapsible BOM history section
  const [bomCompareIdx, setBomCompareIdx] = useState(null); // index of snapshot being compared
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [orderForm, setOrderForm] = useState(null); // { supplier, poNumber, items, notes }
  const [supplierSort, setSupplierSort] = useState("spend"); // spend | leadtime | orders
  const [fullReelParts, setFullReelParts] = useState(new Set()); // part IDs where full reel is toggled
  const [settingsSaving, setSettingsSaving] = useState(""); // which section is saving
  const [settingsSaved, setSettingsSaved] = useState(""); // which section just saved
  const [qrModalParts, setQrModalParts] = useState(null); // array of parts to show QR labels for
  const [invoiceParsing, setInvoiceParsing] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState(null); // { items: [...], matched: [...] }
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceScanning, setInvoiceScanning] = useState(false);
  const invoiceCamRef = useRef(null);
  const [allPriceHistory, setAllPriceHistory] = useState([]); // price_history rows for all parts
  const [partPriceHistoryCache, setPartPriceHistoryCache] = useState({}); // { [partId]: [...rows] }
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("bom_dark_mode") === "true"; } catch { return false; }
  });
  // ── Production Floor state
  const [teamMembers,      setTeamMembers]      = useState([]);
  const [buildOrders,      setBuildOrders]       = useState([]);
  const [buildAssignments, setBuildAssignments]  = useState([]);
  const [prodTeamCollapsed, setProdTeamCollapsed] = useState(true);
  const [prodCompletedCollapsed, setProdCompletedCollapsed] = useState(true);
  const [newTeamMember,    setNewTeamMember]     = useState({ name:"", role:"assembler", phone:"", email:"", pin_code:"" });
  const [newBuildOrder,    setNewBuildOrder]     = useState({ product_id:"", quantity:"", priority:"normal", due_date:"", team_member_id:"", notes:"" });
  const [prodBusy,         setProdBusy]          = useState(false);

  const [pdPasteText, setPdPasteText] = useState(""); // product detail page paste text
  const [pdDragOver, setPdDragOver] = useState(false); // product detail page drag state
  const [pdImportError, setPdImportError] = useState("");
  const [pdImportOk, setPdImportOk] = useState("");

  const fileRef = useRef();
  const pdFileRef = useRef(); // product detail page file input ref
  const qtyTimers = useRef({}); // debounce timers for qty→price refresh
  const simTimer = useRef(null); // debounce timer for sim auto-run
  const recentLocalWrites = useRef(new Set()); // part IDs written locally — skip realtime for these

  // Settings per-section save button helper
  const sectionSaveBtn = (sectionId, label) => (
    <div style={{ marginTop:14,display:"flex",alignItems:"center",gap:10 }}>
      <button className="btn-primary" style={{ fontSize:12,padding:"7px 18px" }}
        disabled={settingsSaving === sectionId}
        onClick={async () => {
          setSettingsSaving(sectionId); setSettingsSaved("");
          try {
            await saveAllApiKeys(apiKeys, user.id);
            authenticateAPIs();
            setSettingsSaved(sectionId);
            setTimeout(() => setSettingsSaved(s => s === sectionId ? "" : s), 3000);
          } catch (e) { console.error("Save failed:", e); alert("Save failed: " + e.message); }
          finally { setSettingsSaving(""); }
        }}>
        {settingsSaving === sectionId ? "Saving…" : `Save ${label}`}
      </button>
      {settingsSaved === sectionId && <span style={{ fontSize:11,color:"#34c759",fontWeight:600 }}>Saved</span>}
    </div>
  );

  // Persist tracked orders
  const saveTrackedOrders = (orders) => {
    setTrackedOrders(orders);
  };

  // Add a new tracked order
  const addTrackedOrder = (order) => {
    const newOrder = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      supplier: order.supplier || "Mouser",
      supplierColor: order.supplierColor || "#e8500a",
      poNumber: order.poNumber || "",
      status: order.status || "submitted",
      items: order.items || [],
      totalEstimate: order.totalEstimate || 0,
      cartKey: order.cartKey || "",
      cartUrl: order.cartUrl || "",
      trackingNumbers: [],
      carrier: "",
      notes: order.notes || "",
      receivedAt: null,
    };
    saveTrackedOrders([newOrder, ...trackedOrders]);
    return newOrder;
  };

  // Update a tracked order field
  const updateTrackedOrder = (orderId, updates) => {
    saveTrackedOrders(trackedOrders.map(o => o.id === orderId ? { ...o, ...updates } : o));
  };

  // Delete a tracked order
  const deleteTrackedOrder = (orderId) => {
    if (!window.confirm("Delete this order record? This cannot be undone.")) return;
    saveTrackedOrders(trackedOrders.filter(o => o.id !== orderId));
    if (expandedOrder === orderId) setExpandedOrder(null);
  };

  // Helper: get tracking URL for carrier
  const getTrackingUrl = (trackingNumber, carrier) => {
    const c = (carrier || "").toLowerCase();
    if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    if (c.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${trackingNumber}`;
    if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    return `https://www.google.com/search?q=${encodeURIComponent(trackingNumber + " tracking")}`;
  };

  // Update quantity and auto-refresh pricing after debounce
  const updateQtyAndRefresh = (partId, newQty) => {
    updatePart(partId, "quantity", newQty);
    clearTimeout(qtyTimers.current[partId]);
    qtyTimers.current[partId] = setTimeout(() => {
      setParts(current => {
        const p = current.find(x => x.id === partId);
        const hasCustom = p?.pricing && Object.values(p.pricing).some(v => v.isCustom);
        const hasApi = p?.mpn && (nexarToken || apiKeys.mouser_api_key);
        if (hasApi || hasCustom) fetchPartPricing(partId);
        return current;
      });
    }, 800);
  };

  // ─────────────────────────────────────────────
  // DB BOOT — fetch initial data on mount
  // ─────────────────────────────────────────────
  // Sync build queue to DB when it changes
  useEffect(() => {
    for (const q of buildQueue) {
      supabase.from("products").update({ build_queue_qty: q.qty }).eq("id", q.productId).then();
    }
  }, [buildQueue]);

  useEffect(() => {
    async function boot() {
      try {
        // Parallel fetch products, parts, api keys, and production data
        const [prods, pts, keys, tms, bos, bas] = await Promise.all([
          fetchProducts(),
          fetchParts(),
          fetchApiKeys(),
          fetchTeamMembers().catch(() => []),
          fetchBuildOrders().catch(() => []),
          fetchBuildAssignments().catch(() => []),
        ]);
        setTeamMembers(tms || []);
        setBuildOrders(bos || []);
        setBuildAssignments(bas || []);

        // Normalize DB rows → UI shape (DB uses snake_case, UI uses camelCase)
        const uiProducts = prods.map(dbProductToUI);
        setProducts(uiProducts);
        setParts(pts.map(dbPartToUI));

        // Restore build queue from products
        const restoredQueue = uiProducts
          .filter(p => p.buildQueueQty && p.buildQueueQty > 0)
          .map(p => ({ productId: p.id, name: p.name, qty: p.buildQueueQty, color: p.color }));
        if (restoredQueue.length > 0) setBuildQueue(restoredQueue);

        // Merge fetched keys over defaults — store merged copy for auto-connect
        const mergedKeys = { ...DEFAULT_KEYS, ...keys };
        setApiKeys(mergedKeys);

        // Restore shipping costs from DB
        if (mergedKeys.shipping_json) {
          try {
            const shipObj = JSON.parse(mergedKeys.shipping_json);
            SUPPLIERS.forEach(s => { if (shipObj[s.id] !== undefined) s.shipping = shipObj[s.id]; });
          } catch {}
        }

        // Load price history for product cost trends
        fetchAllPriceHistory().then(ph => setAllPriceHistory(ph || [])).catch(() => {});

        // Load PO history from DB
        fetchPOHistory().then(poRows => {
          setPoHistory(poRows || []);
          // Merge DB records with localStorage for backward compat
          if (poRows && poRows.length > 0) {
            const localOrders = JSON.parse(localStorage.getItem("bom_tracked_orders") || "[]");
            const dbIds = new Set(poRows.map(r => r.id));
            // Convert DB rows to tracked order format and merge
            const dbOrders = poRows.map(r => ({
              id: r.id,
              createdAt: r.ordered_at || r.created_at,
              supplier: r.supplier || "",
              supplierColor: SUPPLIERS.find(s => s.id === (r.supplier||"").toLowerCase() || s.name === r.supplier)?.color || "#8e8e93",
              poNumber: r.po_number || "",
              status: r.status || "submitted",
              items: r.items || [],
              totalEstimate: r.total_value || 0,
              notes: r.notes || "",
              receivedAt: r.received_at,
              dbRecord: true, // flag to identify DB-backed records
            }));
            // Keep localStorage orders that aren't in DB
            const localOnly = localOrders.filter(lo => !dbIds.has(lo.id) && !dbOrders.some(db => db.poNumber && db.poNumber === lo.poNumber && db.supplier === lo.supplier));
            const merged = [...dbOrders, ...localOnly].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setTrackedOrders(merged);
          }
        }).catch(() => {});

        // Load BOM snapshots from DB
        fetchBomSnapshots().then(snaps => setBomSnapshots(snaps || [])).catch(() => {});

        // Pre-fetch exchange rates so they're cached for pricing
        fetchExchangeRates().catch(() => {});

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

  // Persist dark mode preference + sync body background
  useEffect(() => {
    try { localStorage.setItem("bom_dark_mode", darkMode); } catch {}
    document.body.style.background = darkMode ? "#000000" : "#f5f5f7";
  }, [darkMode]);

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
        setParts((prev) => prev.map((p) => {
          if (p.id !== newRow.id) return p;
          // Skip realtime updates for parts we just wrote locally — avoids race conditions
          if (recentLocalWrites.current.has(newRow.id)) return p;
          const updated = dbPartToUI(newRow);
          // Realtime payloads can truncate large JSON columns like pricing.
          // Preserve local pricing if the realtime payload is missing it,
          // and always preserve local custom suppliers.
          if (p.pricing) {
            if (!updated.pricing || Object.keys(updated.pricing).length === 0) {
              // Realtime payload truncated pricing — keep local copy entirely
              updated.pricing = p.pricing;
              updated.pricingStatus = p.pricingStatus;
              updated.bestSupplier = p.bestSupplier;
              updated.preferredSupplier = p.preferredSupplier;
            } else {
              // Merge local custom suppliers into realtime data
              for (const [k, v] of Object.entries(p.pricing)) {
                if (v.isCustom) updated.pricing[k] = v;
              }
            }
            // Always preserve exclusive supplier preference
            const exclusiveKey = Object.entries(updated.pricing || {}).find(([, v]) => v.isCustom && v.exclusive);
            if (exclusiveKey) updated.preferredSupplier = exclusiveKey[0];
          }
          return updated;
        }));
      } else if (eventType === "DELETE") {
        setParts((prev) => prev.filter((p) => p.id !== oldRow.id));
        setSelectedParts((prev) => { const n = new Set(prev); n.delete(oldRow.id); return n; });
      }
    });

    // Team members channel
    const teamChannel = subscribeToTeamMembers((eventType, newRow, oldRow) => {
      if (eventType === "INSERT") {
        setTeamMembers((prev) => prev.find(t => t.id === newRow.id) ? prev : [...prev, newRow]);
      } else if (eventType === "UPDATE") {
        setTeamMembers((prev) => prev.map(t => t.id === newRow.id ? newRow : t));
      } else if (eventType === "DELETE") {
        setTeamMembers((prev) => prev.filter(t => t.id !== oldRow.id));
      }
    });

    // Build orders channel
    const boChannel = subscribeToBuildOrders((eventType, newRow, oldRow) => {
      if (eventType === "INSERT") {
        setBuildOrders((prev) => prev.find(b => b.id === newRow.id) ? prev : [newRow, ...prev]);
      } else if (eventType === "UPDATE") {
        setBuildOrders((prev) => prev.map(b => b.id === newRow.id ? newRow : b));
      } else if (eventType === "DELETE") {
        setBuildOrders((prev) => prev.filter(b => b.id !== oldRow.id));
      }
    });

    // Build assignments channel
    const baChannel = subscribeToBuildAssignments((eventType, newRow, oldRow) => {
      if (eventType === "INSERT") {
        setBuildAssignments((prev) => prev.find(a => a.id === newRow.id) ? prev : [newRow, ...prev]);
      } else if (eventType === "UPDATE") {
        setBuildAssignments((prev) => prev.map(a => a.id === newRow.id ? newRow : a));
      } else if (eventType === "DELETE") {
        setBuildAssignments((prev) => prev.filter(a => a.id !== oldRow.id));
      }
    });

    return () => {
      prodChannel.unsubscribe();
      partChannel.unsubscribe();
      teamChannel.unsubscribe();
      boChannel.unsubscribe();
      baChannel.unsubscribe();
    };
  }, []); // eslint-disable-line

  // ── Authenticate all configured APIs
  const authenticateAPIs = async (keys = apiKeys) => {
    setTokenStatus("loading"); setTokenMsg("");
    let nToken = nexarToken, dToken = dkToken;
    const msgs = [];

    if (keys.nexar_client_id && keys.nexar_client_secret) {
      try {
        console.log("[Auth] Connecting Nexar with client ID:", keys.nexar_client_id.slice(0, 8) + "...");
        nToken = await fetchNexarToken(keys.nexar_client_id, keys.nexar_client_secret);
        setNexarToken(nToken);
        console.log("[Auth] Nexar token obtained, length:", nToken?.length);
        msgs.push("✓ Nexar/Octopart connected");
      } catch (e) {
        console.error("[Auth] Nexar failed:", e);
        msgs.push("✗ Nexar: " + e.message);
      }
    } else {
      console.log("[Auth] No Nexar keys found — client_id:", !!keys.nexar_client_id, "secret:", !!keys.nexar_client_secret);
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
    // Read latest part state using Promise to handle React 18 batching
    const part = await new Promise(resolve => {
      setParts(prev => { resolve(prev.find(p => p.id === partId) || null); return prev; });
    });
    if (!part) return;

    // Preserve custom suppliers through refresh
    const customEntries = {};
    if (part.pricing) {
      for (const [k, v] of Object.entries(part.pricing)) {
        if (v.isCustom) customEntries[k] = v;
      }
    }

    // Parts with no MPN but custom pricing should still show as "done"
    if (!part.mpn) {
      if (Object.keys(customEntries).length > 0) {
        const best = bestPriceSupplier(customEntries);
        const bestPrice = customEntries[best]?.unitPrice;
        setParts((prev) => prev.map((p) => p.id === partId ? {
          ...p, pricing: customEntries, pricingStatus: "done", bestSupplier: best,
          unitCost: p.unitCost || (bestPrice ? fmtPrice(bestPrice) : p.unitCost),
        } : p));
      } else {
        updatePart(partId, "pricingStatus", "no-mpn");
      }
      return;
    }

    // Optimistic loading state
    setParts((prev) => prev.map((p) => p.id === partId ? { ...p, pricingStatus: "loading" } : p));
    try {
      const apiPricing = await fetchAllPricing(part.mpn, part.quantity, apiKeys, nexarToken, dkToken);
      // Merge custom suppliers back in — re-read latest state to catch any custom suppliers added during fetch
      const latestCustom = await new Promise(resolve => {
        setParts(prev => {
          const merged = { ...customEntries };
          const latest = prev.find(p => p.id === partId);
          if (latest?.pricing) {
            for (const [k, v] of Object.entries(latest.pricing)) {
              if (v.isCustom) merged[k] = v;
            }
          }
          resolve(merged);
          return prev;
        });
      });
      const pricing = { ...apiPricing, ...latestCustom };
      // If an exclusive custom supplier exists, always prefer it
      const exclusiveKey = Object.keys(latestCustom).find(k => latestCustom[k].exclusive);
      const best     = exclusiveKey || bestPriceSupplier(pricing);
      const bestPrice = pricing[best]?.unitPrice;
      const newUnitCost = part.unitCost || (bestPrice ? fmtPrice(bestPrice) : part.unitCost);
      const newPref     = exclusiveKey || best || part.preferredSupplier;

      // Update UI optimistically
      setParts((prev) => prev.map((p) => p.id === partId ? {
        ...p, pricing, pricingStatus: "done", bestSupplier: best,
        unitCost: newUnitCost, preferredSupplier: newPref,
      } : p));

      // Record best price to price history
      if (bestPrice && bestPrice > 0 && best) {
        const bestSupplierName = pricing[best]?.displayName || best;
        recordPrice(partId, bestPrice, bestSupplierName, "pricing").catch(e => console.error("[recordPrice:pricing]", e));
      }

      // Persist to DB (so team sees cached pricing on next load)
      recentLocalWrites.current.add(partId);
      setTimeout(() => recentLocalWrites.current.delete(partId), 3000);
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

  // ── Import into a specific product (product detail page)
  const handleProductImport = useCallback(async (rawText, productId, filename = "") => {
    setPdImportError(""); setPdImportOk("");
    try {
      const parsed = parseBOM(rawText);
      if (!parsed.length) { setPdImportError("No parts found. Check header row."); return; }
      // Set product_id on all parsed parts
      const withProduct = parsed.map(p => ({ ...p, projectId: productId }));
      // Filter duplicates by MPN against what's already in DB
      const existingMPNs = new Set(parts.map((p) => p.mpn).filter(Boolean));
      const fresh = withProduct.filter((p) => !p.mpn || !existingMPNs.has(p.mpn));
      if (!fresh.length) { setPdImportError("All parts already exist in the library (matched by MPN)."); return; }
      const dbRows = fresh.map((p) => uiPartToDB(p));
      await upsertParts(dbRows, user.id);
      setPdImportOk(`Imported ${fresh.length} parts${filename ? ` from "${filename}"` : ""} into this product.`);
    } catch (e) { setPdImportError("Import error: " + e.message); }
  }, [parts, user?.id]);

  const handleProductDrop = useCallback((e, productId) => {
    e.preventDefault(); setPdDragOver(false);
    const file = e.dataTransfer.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleProductImport(ev.target.result, productId, file.name);
    reader.readAsText(file);
  }, [handleProductImport]);

  const handleProductFilePick = (e, productId) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleProductImport(ev.target.result, productId, file.name);
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
      shopifyProductId: row.shopify_product_id || null,
      buildMinutes: row.build_minutes || null,
      salesPrice: row.sales_price || null,
      brand: row.brand || "Jackson Audio",
      buildQueueQty: row.build_queue_qty || null,
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
      reelQty:           row.reel_qty    != null ? String(row.reel_qty)    : "",
      flaggedForOrder:   row.flagged_for_order  || false,
      pricing:           row.pricing     || null,
      pricingStatus:     row.pricing_status     || "idle",
      pricingError:      row.pricing_error       || "",
      bestSupplier:      row.best_supplier       || null,
      isInternal:        row.is_internal         || false,
      createdBy:         row.created_by,
      updatedBy:         row.updated_by,
      updatedAt:         row.updated_at || null,
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
      stockQty: "stock_qty", preferredSupplier: "preferred_supplier", orderQty: "order_qty", reelQty: "reel_qty",
      flaggedForOrder: "flagged_for_order", pricingStatus: "pricing_status",
      pricingError: "pricing_error", bestSupplier: "best_supplier",
    };
    const dbField = dbFieldMap[field] || field;
    let dbValue = value;

    // Type coercion for numeric DB fields
    if (["unit_cost"].includes(dbField))    dbValue = value !== "" ? parseFloat(value) || null : null;
    if (["reorder_qty","stock_qty","order_qty","reel_qty","quantity"].includes(dbField)) dbValue = value !== "" ? parseInt(value) || null : null;

    try {
      await dbUpdatePart(id, { [dbField]: dbValue }, user.id);
    } catch (e) {
      console.error("updatePart failed:", e);
    }
  };

  // Save a custom supplier to a part's pricing object
  const saveCustomSupplier = async (partId, { name, url, country, stock, breaks, editKey, exclusive }) => {
    const key = "custom_" + name.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const unitPrice = breaks.length > 0 ? breaks[0].price : 0;
    const entry = {
      supplierId: key,
      displayName: name,
      country: country || "US",
      unitPrice,
      stock: parseInt(stock) || 999999,
      moq: breaks.length > 0 ? breaks[0].qty : 1,
      url: url || "",
      priceBreaks: breaks.filter(b => b.qty > 0 && b.price > 0),
      isCustom: true,
      exclusive: !!exclusive,
    };
    const newPref = exclusive ? key : undefined;
    // Build pricing using Promise to guarantee we get the result from React 18's batched updater
    const newPricing = await new Promise(resolve => {
      setParts((prev) => {
        let built = null;
        const updated = prev.map((p) => {
          if (p.id !== partId) return p;
          const pricing = { ...(p.pricing || {}) };
          if (editKey && editKey !== key) delete pricing[editKey];
          pricing[key] = entry;
          built = pricing;
          const best = bestPriceSupplier(pricing);
          return { ...p, pricing, bestSupplier: best, pricingStatus: "done", ...(newPref ? { preferredSupplier: newPref } : {}) };
        });
        resolve(built);
        return updated;
      });
    });
    // Mark this part as locally written so realtime doesn't clobber it
    recentLocalWrites.current.add(partId);
    setTimeout(() => recentLocalWrites.current.delete(partId), 5000);
    // Persist to DB
    if (newPricing) {
      const dbFields = { pricing: newPricing, pricing_status: "done", best_supplier: bestPriceSupplier(newPricing) };
      if (newPref) dbFields.preferred_supplier = newPref;
      try {
        await dbUpdatePart(partId, dbFields, user.id);
        console.log("[saveCustomSupplier] DB write OK, key:", key, "exclusive:", !!exclusive);
      } catch (e) { console.error("[saveCustomSupplier] DB write FAILED:", e); }

      // Safety net: verify DB has the custom supplier after a delay
      const verifyAndRepair = async (attempt) => {
        try {
          const { data } = await supabase.from("parts").select("pricing").eq("id", partId).single();
          if (!data?.pricing?.[key]) {
            console.warn(`[saveCustomSupplier] verify #${attempt}: missing from DB — rewriting`);
            const repaired = { ...(data?.pricing || {}), [key]: entry };
            await dbUpdatePart(partId, { pricing: repaired, pricing_status: "done", ...(newPref ? { preferred_supplier: newPref } : {}) }, user.id);
            recentLocalWrites.current.add(partId);
            setTimeout(() => recentLocalWrites.current.delete(partId), 5000);
            console.log(`[saveCustomSupplier] verify #${attempt}: DB repaired`);
          } else {
            console.log(`[saveCustomSupplier] verify #${attempt}: DB OK`);
          }
        } catch (e) { console.error(`[saveCustomSupplier] verify #${attempt} error:`, e); }
      };
      setTimeout(() => verifyAndRepair(1), 2000);
      setTimeout(() => verifyAndRepair(2), 5000);
    } else {
      console.error("[saveCustomSupplier] part not found for id:", partId);
    }
    setCustomSupplierForm(null);
  };

  // Remove a custom supplier from a part
  const removeCustomSupplier = async (partId, supplierKey) => {
    if (!window.confirm("Remove this custom supplier?")) return;
    setParts((prev) => prev.map((p) => {
      if (p.id !== partId) return p;
      const pricing = { ...p.pricing };
      delete pricing[supplierKey];
      const best = bestPriceSupplier(pricing);
      return { ...p, pricing, bestSupplier: best };
    }));
    const part = parts.find(p => p.id === partId);
    const newPricing = { ...(part?.pricing || {}) };
    delete newPricing[supplierKey];
    try {
      await dbUpdatePart(partId, { pricing: newPricing, best_supplier: bestPriceSupplier(newPricing) }, user.id);
    } catch (e) { console.error("removeCustomSupplier failed:", e); }
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
    const part = parts.find(p => p.id === id);
    const label = part?.mpn || part?.reference || "this part";
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
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
    if (!window.confirm(`Delete ${ids.length} selected part${ids.length !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    setParts((prev) => prev.filter((p) => !selectedParts.has(p.id)));
    setSelectedParts(new Set());
    try { await deletePartsMany(ids); } catch (e) { console.error("deleteSelected failed:", e); }
  };

  // ── Add a new Product (writes to DB, realtime updates all sessions)
  const addProduct = async () => {
    if (!newProjName.trim()) return;
    const colors = ["#ff9500","#5856d6","#ff3b30","#34c759","#0071e3","#ff9500","#ff2d55"];
    const color  = colors[products.length % colors.length];
    const name   = newProjName.trim();
    setNewProjName(""); // clear immediately for responsiveness
    try {
      await createProduct({ name, color, userId: user.id, brand: newProjBrand || "Jackson Audio" });
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
    if (form.desc) setQAField(productId, "desc", "");
    if (form.value) setQAField(productId, "value", "");
    if (form.mfr) setQAField(productId, "mfr", "");

    const uiPart = {
      reference: pn, refs: [pn], value: form.value || "", mpn: pn,
      description: form.desc || "", footprint: "", manufacturer: form.mfr || "",
      quantity: qty, unitCost: "", projectId: productId,
      reorderQty: "", stockQty: "", preferredSupplier: form.isInternal ? "internal" : "mouser",
      orderQty: "", flaggedForOrder: false, isInternal: form.isInternal || false,
      pricing: null, pricingStatus: "idle", pricingError: "", bestSupplier: null,
    };

    // Optimistic UI — add the part immediately with a temp ID
    const tempId = "temp_" + Date.now();
    const optimisticPart = { ...uiPart, id: tempId };
    setParts((prev) => [...prev, optimisticPart]);

    try {
      const created = await createPart(uiPartToDB(uiPart), user.id);
      // Replace temp part with real one (realtime may also fire, dedupe by checking tempId)
      setParts((prev) => {
        const withoutTemp = prev.filter((p) => p.id !== tempId);
        if (withoutTemp.find((p) => p.id === created.id)) return withoutTemp; // realtime already added it
        return [...withoutTemp, dbPartToUI(created)];
      });
    } catch (e) {
      console.error("quickAddPart failed:", e);
      // Remove optimistic part on failure
      setParts((prev) => prev.filter((p) => p.id !== tempId));
      setQAField(productId, "_error", `Failed to add part: ${e.message}`);
      setTimeout(() => setQAField(productId, "_error", ""), 5000);
    }
  };

  // ── Capture invoice from camera
  const captureInvoiceFromCamera = async () => {
    if (!apiKeys.anthropic_api_key) {
      setInvoiceError("Set your Anthropic API key in Settings → AI first.");
      return;
    }
    setInvoiceScanning(true);
    setInvoiceError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } });
      const video = invoiceCamRef.current;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      setInvoiceError("Camera access denied or not available.");
      setInvoiceScanning(false);
    }
  };

  const snapInvoicePhoto = async () => {
    const video = invoiceCamRef.current;
    if (!video || !video.srcObject) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    // Stop camera
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    setInvoiceScanning(false);
    // Convert to blob and parse
    canvas.toBlob(async (blob) => {
      const file = new File([blob], "invoice-scan.jpg", { type: "image/jpeg" });
      parseInvoice(file);
    }, "image/jpeg", 0.92);
  };

  const cancelInvoiceScan = () => {
    const video = invoiceCamRef.current;
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    setInvoiceScanning(false);
  };

  // ── Parse invoice file using Claude AI
  const parseInvoice = async (file) => {
    if (!apiKeys.anthropic_api_key) {
      setInvoiceError("Set your Anthropic API key in Settings → AI first.");
      return;
    }
    setInvoiceParsing(true);
    setInvoiceError("");
    setInvoiceResult(null);
    try {
      const ext = file.name.toLowerCase().split(".").pop();
      const isPDF = ext === "pdf";
      const isImage = ["png","jpg","jpeg","gif","webp"].includes(ext);
      let payload;

      if (isPDF || isImage) {
        // Read as base64 for Claude vision/document understanding
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const mediaType = isPDF ? "application/pdf" : file.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
        payload = { fileBase64: base64, mediaType, apiKey: apiKeys.anthropic_api_key };
      } else {
        // Read as text for CSV/TSV/TXT
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });
        payload = { invoiceText: text.substring(0, 30000), apiKey: apiKeys.anthropic_api_key };
      }

      const res = await fetch("/api/parse-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error + (data.details ? ` — ${typeof data.details === "string" ? data.details.substring(0, 200) : JSON.stringify(data.details).substring(0, 200)}` : ""));
      if (!data.items?.length) throw new Error("No line items found in invoice");

      // Match items to existing parts by MPN
      const matched = data.items.map((item) => {
        const mpnLower = (item.mpn || "").toLowerCase();
        const match = parts.find(p => p.mpn && p.mpn.toLowerCase() === mpnLower);
        return { ...item, matchedPart: match || null, apply: !!match };
      });
      setInvoiceResult({ items: matched, fileName: file.name });
    } catch (e) {
      setInvoiceError("Invoice parsing failed: " + e.message);
    } finally {
      setInvoiceParsing(false);
    }
  };

  // ── Apply parsed invoice — update existing parts OR create new ones
  const applyInvoiceResults = async () => {
    if (!invoiceResult) return;
    const toApply = invoiceResult.items.filter(i => i.apply);
    let created = 0, updated = 0;
    for (const item of toApply) {
      if (item.matchedPart) {
        // Update existing part — add to stock and update cost
        const oldStock = parseInt(item.matchedPart.stockQty) || 0;
        const newStock = oldStock + (parseInt(item.quantity) || 0);
        await updatePart(item.matchedPart.id, "stockQty", String(newStock));
        if (item.unitPrice > 0) {
          await updatePart(item.matchedPart.id, "unitCost", String(item.unitPrice));
          recordPrice(item.matchedPart.id, item.unitPrice, item.supplier || "", "invoice").catch(e => console.error("[recordPrice:invoice]", e));
        }
        updated++;
      } else {
        // Create new part from invoice line item — only include known DB columns
        const newPart = {
          mpn: item.mpn || "",
          reference: item.mpn || "",
          description: item.description || "",
          value: "",
          footprint: "",
          manufacturer: "",
          quantity: 1,
          unit_cost: item.unitPrice > 0 ? item.unitPrice : null,
          stock_qty: parseInt(item.quantity) || 0,
          preferred_supplier: item.supplier || "mouser",
          flagged_for_order: false,
          pricing_status: "idle",
          pricing_error: "",
        };
        try {
          const createdPart = await createPart(newPart, user.id);
          created++;
          if (item.unitPrice > 0 && createdPart?.id) {
            recordPrice(createdPart.id, item.unitPrice, item.supplier || "", "invoice").catch(e => console.error("[recordPrice:invoice-new]", e));
          }
        } catch (e) { console.error("Create part from invoice failed:", e); }
      }
    }
    const msg = [];
    if (updated) msg.push(`${updated} part${updated!==1?"s":""} updated`);
    if (created) msg.push(`${created} new part${created!==1?"s":""} created`);
    setInvoiceResult(null);
    if (msg.length) setInvoiceError("✓ " + msg.join(", "));
    else setInvoiceError("");
  };

  const setQAField = (productId, field, value) =>
    setQuickAdd((prev) => ({ ...prev, [productId]: { ...(prev[productId]||{}), [field]: value } }));

  // ── BOM cost simulator — compares cheapest-per-part vs consolidated strategies
  function getShipping(supplierId) {
    const s = SUPPLIERS.find(x => x.id === supplierId);
    return s ? s.shipping : DEFAULT_SHIPPING;
  }

  // Get best price for a part from a specific supplier at given component qty
  const isUSSupplier = (sid, data) => {
    const c = data?.country || DIST_COUNTRY[data?.displayName] || DIST_COUNTRY[sid] || "";
    return !c || c === "US";
  };

  function supplierPriceForPart(part, supplierId, needed, usOnly) {
    const pricing = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
    if (!pricing || !pricing[supplierId]) return null;
    const data = pricing[supplierId];
    if (data.stock <= 0) return null;
    if (usOnly && !isUSSupplier(supplierId, data)) return null;
    if (!data.priceBreaks?.length) return data.unitPrice > 0 ? data.unitPrice : null;
    let price = data.priceBreaks[0]?.price || data.unitPrice;
    for (const pb of data.priceBreaks) { if (needed >= pb.qty) price = pb.price; }
    return price > 0 ? price : null;
  }

  // Get cheapest available price across all suppliers for a part
  function cheapestForPart(part, needed, usOnly) {
    const pricing = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
    if (!pricing) return { price: parseFloat(part.unitCost) || 0, supplier: null };
    // If an exclusive custom supplier is set, always use it
    const exclusiveEntry = Object.entries(pricing).find(([, d]) => d.isCustom && d.exclusive);
    if (exclusiveEntry) {
      const [sid, data] = exclusiveEntry;
      let price = data.unitPrice;
      if (data.priceBreaks?.length) {
        price = data.priceBreaks[0]?.price || data.unitPrice;
        for (const pb of data.priceBreaks) { if (needed >= pb.qty) price = pb.price; }
      }
      return { price: parseFloat(price) || parseFloat(part.unitCost) || 0, supplier: sid };
    }
    let best = { price: Infinity, supplier: null };
    for (const [sid, data] of Object.entries(pricing)) {
      if (data.stock <= 0) continue;
      if (usOnly && !isUSSupplier(sid, data)) continue;
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
  function simStrategy(prodParts, prodQty, mode, usOnly = false) {
    // mode: "cheapest" | supplierId (consolidate to one) | "smart" (minimize total incl shipping)
    const assignments = []; // { partId, supplierId, unitPrice, needed, lineCost }
    const suppliersUsed = new Set();

    for (const part of prodParts) {
      const needed = part.quantity * prodQty;
      if (mode === "cheapest") {
        const { price, supplier } = cheapestForPart(part, needed, usOnly);
        assignments.push({ partId: part.id, mpn: part.mpn, supplierId: supplier, unitPrice: price, needed, lineCost: price * needed });
        if (supplier) suppliersUsed.add(supplier);
      } else if (mode === "smart") {
        // Handled after this loop
        assignments.push({ partId: part.id, mpn: part.mpn, needed });
      } else {
        // Consolidate to specific supplier
        const price = supplierPriceForPart(part, mode, needed, usOnly);
        if (price !== null) {
          assignments.push({ partId: part.id, mpn: part.mpn, supplierId: mode, unitPrice: price, needed, lineCost: price * needed });
          suppliersUsed.add(mode);
        } else {
          // Fallback to cheapest if supplier doesn't have this part
          const { price: fp, supplier } = cheapestForPart(part, needed, usOnly);
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
        const { price, supplier } = cheapestForPart(part, needed, usOnly);
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
          const primaryPrice = supplierPriceForPart(part, primarySup, needed, usOnly);
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
      // Tariff applies when importing from a non-US supplier (they ship internationally, customs applies)
      // US-based distributors (Mouser, DigiKey, etc.) already handle import duties in their pricing
      const part = prodParts.find(p => p.id === a.partId);
      const pricingData = part?.pricing?.[a.supplierId];
      const supCountry = pricingData?.country || DIST_COUNTRY[pricingData?.displayName] || DIST_COUNTRY[a.supplierId] || "";
      const origin = (!supCountry || supCountry === "US") ? "" : supCountry;
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

  async function runBomSimulation(productId, usOnlyOverride) {
    const useUsOnly = usOnlyOverride !== undefined ? usOnlyOverride : simUsOnly;
    const prodParts = parts.filter((p) => p.projectId === productId);
    if (!prodParts.length) return;
    // Read qty from latest state using Promise to handle React 18 batching
    const baseQty = await new Promise(resolve => {
      setBomSim(prev => { resolve(parseInt(prev[productId]?.qty) || 100); return prev; });
    });
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

    // Run strategies at each qty: cheapest-per-part, smart (consolidated)
    const results = testQtys.map(q => {
      const cheapest = simStrategy(freshParts, q, "cheapest", useUsOnly);
      const smart = simStrategy(freshParts, q, "smart", useUsOnly);
      return { qty: q, cheapest, smart };
    });

    setBomSim(prev => ({ ...prev, [productId]: { ...prev[productId], results, loading: false } }));
  }

  // ── Derived state
  const visibleParts = parts.filter((p) => {
    const mP = selProject === "all" || p.projectId === selProject || (selProject === "unassigned" && !p.projectId);
    if (!search.trim()) return mP;
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const blob = [p.reference, p.value, p.mpn, p.description, p.manufacturer].join(" ").toLowerCase();
    return mP && words.every(w => blob.includes(w));
  });

  // ── SHOPIFY INTEGRATION (multi-store) ──
  const getShopifyStores = () => {
    try { return JSON.parse(apiKeys.shopify_stores_json || "[]"); } catch { return []; }
  };

  const syncShopifyOrders = async () => {
    const stores = getShopifyStores();
    if (!stores.length) {
      setShopifyDemand({ loading: false, error: "No Shopify stores configured. Add them in Settings." });
      return;
    }
    setShopifyDemand(prev => ({ ...prev, loading: true, error: null }));
    try {
      const allProducts = []; // demand aggregation
      const allOrders = [];
      let allShopifyProducts = [];
      const errors = [];

      for (const store of stores) {
        if (!store.domain || !store.clientId || !store.clientSecret) { errors.push(`${store.name || "?"}: missing domain, client ID, or secret`); continue; }
        const q = `domain=${encodeURIComponent(store.domain)}&client_id=${encodeURIComponent(store.clientId)}&client_secret=${encodeURIComponent(store.clientSecret)}`;
        // Fetch orders
        const oRes = await fetch(`/api/shopify-orders?${q}`);
        if (!oRes.ok) { const e = await oRes.json().catch(() => ({})); errors.push(`${store.name}: ${e.error || oRes.status}`); continue; }
        const oData = await oRes.json();
        // Tag orders & products with store name
        for (const o of (oData.orders || [])) { o.storeName = store.name; }
        for (const p of (oData.products || [])) { p.storeName = store.name; }
        allOrders.push(...(oData.orders || []));
        allProducts.push(...(oData.products || []));
        // Fetch product list for mapping
        const pRes = await fetch(`/api/shopify-products?${q}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          const tagged = (pData.products || []).map(p => ({ ...p, storeName: store.name }));
          allShopifyProducts.push(...tagged);
        }
      }

      // Merge demand across stores (same product title from different stores = separate entries)
      setShopifyDemand({
        products: allProducts,
        orders: allOrders,
        totalOrders: allOrders.length,
        syncedAt: new Date().toISOString(),
        loading: false,
        error: errors.length ? errors.join("; ") : null,
        storeCount: stores.length,
      });
      setShopifyProducts(allShopifyProducts);
    } catch (e) {
      console.error("[Shopify] sync failed:", e);
      setShopifyDemand(prev => ({ ...prev, loading: false, error: e.message }));
    }
  };

  const fetchShopifySalesPrices = async () => {
    const stores = getShopifyStores();
    if (!stores.length) {
      setShopifySalesPrices({ products: [], error: "No Shopify stores configured." });
      return;
    }
    setShopifySalesPrices(prev => ({ ...(prev || {}), loading: true, error: null }));
    try {
      const allProducts = [];
      const errors = [];
      for (const store of stores) {
        if (!store.domain || !store.clientId || !store.clientSecret) { errors.push(`${store.name || "?"}: missing credentials`); continue; }
        const q = `domain=${encodeURIComponent(store.domain)}&client_id=${encodeURIComponent(store.clientId)}&client_secret=${encodeURIComponent(store.clientSecret)}`;
        const res = await fetch(`/api/shopify-sales-prices?${q}`);
        if (!res.ok) { const e = await res.json().catch(() => ({})); errors.push(`${store.name}: ${e.error || res.status}`); continue; }
        const data = await res.json();
        for (const p of (data.products || [])) { p.storeName = store.name; }
        allProducts.push(...(data.products || []));
      }
      setShopifySalesPrices({
        products: allProducts,
        loading: false,
        error: errors.length ? errors.join("; ") : null,
        syncedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[Shopify] sales prices fetch failed:", e);
      setShopifySalesPrices(prev => ({ ...(prev || {}), loading: false, error: e.message }));
    }
  };

  // Compute parts demand from Shopify orders + product mappings
  const computePartsDemand = () => {
    if (!shopifyDemand?.products) return [];
    const demand = {}; // { partId: { part, needed, products: [] } }
    for (const sp of shopifyDemand.products) {
      // Find BOM product linked to this Shopify product (by shopifyProductId or name match)
      const bomProduct = products.find(p =>
        p.shopifyProductId === sp.shopifyProductId ||
        sp.title.toLowerCase().includes(p.name.toLowerCase()) ||
        p.name.toLowerCase().includes(sp.title.toLowerCase())
      );
      if (!bomProduct) continue;
      const productParts = parts.filter(p => p.projectId === bomProduct.id);
      for (const part of productParts) {
        if (!demand[part.id]) demand[part.id] = { part, needed: 0, products: [] };
        demand[part.id].needed += (parseInt(part.quantity) || 1) * sp.totalUnfulfilled;
        demand[part.id].products.push({ name: bomProduct.name, color: bomProduct.color, qty: sp.totalUnfulfilled, perUnit: parseInt(part.quantity) || 1 });
      }
    }
    return Object.values(demand).sort((a, b) => {
      const aDeficit = a.needed - (parseInt(a.part.stockQty) || 0);
      const bDeficit = b.needed - (parseInt(b.part.stockQty) || 0);
      return bDeficit - aDeficit; // most urgent first
    });
  };

  const lowStockParts = parts.filter((p) => { const s=parseInt(p.stockQty)||0, r=parseInt(p.reorderQty); return !isNaN(r) && r > 0 && s <= r; });
  const unassignedCount = parts.filter((p) => !p.projectId).length;
  const purchaseOrders = buildPurchaseOrders(parts);
  const internalOrderCount = parts.filter(p => p.isInternal && (p.flaggedForOrder || (() => { const s=parseInt(p.stockQty),r=parseInt(p.reorderQty); return !isNaN(s)&&!isNaN(r)&&s<=r; })())).length;
  const poPartCount = Object.values(purchaseOrders).reduce((s,a)=>s+a.length,0) + internalOrderCount;
  const pricedCount = parts.filter((p) => p.pricingStatus === "done").length;

  const hasAnyKey = nexarToken || apiKeys.mouser_api_key || dkToken || apiKeys.arrow_api_key;

  const priceAtQty = (part) => {
    const pr = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
    if (!pr) return parseFloat(part.unitCost) || 0;
    const isUS = (sid, d) => { const c = d.country || DIST_COUNTRY[d.displayName] || DIST_COUNTRY[sid] || ""; return !c || c === "US"; };
    let entries = Object.entries(pr).filter(([,d]) => d.stock > 0);
    if (simUsOnly) entries = entries.filter(([sid, d]) => isUS(sid, d));
    if (!entries.length) return parseFloat(part.unitCost) || 0;
    const calc = (d) => { let p = d.unitPrice; if (d.priceBreaks?.length) { for (const pb of d.priceBreaks) { if (part.quantity >= pb.qty) p = pb.price; } } return parseFloat(p) || d.unitPrice; };
    // Prefer preferred distributors if within 5% of cheapest price
    let prefDists = [];
    try { prefDists = JSON.parse(apiKeys.preferred_distributors || '["mouser"]'); } catch { prefDists = ["mouser"]; }
    entries.sort((a,b) => (calc(a[1])||Infinity) - (calc(b[1])||Infinity));
    const cheapest = calc(entries[0][1]);
    const prefEntry = entries.find(([sid]) => prefDists.some(p => sid.toLowerCase().includes(p.toLowerCase())));
    if (prefEntry && calc(prefEntry[1]) <= cheapest * 1.05) return calc(prefEntry[1]);
    return cheapest;
  };

  // Inventory valuation — total $ value of all stock on hand
  const inventoryValue = parts.reduce((sum, p) => {
    const stockQty = parseInt(p.stockQty) || 0;
    if (stockQty <= 0) return sum;
    const cost = priceAtQty(p);
    return sum + (stockQty * cost);
  }, 0);
  const totalStockParts = parts.filter(p => (parseInt(p.stockQty) || 0) > 0).length;
  const totalStockUnits = parts.reduce((s, p) => s + (parseInt(p.stockQty) || 0), 0);

  const productCosts = products.map((prod) => {
    const pp = parts.filter((p) => p.projectId === prod.id);
    const total = pp.reduce((s,p) => s + priceAtQty(p) * p.quantity, 0);
    return { ...prod, total, partCount: pp.length, costedCount: pp.filter((p)=>p.unitCost || p.pricing).length };
  });

  // Show loading screen while initial DB fetch completes
  if (loading) return (
    <div style={{ minHeight:"100vh",background:"#f5f5f7",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14 }}>
      <div style={{ width:36,height:36,border:"3px solid #d2d2d7",borderTopColor:"#0071e3",borderRadius:"50%",animation:"spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",color:"#aeaeb2",fontSize:13 }}>Loading workspace…</div>
    </div>
  );

  // ─────────────────────────────────────────────
  // MOBILE VIEWS — render standalone when hash matches
  // ─────────────────────────────────────────────
  if (window.location.hash === "#build") return <BuildView />;
  if (window.location.hash === "#invoice") return <InvoiceView />;

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className={darkMode ? "dark" : ""} style={{ minHeight:"100vh", background:darkMode?"#000000":"#f5f5f7", color:darkMode?"#f5f5f7":"#1d1d1f",
      fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", display:"flex", flexDirection:"column", transition:"background 0.3s,color 0.3s" }}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={{ background:darkMode?"#1c1c1e":"#fff", borderBottom:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",
        padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between",
        height:58, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:34,height:34,background:"#0071e3",borderRadius:7,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontWeight:900,fontSize:14,color:"#fff",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>JA</div>
          <div>
            <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:800,fontSize:14,color:"#1d1d1f" }}>Jackson Audio</div>
            <div style={{ fontSize:9,color:"#aeaeb2",letterSpacing:"0.15em" }}>BOM MANAGER</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:20, alignItems:"center" }}>
          {[
            { label:"Parts Library", value:parts.length,   warn:false, nav:"bom" },
            { label:"Inventory", value:`$${fmtDollar(inventoryValue)}`, warn:false, nav:"bom", isCurrency:true },
            { label:"Priced",   value:pricedCount,    warn:false, nav:"pricing" },
            { label:"To Order", value:poPartCount,    warn:poPartCount>0, nav:"purchasing" },
            { label:"Low Stock",value:lowStockParts.length, warn:lowStockParts.length>0, nav:"alerts" },
          ].map((s) => (
            <div key={s.label} style={{ textAlign:"center", cursor:"pointer" }}
              onClick={() => setActiveView(s.nav)}>
              <div style={{ fontSize:17,fontWeight:700,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                color:s.warn&&s.value>0?"#ff3b30":"#0071e3" }}>{s.value}</div>
              <div style={{ fontSize:9,color:"#aeaeb2",letterSpacing:"0.08em" }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
          {/* API status indicator */}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <div style={{ width:8,height:8,borderRadius:"50%",
              background: tokenStatus==="ok" ? "#34c759" : tokenStatus==="loading" ? "#0071e3" : "#aeaeb2" }} />
            <span style={{ fontSize:10, color:"#aeaeb2" }}>
              {tokenStatus==="ok" ? "APIs live" : tokenStatus==="loading" ? "connecting…" : "no API keys"}
            </span>
          </div>
          {/* User + sign out */}
          <div style={{ display:"flex",alignItems:"center",gap:10,borderLeft:"1px solid #e5e5ea",paddingLeft:14 }}>
            <span style={{ fontSize:10,color:"#aeaeb2",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
              {user.email}
            </span>
            <button className="btn-ghost btn-sm" onClick={signOut}>Sign out</button>
            <button onClick={() => setDarkMode(!darkMode)} title={darkMode ? "Light mode" : "Dark mode"}
              style={{ background:"none",border:"none",cursor:"pointer",fontSize:16,padding:"4px 6px",
                borderRadius:6,transition:"background 0.15s",color:darkMode?"#f5f5f7":"#1d1d1f" }}
              onMouseOver={(e)=>e.target.style.background=darkMode?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.05)"}
              onMouseOut={(e)=>e.target.style.background="none"}>
              {darkMode ? "☀" : "☾"}
            </button>
          </div>
        </div>
      </header>

      {/* ── NAV ── */}
      <nav style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", padding:"0",
        borderBottom:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",
        background:darkMode?"#1c1c1e":"#fff" }}>
        {[
          { id:"dashboard", label:"Dashboard" },
          { id:"bom",       label:`Parts (${parts.length})` },
          { id:"scan",      label:"Scan In" },
          { id:"pricing",   label:`Pricing${pricedCount>0?` (${pricedCount}/${parts.length})`:""}` },
          { id:"purchasing",label:`Purchasing${buildQueue.length>0?` (${buildQueue.length})`:""}` },
          { id:"suppliers", label:"Suppliers" },
          { id:"orders",    label:`Orders${trackedOrders.length>0?` (${trackedOrders.length})`:""}` },
          { id:"demand",    label:`Demand${shopifyDemand?.totalOrders?` (${shopifyDemand.totalOrders})`:""}` },
          { id:"production",label:`Production${buildOrders.filter(b=>b.status!=="completed").length>0?` (${buildOrders.filter(b=>b.status!=="completed").length})`:""}` },
          { id:"scoreboard",label:"Scoreboard" },
          { id:"projects",  label:"Products" },
          { id:"alerts",    label:`Alerts${lowStockParts.length>0?` (${lowStockParts.length})`:""}` },
          { id:"settings",  label:"Settings" },
          { id:"admin",     label:"Admin" },
        ].map((tab) => (
          <button key={tab.id}
            className={`nav-btn ${activeView===tab.id?"active":""}`}
            onClick={() => setActiveView(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ flex:1, padding:"24px 28px", overflowY:"auto" }}>

        {/* ══════════════════════════════════════
            DASHBOARD — Overview & Key Metrics
        ══════════════════════════════════════ */}
        {activeView === "dashboard" && (
          <div style={{ maxWidth:1000 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:"#1d1d1f",marginBottom:4 }}>Dashboard</h2>
            <p style={{ fontSize:14,color:"#86868b",marginBottom:24 }}>Overview of your inventory, orders, and production status.</p>

            {/* ── Metric cards row */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:16,marginBottom:24 }}>
              {[
                { label:"Inventory Value", value:`$${fmtDollar(inventoryValue)}`, sub:`${totalStockParts} parts, ${totalStockUnits.toLocaleString()} units`, color:"#0071e3", nav:"bom" },
                { label:"Low Stock Alerts", value:lowStockParts.length, sub:lowStockParts.length>0?`${lowStockParts.slice(0,3).map(p=>p.mpn||p.reference).join(", ")}${lowStockParts.length>3?" ...":""}`:"All parts stocked", color:lowStockParts.length>0?"#ff3b30":"#34c759", nav:"alerts" },
                { label:"Parts to Order", value:poPartCount, sub:poPartCount>0?`across ${Object.keys(purchaseOrders).length} suppliers`:"No orders pending", color:poPartCount>0?"#ff9500":"#34c759", nav:"purchasing" },
                { label:"Products", value:products.length, sub:`${pricedCount}/${parts.length} parts priced`, color:"#5856d6", nav:"projects" },
              ].map((card) => (
                <div key={card.label} onClick={()=>setActiveView(card.nav)}
                  style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                    cursor:"pointer",transition:"transform 0.15s,box-shadow 0.15s",border:"1px solid #e5e5ea" }}
                  onMouseOver={(e)=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.1)"}}
                  onMouseOut={(e)=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.06)"}}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>{card.label}</div>
                  <div style={{ fontSize:28,fontWeight:800,color:card.color,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",letterSpacing:"-0.5px" }}>{card.value}</div>
                  <div style={{ fontSize:12,color:"#86868b",marginTop:4 }}>{card.sub}</div>
                </div>
              ))}
            </div>

            {/* ── Low stock table */}
            {lowStockParts.length > 0 && (
              <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Low Stock Parts</div>
                    <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>Parts at or below reorder point</div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={()=>setActiveView("alerts")}>View All</button>
                </div>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #e5e5ea" }}>
                      {["MPN","Description","Stock","Reorder Point","Deficit"].map(h=>(
                        <th key={h} style={{ textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:"#86868b",letterSpacing:"0.06em",textTransform:"uppercase",
                          fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockParts.slice(0,8).map((part)=>{
                      const s=parseInt(part.stockQty)||0, r=parseInt(part.reorderQty)||0;
                      return (
                        <tr key={part.id} style={{ borderBottom:"1px solid #f0f0f2" }}>
                          <td style={{ padding:"10px 12px",fontWeight:600,color:"#0071e3" }}>{part.mpn||part.reference||"—"}</td>
                          <td style={{ padding:"10px 12px",color:"#6e6e73" }}>{part.description||part.value||"—"}</td>
                          <td style={{ padding:"10px 12px",fontWeight:700,color:"#ff3b30" }}>{s}</td>
                          <td style={{ padding:"10px 12px" }}>{r}</td>
                          <td style={{ padding:"10px 12px",fontWeight:700,color:"#ff3b30" }}>−{r - s}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Top products by cost */}
            {productCosts.length > 0 && (
              <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Products</div>
                    <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>BOM cost per unit</div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={()=>setActiveView("projects")}>Manage</button>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:12 }}>
                  {productCosts.map((prod) => (
                    <div key={prod.id} style={{ padding:"14px 16px",borderRadius:10,border:"1px solid #e5e5ea",
                      cursor:"pointer",transition:"background 0.15s" }}
                      onClick={()=>setActiveView("projects")}
                      onMouseOver={(e)=>e.currentTarget.style.background="#f5f5f7"}
                      onMouseOut={(e)=>e.currentTarget.style.background="transparent"}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:6 }}>
                        <div style={{ width:8,height:8,borderRadius:"50%",background:prod.color }} />
                        <div style={{ fontSize:14,fontWeight:600,color:"#1d1d1f" }}>{prod.name}</div>
                      </div>
                      <div style={{ fontSize:22,fontWeight:800,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif" }}>${fmtDollar(prod.total)}</div>
                      <div style={{ fontSize:11,color:"#86868b",marginTop:2 }}>{prod.partCount} parts · {prod.costedCount} priced</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Product Cost Trends */}
            {productCosts.length > 0 && allPriceHistory.length > 0 && (() => {
              // Build earliest price per part from price history
              const earliestByPart = {};
              for (const row of allPriceHistory) {
                const pid = row.part_id;
                if (!earliestByPart[pid] || new Date(row.recorded_at) < new Date(earliestByPart[pid].recorded_at)) {
                  earliestByPart[pid] = row;
                }
              }
              const trends = productCosts.map(prod => {
                const pp = parts.filter(p => p.projectId === prod.id);
                const currentCost = prod.total;
                let earliestCost = 0;
                let hasHistory = false;
                for (const p of pp) {
                  const earliest = earliestByPart[p.id];
                  if (earliest) {
                    earliestCost += parseFloat(earliest.unit_price) * p.quantity;
                    hasHistory = true;
                  } else {
                    earliestCost += (parseFloat(p.unitCost) || 0) * p.quantity;
                  }
                }
                const pctChange = earliestCost > 0 ? ((currentCost - earliestCost) / earliestCost) * 100 : 0;
                return { ...prod, currentCost, earliestCost, pctChange, hasHistory };
              }).filter(t => t.hasHistory);
              if (trends.length === 0) return null;
              return (
                <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                  <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",marginBottom:4,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Product Cost Trends</div>
                  <div style={{ fontSize:12,color:"#86868b",marginBottom:14 }}>Current BOM cost vs earliest recorded prices</div>
                  <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                    {trends.map(t => (
                      <div key={t.id} style={{ padding:"12px 16px",borderRadius:10,border:"1px solid #e5e5ea",minWidth:200,flex:1,maxWidth:300 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6 }}>
                          <div style={{ width:8,height:8,borderRadius:"50%",background:t.color }} />
                          <span style={{ fontSize:13,fontWeight:600,color:"#1d1d1f" }}>{t.name}</span>
                        </div>
                        <div style={{ fontSize:18,fontWeight:700,color:"#1d1d1f" }}>
                          ${fmtDollar(t.currentCost)}
                          {t.pctChange !== 0 && (
                            <span style={{ fontSize:12,fontWeight:600,marginLeft:8,
                              color:t.pctChange > 0 ? "#ff3b30" : "#34c759" }}>
                              {t.pctChange > 0 ? "\u2191" : "\u2193"} {Math.abs(t.pctChange).toFixed(1)}%
                            </span>
                          )}
                        </div>
                        {t.pctChange !== 0 && (
                          <div style={{ fontSize:11,color:"#86868b",marginTop:2 }}>
                            from ${fmtDollar(t.earliestCost)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── Inventory Value Over Time (from BOM snapshots) */}
            {bomSnapshots.length >= 2 && (() => {
              const chartData = bomSnapshots
                .filter(s => s.snapshot && s.snapshot.inventoryValue != null)
                .map(s => ({
                  recorded_at: s.created_at,
                  unit_price: s.snapshot.inventoryValue,
                  supplier: s.snapshot.product_id ? (products.find(p => p.id === s.snapshot.product_id)?.name || "Product") : "All Products",
                  source: `${(s.snapshot.parts || []).length} parts`,
                }))
                .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));
              if (chartData.length < 2) return null;
              return (
                <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                  <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:4,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Inventory Value Over Time</div>
                  <div style={{ fontSize:12,color:"#86868b",marginBottom:14 }}>Total inventory value from BOM snapshots</div>
                  <PriceChart data={chartData} darkMode={darkMode} height={240} />
                </div>
              );
            })()}

            {/* ── Build queue */}
            {buildQueue.length > 0 && (
              <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",marginBottom:14,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Build Queue</div>
                <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                  {buildQueue.map((q) => (
                    <div key={q.productId} style={{ padding:"12px 18px",borderRadius:10,border:"1px solid #e5e5ea",
                      display:"flex",alignItems:"center",gap:10 }}>
                      <div style={{ width:8,height:8,borderRadius:"50%",background:q.color }} />
                      <div>
                        <div style={{ fontSize:14,fontWeight:600,color:"#1d1d1f" }}>{q.name}</div>
                        <div style={{ fontSize:12,color:"#86868b" }}>Qty: {q.qty}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── PO History Summary */}
            {trackedOrders.length > 0 && (
              <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>PO History</div>
                    <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>Recent purchase orders</div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={()=>setActiveView("orders")}>View All</button>
                </div>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #e5e5ea" }}>
                      {["Supplier","PO #","Date","Items","Total","Status"].map(h=>(
                        <th key={h} style={{ textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:"#86868b",letterSpacing:"0.06em",textTransform:"uppercase",
                          fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trackedOrders.slice(0,6).map((order) => {
                      const itemCount = (order.items || []).length;
                      const totalValue = order.totalEstimate || (order.items || []).reduce((s,i) => s + (parseFloat(i.price)||0) * (parseInt(i.quantity)||0), 0);
                      const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "—";
                      const statusColors = { submitted:"#ff9500", shipped:"#0071e3", delivered:"#34c759", received:"#34c759", cancelled:"#ff3b30" };
                      return (
                        <tr key={order.id} style={{ borderBottom:"1px solid #f0f0f2" }}>
                          <td style={{ padding:"10px 12px",fontWeight:600 }}>
                            <span style={{ color:order.supplierColor || "#1d1d1f" }}>{order.supplier || "—"}</span>
                          </td>
                          <td style={{ padding:"10px 12px",color:"#6e6e73",fontFamily:"monospace",fontSize:12 }}>{order.poNumber || "—"}</td>
                          <td style={{ padding:"10px 12px",color:"#6e6e73" }}>{dateStr}</td>
                          <td style={{ padding:"10px 12px",color:"#6e6e73" }}>{itemCount} item{itemCount !== 1 ? "s" : ""}</td>
                          <td style={{ padding:"10px 12px",fontWeight:600,color:"#1d1d1f" }}>{totalValue > 0 ? `$${fmtDollar(totalValue)}` : "—"}</td>
                          <td style={{ padding:"10px 12px" }}>
                            <span style={{ display:"inline-block",padding:"2px 10px",borderRadius:980,fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",
                              background:`${statusColors[order.status] || "#86868b"}18`,color:statusColors[order.status] || "#86868b" }}>
                              {order.status || "unknown"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Aging Inventory */}
            {(() => {
              const now = Date.now();
              const AGING_DAYS = 90;
              const agingParts = parts.filter(p => {
                const stock = parseInt(p.stockQty) || 0;
                if (stock <= 0) return false;
                if (!p.updatedAt) return false;
                const age = Math.floor((now - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
                return age >= AGING_DAYS;
              }).map(p => ({
                ...p,
                ageDays: Math.floor((now - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
              })).sort((a,b) => b.ageDays - a.ageDays);

              if (agingParts.length === 0) return null;
              return (
                <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:"1px solid #e5e5ea" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Aging Inventory</div>
                      <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>Parts with stock not updated in 90+ days</div>
                    </div>
                    <span style={{ fontSize:12,fontWeight:600,color:"#ff9500" }}>{agingParts.length} part{agingParts.length !== 1 ? "s" : ""}</span>
                  </div>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:"2px solid #e5e5ea" }}>
                        {["MPN","Description","Stock","Age (days)","Last Updated"].map(h=>(
                          <th key={h} style={{ textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:"#86868b",letterSpacing:"0.06em",textTransform:"uppercase",
                            fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {agingParts.slice(0,10).map((p)=>(
                        <tr key={p.id} style={{ borderBottom:"1px solid #f0f0f2" }}>
                          <td style={{ padding:"10px 12px",fontWeight:600,color:"#0071e3" }}>{p.mpn||p.reference||"—"}</td>
                          <td style={{ padding:"10px 12px",color:"#6e6e73" }}>{p.description||p.value||"—"}</td>
                          <td style={{ padding:"10px 12px",fontWeight:600 }}>{parseInt(p.stockQty)||0}</td>
                          <td style={{ padding:"10px 12px",fontWeight:700,color:p.ageDays>=180?"#ff3b30":p.ageDays>=120?"#ff9500":"#86868b" }}>{p.ageDays}</td>
                          <td style={{ padding:"10px 12px",color:"#86868b",fontSize:12 }}>{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* ── Quick Actions */}
            <div style={{ background:"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:"1px solid #e5e5ea" }}>
              <div style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",marginBottom:14,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Quick Actions</div>
              <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                <button className="btn-primary" onClick={()=>{setActiveView("bom");setShowImport(true);}}>Import BOM</button>
                <button className="btn-primary" style={{ background:"#5856d6" }} onClick={()=>setActiveView("scan")}>Scan Parts</button>
                <button className="btn-ghost" onClick={()=>setActiveView("purchasing")}>View Purchase Orders</button>
                <button className="btn-ghost" onClick={() => {
                  // Export full inventory report
                  const header = ["Product","MPN","Reference","Value","Description","Manufacturer","Qty/Build","Stock","Reorder","Unit Cost","Stock Value","Supplier"].join(",");
                  const rows = parts.map(p => {
                    const stock = parseInt(p.stockQty)||0;
                    const cost = priceAtQty(p);
                    const prodName = products.find(x=>x.id===p.projectId)?.name || "Unassigned";
                    return [`"${prodName}"`,p.mpn||"",p.reference||"",p.value||"",`"${(p.description||"").replace(/"/g,"'")}"`,p.manufacturer||"",p.quantity,stock,p.reorderQty||"",cost?fmtPrice(cost):"",stock*cost?(stock*cost).toFixed(2):"",p.preferredSupplier||""].join(",");
                  });
                  const blob = new Blob([[header,...rows].join("\n")],{type:"text/csv"});
                  const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
                  a.download=`full-bom-report-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                }}>
                  Export Full Report (CSV)
                </button>
                <button className="btn-ghost" onClick={async () => {
                  // Save BOM snapshot to database
                  const snapshot = {
                    date: new Date().toISOString(),
                    product_id: null,
                    products: products.map(p => ({ id:p.id, name:p.name })),
                    parts: parts.map(p => ({ id:p.id, mpn:p.mpn, reference:p.reference, value:p.value, description:p.description,
                      quantity:p.quantity, stockQty:p.stockQty, unitCost:p.unitCost, projectId:p.projectId, manufacturer:p.manufacturer })),
                    inventoryValue,
                  };
                  const label = `Snapshot — ${parts.length} parts, $${fmtDollar(inventoryValue)}`;
                  try {
                    const saved = await saveBomSnapshot(label, snapshot, user.id);
                    setBomSnapshots(prev => [saved, ...prev].slice(0, 50));
                    alert(`BOM snapshot saved to database (${snapshot.parts.length} parts, $${fmtDollar(inventoryValue)} inventory)`);
                  } catch (e) {
                    alert("Snapshot save failed: " + e.message);
                  }
                }}>
                  Save BOM Snapshot
                </button>
              </div>
            </div>

            {/* ── BOM History (always visible) ── */}
            <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:24,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                  onClick={() => setBomHistoryOpen(!bomHistoryOpen)}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>BOM Version History</div>
                    <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>{bomSnapshots.length} saved snapshot{bomSnapshots.length!==1?"s":""}</div>
                  </div>
                  <span style={{ fontSize:14,color:"#86868b",transform:bomHistoryOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s" }}>{"\u25BC"}</span>
                </div>
                {bomHistoryOpen && (
                  <div style={{ marginTop:16 }}>
                    {bomSnapshots.length === 0 && (
                      <div style={{ textAlign:"center",padding:"30px 20px",color:"#86868b",fontSize:13 }}>
                        No snapshots saved yet. Click "Save BOM Snapshot" above to capture a version of your current BOM.
                      </div>
                    )}
                    {bomSnapshots.length > 0 && <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                      <thead>
                        <tr style={{ borderBottom:"2px solid " + (darkMode?"#3a3a3e":"#e5e5ea") }}>
                          {["Date","Label","Scope","Parts","Inventory Value",""].map(h=>(
                            <th key={h} style={{ textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:"#86868b",letterSpacing:"0.06em",textTransform:"uppercase",
                              fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bomSnapshots.map((snap, idx) => {
                          const s = snap.snapshot || {};
                          const snapParts = s.parts || [];
                          const snapValue = s.inventoryValue || snapParts.reduce((sum, p) => sum + (parseFloat(p.unitCost)||0) * (parseInt(p.stockQty)||0), 0);
                          const dateStr = new Date(snap.created_at).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" });
                          const isComparing = bomCompareIdx === idx;
                          return (
                            <tr key={snap.id} style={{ borderBottom:"1px solid " + (darkMode?"#2c2c2e":"#f0f0f2") }}>
                              <td style={{ padding:"10px 12px",fontSize:12,color:darkMode?"#e2e8f0":"#1d1d1f" }}>{dateStr}</td>
                              <td style={{ padding:"10px 12px",fontSize:12,color:darkMode?"#e2e8f0":"#1d1d1f",fontWeight:600 }}>{snap.label || "Untitled"}</td>
                              <td style={{ padding:"10px 12px",fontSize:12 }}>
                                {s.product_id
                                  ? <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"rgba(88,86,214,0.1)",color:"#5856d6" }}>
                                      {(s.products && s.products[0]?.name) || "Product"}
                                    </span>
                                  : <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"rgba(0,113,227,0.08)",color:"#0071e3" }}>
                                      All Products
                                    </span>}
                              </td>
                              <td style={{ padding:"10px 12px",fontSize:12,color:"#86868b" }}>{snapParts.length}</td>
                              <td style={{ padding:"10px 12px",fontSize:12,color:"#34c759",fontWeight:600 }}>${fmtDollar(snapValue)}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right" }}>
                                <button className="btn-ghost btn-sm" style={{ fontSize:11 }}
                                  onClick={() => setBomCompareIdx(isComparing ? null : idx)}>
                                  {isComparing ? "Close" : "Compare"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>}

                    {/* Comparison diff view */}
                    {bomCompareIdx !== null && bomSnapshots[bomCompareIdx] && (() => {
                      const snap = bomSnapshots[bomCompareIdx].snapshot || {};
                      const snapParts = snap.parts || [];
                      const currentMpns = new Set(parts.map(p => p.mpn).filter(Boolean));
                      const snapMpns = new Set(snapParts.map(p => p.mpn).filter(Boolean));
                      const added = parts.filter(p => p.mpn && !snapMpns.has(p.mpn));
                      const removed = snapParts.filter(p => p.mpn && !currentMpns.has(p.mpn));
                      const changed = [];
                      for (const cp of parts) {
                        if (!cp.mpn) continue;
                        const sp = snapParts.find(s => s.mpn === cp.mpn);
                        if (!sp) continue;
                        const qtyDiff = (parseInt(cp.quantity)||0) !== (parseInt(sp.quantity)||0);
                        const stockDiff = (parseInt(cp.stockQty)||0) !== (parseInt(sp.stockQty)||0);
                        const priceDiff = (parseFloat(cp.unitCost)||0).toFixed(4) !== (parseFloat(sp.unitCost)||0).toFixed(4);
                        if (qtyDiff || stockDiff || priceDiff) {
                          changed.push({ mpn: cp.mpn,
                            oldQty: sp.quantity, newQty: cp.quantity,
                            oldStock: sp.stockQty, newStock: cp.stockQty,
                            oldPrice: sp.unitCost, newPrice: cp.unitCost,
                            qtyDiff, stockDiff, priceDiff });
                        }
                      }
                      return (
                        <div style={{ marginTop:16,padding:16,background:darkMode?"#2c2c2e":"#f9f9fb",borderRadius:10,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                          <div style={{ fontWeight:700,fontSize:14,marginBottom:12,color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                            Changes since "{bomSnapshots[bomCompareIdx].label || "Snapshot"}"
                          </div>
                          {added.length === 0 && removed.length === 0 && changed.length === 0 && (
                            <div style={{ fontSize:13,color:"#86868b" }}>No differences found.</div>
                          )}
                          {added.length > 0 && (
                            <div style={{ marginBottom:12 }}>
                              <div style={{ fontSize:11,fontWeight:700,color:"#34c759",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6 }}>Added ({added.length})</div>
                              {added.slice(0, 20).map(p => (
                                <div key={p.id} style={{ fontSize:12,color:darkMode?"#e2e8f0":"#1d1d1f",padding:"3px 0" }}>+ {p.mpn} {p.value ? `(${p.value})` : ""}</div>
                              ))}
                              {added.length > 20 && <div style={{ fontSize:11,color:"#86868b" }}>...and {added.length - 20} more</div>}
                            </div>
                          )}
                          {removed.length > 0 && (
                            <div style={{ marginBottom:12 }}>
                              <div style={{ fontSize:11,fontWeight:700,color:"#ff3b30",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6 }}>Removed ({removed.length})</div>
                              {removed.slice(0, 20).map(p => (
                                <div key={p.id || p.mpn} style={{ fontSize:12,color:darkMode?"#e2e8f0":"#1d1d1f",padding:"3px 0" }}>- {p.mpn} {p.value ? `(${p.value})` : ""}</div>
                              ))}
                              {removed.length > 20 && <div style={{ fontSize:11,color:"#86868b" }}>...and {removed.length - 20} more</div>}
                            </div>
                          )}
                          {changed.length > 0 && (
                            <div>
                              <div style={{ fontSize:11,fontWeight:700,color:"#ff9500",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6 }}>Changed ({changed.length})</div>
                              {changed.slice(0, 30).map(c => (
                                <div key={c.mpn} style={{ fontSize:12,color:darkMode?"#e2e8f0":"#1d1d1f",padding:"3px 0" }}>
                                  {c.mpn}:
                                  {c.qtyDiff && <span style={{ color:"#0071e3" }}> qty {c.oldQty}{"\u2192"}{c.newQty}</span>}
                                  {c.stockDiff && <span style={{ color:"#ff9500" }}> stock {c.oldStock}{"\u2192"}{c.newStock}</span>}
                                  {c.priceDiff && <span style={{ color:"#5856d6" }}> price ${parseFloat(c.oldPrice||0).toFixed(4)}{"\u2192"}${parseFloat(c.newPrice||0).toFixed(4)}</span>}
                                </div>
                              ))}
                              {changed.length > 30 && <div style={{ fontSize:11,color:"#86868b" }}>...and {changed.length - 30} more</div>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            SCAN — QR/Barcode Scanner
        ══════════════════════════════════════ */}
        {activeView === "scan" && (
          <div>
            <ScannerView parts={parts} products={products} updatePart={updatePart} darkMode={darkMode} />

            {/* ── Invoice Scanning Section */}
            <div style={{ maxWidth:600,margin:"20px auto 0" }}>
              <div style={{ borderTop:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",paddingTop:24,marginTop:8 }}>
                <h3 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
                  fontSize:20,fontWeight:700,letterSpacing:"-0.3px",color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:4 }}>
                  Invoice Scanner
                </h3>
                <p style={{ fontSize:13,color:"#86868b",marginBottom:16 }}>
                  Upload or photograph a supplier invoice — AI extracts all parts, quantities, and prices.
                </p>
                <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:16 }}>
                  <label style={{ display:"inline-flex",alignItems:"center",gap:8,padding:"10px 20px",borderRadius:980,
                    fontSize:13,fontWeight:600,cursor:"pointer",border:"none",background:"#5856d6",color:"#fff",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                    {invoiceParsing ? "Parsing…" : "Upload Invoice"}
                    <input type="file" accept=".pdf,.csv,.txt,.tsv,.png,.jpg,.jpeg,.gif,.webp,image/*" style={{ display:"none" }}
                      onChange={(e) => { const f = e.target.files[0]; if (f) parseInvoice(f); e.target.value=""; }}
                      disabled={invoiceParsing} />
                  </label>
                  <button onClick={captureInvoiceFromCamera}
                    disabled={invoiceParsing || invoiceScanning}
                    style={{ padding:"10px 20px",borderRadius:980,fontSize:13,fontWeight:600,cursor:"pointer",
                      border:"none",background:"#34c759",color:"#fff",
                      fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                      opacity:(invoiceParsing||invoiceScanning)?0.5:1 }}>
                    Scan Invoice
                  </button>
                </div>

                {/* Camera viewfinder */}
                {invoiceScanning && (
                  <div style={{ marginBottom:16,borderRadius:16,overflow:"hidden",background:"#000",position:"relative" }}>
                    <video ref={invoiceCamRef} style={{ width:"100%",maxHeight:300,objectFit:"cover" }} playsInline muted />
                    <div style={{ position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",display:"flex",gap:10 }}>
                      <button onClick={snapInvoicePhoto}
                        style={{ width:56,height:56,borderRadius:"50%",border:"3px solid #fff",background:"rgba(255,255,255,0.3)",
                          cursor:"pointer",fontSize:20,display:"flex",alignItems:"center",justifyContent:"center" }}>
                        📸
                      </button>
                      <button onClick={cancelInvoiceScan}
                        style={{ padding:"10px 20px",borderRadius:980,border:"none",background:"rgba(255,59,48,0.9)",
                          color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Error/success */}
                {invoiceError && (
                  <div style={{ background:darkMode?"#3a1c1c":"#fff2f2",border:`1px solid ${darkMode?"#ff453a":"#ffccc7"}`,borderRadius:10,
                    padding:"12px 16px",marginBottom:12,fontSize:12,color:"#ff3b30",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span>{invoiceError}</span>
                    <button onClick={()=>setInvoiceError("")} style={{ background:"none",border:"none",cursor:"pointer",color:"#ff3b30",fontSize:14 }}>✕</button>
                  </div>
                )}

                {/* Results */}
                {invoiceResult && (
                  <div style={{ background:darkMode?"#1c1c1e":"#fff",border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",borderRadius:12,overflow:"hidden",marginBottom:16 }}>
                    <div style={{ background:"#5856d6",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div>
                        <div style={{ fontWeight:700,fontSize:13,color:"#fff" }}>{invoiceResult.fileName}</div>
                        <div style={{ fontSize:11,color:"rgba(255,255,255,0.7)",marginTop:2 }}>
                          {invoiceResult.items.length} items · {invoiceResult.items.filter(i=>i.matchedPart).length} matched
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:8 }}>
                        <button onClick={applyInvoiceResults}
                          style={{ padding:"6px 14px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:"#34c759",color:"#fff" }}>
                          Apply {invoiceResult.items.filter(i=>i.apply).length}
                        </button>
                        <button onClick={()=>setInvoiceResult(null)}
                          style={{ padding:"6px 14px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff" }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                    {invoiceResult.items.map((item, idx) => (
                      <div key={idx} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 16px",
                        borderBottom:darkMode?"1px solid #2c2c2e":"1px solid #f0f0f2",fontSize:13 }}>
                        <input type="checkbox" checked={item.apply}
                          onChange={()=>setInvoiceResult(prev=>({...prev,items:prev.items.map((it,i)=>i===idx?{...it,apply:!it.apply}:it)}))}
                          style={{ width:16,height:16,cursor:"pointer",accentColor:"#5856d6",flexShrink:0 }} />
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ fontWeight:600 }}>{item.mpn||"—"}</div>
                          <div style={{ fontSize:11,color:"#86868b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{item.description||""}</div>
                        </div>
                        <div style={{ fontWeight:600,minWidth:40,textAlign:"right" }}>×{item.quantity}</div>
                        {item.unitPrice > 0 && <div style={{ color:"#34c759",fontWeight:600,minWidth:60,textAlign:"right" }}>${fmtPrice(item.unitPrice)}</div>}
                        <div style={{ fontSize:11,minWidth:70 }}>
                          {item.matchedPart
                            ? <span style={{ color:"#34c759" }}>✓ Matched</span>
                            : <select style={{ fontSize:10,padding:"2px 4px",borderRadius:4,border:"1px solid #d2d2d7" }}
                                value={item.manualMatch || ""}
                                onChange={(e) => {
                                  const partId = e.target.value;
                                  const matched = partId ? parts.find(p=>p.id===partId) : null;
                                  setInvoiceResult(prev=>({...prev,items:prev.items.map((it,i)=>i===idx?{...it,matchedPart:matched,manualMatch:partId,apply:!!matched}:it)}));
                                }}>
                                <option value="">New part</option>
                                {parts.map(p=><option key={p.id} value={p.id}>{p.mpn||p.reference}</option>)}
                              </select>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            IMPORT
        ══════════════════════════════════════ */}
        {activeView === "import" && (
          <div style={{ maxWidth:760 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:21,fontWeight:800,marginBottom:6 }}>Import Bill of Materials</h2>
            <p style={{ color:"#86868b",fontSize:13,marginBottom:24 }}>CSV/TSV from KiCad, Altium, Eagle, or paste directly.</p>

            <div className={`drop-zone ${dragOver?"drag-over":""}`}
              onDragOver={(e)=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={handleDrop}
              onClick={()=>fileRef.current.click()}>
              <div style={{ fontSize:34,marginBottom:10 }}>📋</div>
              <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:14,marginBottom:6 }}>Drop BOM file here</div>
              <div style={{ color:"#aeaeb2",fontSize:12 }}>CSV · TSV · TXT — or click to browse</div>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display:"none" }} onChange={handleFilePick} />
            </div>

            <div style={{ display:"flex",alignItems:"center",gap:14,margin:"20px 0" }}>
              <div style={{ flex:1,height:1,background:"#f5f5f7" }} />
              <span style={{ color:"#aeaeb2",fontSize:12 }}>or paste directly</span>
              <div style={{ flex:1,height:1,background:"#f5f5f7" }} />
            </div>

            <textarea rows={8} placeholder={"PN,QTY,DESC\nCRCW060310K0FKEA,4,Resistor 10k 0603\nGRM188R71C104KA01D,2,Cap 100nF 0402\nLM358DR,1,Op-Amp SOIC-8\n\n— or full BOM with headers —\nReference,Value,MPN,Quantity"}
              value={pasteText} onChange={(e)=>setPasteText(e.target.value)}
              style={{ width:"100%",padding:"12px",borderRadius:8,fontSize:12,lineHeight:1.7,resize:"vertical",border:"1px solid #e5e5ea" }} />
            <div style={{ display:"flex",gap:10,marginTop:12 }}>
              <button className="btn-primary" onClick={()=>handleImport(pasteText)}>↑ Parse & Import</button>
              <button className="btn-ghost" onClick={()=>setPasteText("")}>Clear</button>
            </div>

            {importError && <div style={{ marginTop:14,padding:"11px 16px",background:"rgba(255,59,48,0.06)",border:"1px solid #ff3b30",borderRadius:8,color:"#ff3b30",fontSize:13 }}>⚠ {importError}</div>}
            {importOk    && <div style={{ marginTop:14,padding:"11px 16px",background:"rgba(52,199,89,0.06)",border:"1px solid #34c759",borderRadius:8,color:"#34c759",fontSize:13 }}>{importOk}</div>}
          </div>
        )}

        {/* ══════════════════════════════════════
            PARTS LIBRARY
        ══════════════════════════════════════ */}
        {activeView === "bom" && (
          <div>
            {/* ── Inventory Valuation Summary */}
            {parts.length > 0 && (
              <div style={{ display:"flex",gap:20,marginBottom:16,padding:"16px 20px",
                background:"#fff",borderRadius:12,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                flexWrap:"wrap",alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase" }}>Inventory Value</div>
                  <div style={{ fontSize:24,fontWeight:800,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",letterSpacing:"-0.5px" }}>
                    ${fmtDollar(inventoryValue)}
                  </div>
                </div>
                <div style={{ borderLeft:"1px solid #e5e5ea",paddingLeft:20 }}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase" }}>Parts in Stock</div>
                  <div style={{ fontSize:20,fontWeight:700,color:"#1d1d1f" }}>{totalStockParts}</div>
                </div>
                <div style={{ borderLeft:"1px solid #e5e5ea",paddingLeft:20 }}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase" }}>Total Units</div>
                  <div style={{ fontSize:20,fontWeight:700,color:"#1d1d1f" }}>{totalStockUnits.toLocaleString()}</div>
                </div>
                <div style={{ borderLeft:"1px solid #e5e5ea",paddingLeft:20 }}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase" }}>Low Stock</div>
                  <div style={{ fontSize:20,fontWeight:700,color:lowStockParts.length>0?"#ff3b30":"#34c759" }}>{lowStockParts.length}</div>
                </div>
                <div style={{ marginLeft:"auto",textAlign:"right" }}>
                  <button className="btn-ghost btn-sm" onClick={() => {
                    const header = ["MPN","Reference","Value","Description","Manufacturer","Qty per Build","Stock","Reorder Point","Unit Cost","Stock Value","Product"].join(",");
                    const rows = parts.map(p => {
                      const stock = parseInt(p.stockQty)||0;
                      const cost = priceAtQty(p);
                      const prodName = products.find(x=>x.id===p.projectId)?.name || "";
                      return [p.mpn,p.reference,p.value,`"${(p.description||"").replace(/"/g,"'")}"`,p.manufacturer,p.quantity,stock,p.reorderQty||"",cost?fmtPrice(cost):"",stock*cost?(stock*cost).toFixed(2):"",`"${prodName}"`].join(",");
                    });
                    const blob = new Blob([[header,...rows].join("\n")],{type:"text/csv"});
                    const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
                    a.download=`inventory-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                  }}>
                    Export CSV
                  </button>
                </div>
              </div>
            )}

            {/* ── Toolbar */}
            <div style={{ display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center" }}>
              <div style={{ position:"relative",width:220 }}>
                <input type="text" placeholder="Search ref, value, MPN…"
                  value={search} onChange={(e)=>setSearch(e.target.value)}
                  style={{ padding:"5px 10px",paddingRight:search?24:10,borderRadius:5,width:"100%",fontSize:12,boxSizing:"border-box" }} />
                {search && <span onClick={()=>setSearch("")} style={{ position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",cursor:"pointer",fontSize:14,color:"#86868b",lineHeight:1 }}>✕</span>}
              </div>
              <select value={selProject} onChange={(e)=>setSelProject(e.target.value)}
                style={{ padding:"5px 8px",borderRadius:5,fontSize:12 }}>
                <option value="all">All Products</option>
                <option value="unassigned">Unassigned</option>
                {products.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span style={{ color:"#aeaeb2",fontSize:12,marginLeft:"auto" }}>{visibleParts.length}/{parts.length} parts</span>
              <button className="btn-ghost btn-sm" onClick={()=>setShowImport(!showImport)}>{showImport ? "Close Import" : "+ Import"}</button>
              <button className="btn-ghost btn-sm" onClick={()=>setShowResGen(!showResGen)} style={{ color:"#5856d6" }}>{showResGen ? "Close Component Library" : "Component Library"}</button>
            </div>

            {/* ── Inline Import Section */}
            {showImport && (
              <div style={{ marginBottom:12,padding:"16px 20px",background:"#fff",borderRadius:10,border:"1px solid #e5e5ea",boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize:14,fontWeight:700,marginBottom:8 }}>Import Bill of Materials</div>
                <p style={{ color:"#86868b",fontSize:12,marginBottom:12 }}>CSV/TSV from KiCad, Altium, Eagle, or paste directly.</p>
                <div className={`drop-zone ${dragOver?"drag-over":""}`}
                  onDragOver={(e)=>{e.preventDefault();setDragOver(true);}}
                  onDragLeave={()=>setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={()=>fileRef.current.click()}
                  style={{ padding:"24px 16px",marginBottom:10 }}>
                  <div style={{ fontWeight:700,fontSize:13,marginBottom:4 }}>Drop BOM file here</div>
                  <div style={{ color:"#aeaeb2",fontSize:11 }}>CSV · TSV · TXT — or click to browse</div>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display:"none" }} onChange={handleFilePick} />
                </div>
                <textarea placeholder="Or paste BOM text here…" value={pasteText} onChange={(e)=>setPasteText(e.target.value)}
                  style={{ width:"100%",minHeight:60,padding:"8px 12px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,resize:"vertical",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8 }} />
                {pasteText.trim() && (
                  <div style={{ display:"flex",gap:8 }}>
                    <button className="btn-primary" style={{ fontSize:12 }} onClick={()=>handleImport(pasteText)}>Parse & Import</button>
                    <button className="btn-ghost" style={{ fontSize:12 }} onClick={()=>setPasteText("")}>Clear</button>
                  </div>
                )}
                {importError && <div style={{ marginTop:8,color:"#ff3b30",fontSize:12 }}>{importError}</div>}
                {importOk && <div style={{ marginTop:8,color:"#34c759",fontSize:12 }}>{importOk}</div>}
              </div>
            )}

            {/* ── Component Library Generator */}
            {showResGen && (() => {
              const E96 = [100,102,105,107,110,113,115,118,121,124,127,130,133,137,140,143,147,150,154,158,162,165,169,174,178,182,187,191,196,200,205,210,215,221,226,232,237,243,249,255,261,267,274,280,287,294,301,309,316,324,332,340,348,357,365,374,383,392,402,412,422,432,442,453,464,475,487,499,511,523,536,549,562,576,590,604,619,634,649,665,681,698,715,732,750,768,787,806,825,845,866,887,909,931,953,976];
              const decadeLabels = ["1\u03A9\u20139.76\u03A9","10\u03A9\u201397.6\u03A9","100\u03A9\u2013976\u03A9","1k\u03A9\u20139.76k\u03A9","10k\u03A9\u201397.6k\u03A9","100k\u03A9\u2013976k\u03A9","1M\u03A9\u20139.76M\u03A9"];
              const fmtRes = (ohms) => {
                if (ohms >= 1000000) { const v = ohms/1000000; return (Number.isInteger(v)?v:v.toFixed(v<10?2:1).replace(/0+$/,"").replace(/\.$/,""))+"M\u03A9"; }
                if (ohms >= 1000) { const v = ohms/1000; return (Number.isInteger(v)?v:v.toFixed(v<10?2:1).replace(/0+$/,"").replace(/\.$/,""))+"k\u03A9"; }
                const v = ohms; return (Number.isInteger(v)?v:v.toFixed(v<10?2:1).replace(/0+$/,"").replace(/\.$/,""))+"\u03A9";
              };
              const generateParts = () => {
                const result = [];
                for (let mult = 0; mult <= 6; mult++) {
                  if (!resGenCfg.decades[mult]) continue;
                  for (const base of E96) {
                    const code = String(base) + String(mult);
                    const mpn = resGenCfg.prefix + code + resGenCfg.suffix;
                    const ohms = base * Math.pow(10, mult - 2); // base=100 means 1.00, mult=0 → ×10^-2 → 1Ω; mult=2 → ×10^0 → 100Ω
                    const value = fmtRes(ohms);
                    result.push({ mpn, value, description: resGenCfg.descPrefix + " " + value, manufacturer: resGenCfg.manufacturer, quantity: 1, product_id: null });
                  }
                }
                return result;
              };
              const genParts = generateParts();
              const selectedCount = Object.values(resGenCfg.decades).filter(Boolean).length;
              return (
                <div style={{ marginBottom:12,padding:"16px 20px",background:"#fff",borderRadius:10,border:"1px solid #d5d0f0",boxShadow:"0 1px 4px rgba(88,86,214,0.1)" }}>
                  <div style={{ fontSize:14,fontWeight:700,marginBottom:4,color:"#5856d6" }}>Component Library Generator</div>
                  <div style={{ display:"flex",gap:4,marginBottom:14 }}>
                    {[{id:"resistor",label:"Resistors (E96)"},{id:"capacitor",label:"Capacitors (E12)"}].map(t=>(
                      <button key={t.id} onClick={()=>setCompGenType(t.id)}
                        style={{ padding:"5px 14px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",
                          background:compGenType===t.id?"#5856d6":"#f0f0f2",color:compGenType===t.id?"#fff":"#86868b" }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {compGenType === "resistor" && <><div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:14 }}>
                    <div style={{ flex:"1 1 140px" }}>
                      <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>MPN Prefix</div>
                      <input type="text" value={resGenCfg.prefix} onChange={e=>setResGenCfg(c=>({...c,prefix:e.target.value}))}
                        style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                    </div>
                    <div style={{ flex:"0 0 80px" }}>
                      <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>MPN Suffix</div>
                      <input type="text" value={resGenCfg.suffix} onChange={e=>setResGenCfg(c=>({...c,suffix:e.target.value}))}
                        style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                    </div>
                    <div style={{ flex:"1 1 120px" }}>
                      <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Manufacturer</div>
                      <input type="text" value={resGenCfg.manufacturer} onChange={e=>setResGenCfg(c=>({...c,manufacturer:e.target.value}))}
                        style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                    </div>
                    <div style={{ flex:"2 1 200px" }}>
                      <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Description Prefix</div>
                      <input type="text" value={resGenCfg.descPrefix} onChange={e=>setResGenCfg(c=>({...c,descPrefix:e.target.value}))}
                        style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                    </div>
                  </div>
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:10,color:"#86868b",marginBottom:6 }}>Decades (96 values each)</div>
                    <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                      {decadeLabels.map((label, i) => (
                        <label key={i} style={{ display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer",
                          padding:"4px 10px",borderRadius:6,border:"1px solid "+(resGenCfg.decades[i]?"#5856d6":"#d2d2d7"),
                          background:resGenCfg.decades[i]?"rgba(88,86,214,0.06)":"transparent" }}>
                          <input type="checkbox" checked={resGenCfg.decades[i]||false}
                            onChange={e=>setResGenCfg(c=>({...c,decades:{...c.decades,[i]:e.target.checked}}))}
                            style={{ width:13,height:13,accentColor:"#5856d6",cursor:"pointer" }} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
                    <span style={{ fontSize:12,color:"#86868b" }}>{genParts.length} resistors ({selectedCount} decade{selectedCount!==1?"s":""})</span>
                    <button className="btn-ghost btn-sm" onClick={()=>setResGenPreview(!resGenPreview)}>
                      {resGenPreview ? "Hide Preview" : "Preview"}
                    </button>
                    <button disabled={genParts.length===0}
                      onClick={async () => {
                        if (!window.confirm(`Import ${genParts.length} resistors into the master library?`)) return;
                        try {
                          const dbRows = genParts.map(p => ({
                            mpn: p.mpn, value: p.value, description: p.description, manufacturer: p.manufacturer,
                            quantity: p.quantity, product_id: null, reference: "", footprint: "",
                            unit_cost: null, reorder_qty: null, stock_qty: null, preferred_supplier: "mouser",
                            order_qty: null, flagged_for_order: false,
                            pricing_status: "idle", pricing_error: "",
                          }));
                          await upsertParts(dbRows, user.id);
                          setImportOk(`Imported ${genParts.length} resistors into master library.`);
                          setShowResGen(false);
                        } catch (err) { alert("Import failed: " + err.message); }
                      }}
                      style={{ padding:"7px 18px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
                        border:"none",background:"#5856d6",color:"#fff",opacity:genParts.length>0?"1":"0.4" }}>
                      Import All ({genParts.length})
                    </button>
                  </div>
                  {resGenPreview && genParts.length > 0 && (
                    <div style={{ marginTop:12,maxHeight:300,overflowY:"auto",border:"1px solid #e5e5ea",borderRadius:8 }}>
                      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:11 }}>
                        <thead>
                          <tr style={{ background:"#f5f5f7" }}>
                            <th style={{ padding:"6px 10px",textAlign:"left" }}>MPN</th>
                            <th style={{ padding:"6px 10px",textAlign:"left" }}>Value</th>
                            <th style={{ padding:"6px 10px",textAlign:"left" }}>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {genParts.slice(0, 200).map((p, i) => (
                            <tr key={i} style={{ borderBottom:"1px solid #f0f0f2" }}>
                              <td style={{ padding:"4px 10px",fontWeight:600,color:"#0071e3",fontFamily:"'SF Mono',monospace" }}>{p.mpn}</td>
                              <td style={{ padding:"4px 10px" }}>{p.value}</td>
                              <td style={{ padding:"4px 10px",color:"#86868b" }}>{p.description}</td>
                            </tr>
                          ))}
                          {genParts.length > 200 && (
                            <tr><td colSpan={3} style={{ padding:"8px 10px",textAlign:"center",color:"#aeaeb2",fontSize:11 }}>...and {genParts.length - 200} more</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                  </>}

                  {/* ── Capacitor Generator */}
                  {compGenType === "capacitor" && (() => {
                    const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
                    // Murata GRM encoding: value code = 3 digits where first 2 are significant, 3rd is multiplier (in pF)
                    // 106 = 10 × 10^6 pF = 10µF, 105 = 10 × 10^5 pF = 1µF, 104 = 10 × 10^4 pF = 100nF
                    const capDecadeLabels = ["1pF–8.2pF","10pF–82pF","100pF–820pF","1nF–8.2nF","10nF–82nF","100nF–820nF","1µF–8.2µF","10µF–82µF"];
                    const fmtCap = (pf) => {
                      if (pf >= 1000000) return (pf/1000000).toFixed(pf/1000000 < 10 && pf%1000000 ? 1 : 0).replace(/\.0$/,"") + "µF";
                      if (pf >= 1000) return (pf/1000).toFixed(pf/1000 < 10 && pf%1000 ? 1 : 0).replace(/\.0$/,"") + "nF";
                      return (Number.isInteger(pf) ? pf : pf.toFixed(1).replace(/\.0$/,"")) + "pF";
                    };
                    const capCode = (pf) => {
                      // Convert pF to 3-digit code: significant digits + multiplier
                      if (pf < 10) return String(Math.round(pf * 10)).padStart(2,"0") + "9"; // R notation for <10pF (special)
                      const exp = Math.floor(Math.log10(pf));
                      const sig = Math.round(pf / Math.pow(10, exp - 1));
                      const mult = exp - 1;
                      return String(sig).padStart(2,"0") + String(mult);
                    };
                    const generateCapParts = () => {
                      const result = [];
                      for (let decade = 0; decade <= 7; decade++) {
                        if (!capGenCfg.decades[decade]) continue;
                        for (const base of E12) {
                          const pf = base * Math.pow(10, decade);
                          const code = capCode(pf);
                          const mpn = capGenCfg.prefix + code + capGenCfg.suffix;
                          const value = fmtCap(pf);
                          result.push({ mpn, value, description: capGenCfg.descPrefix + " " + value, manufacturer: capGenCfg.manufacturer, quantity: 1, product_id: null });
                        }
                      }
                      return result;
                    };
                    const capParts = generateCapParts();
                    const selectedCount = Object.values(capGenCfg.decades).filter(Boolean).length;
                    return (<>
                      <p style={{ color:"#86868b",fontSize:12,marginBottom:14 }}>Generate E12 standard capacitor values for any MLCC series. Murata GRM 0603 25V pre-configured.</p>
                      <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:14 }}>
                        <div style={{ flex:"1 1 140px" }}>
                          <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>MPN Prefix</div>
                          <input type="text" value={capGenCfg.prefix} onChange={e=>setCapGenCfg(c=>({...c,prefix:e.target.value}))}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                        </div>
                        <div style={{ flex:"0 0 80px" }}>
                          <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>MPN Suffix</div>
                          <input type="text" value={capGenCfg.suffix} onChange={e=>setCapGenCfg(c=>({...c,suffix:e.target.value}))}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                        </div>
                        <div style={{ flex:"1 1 120px" }}>
                          <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Manufacturer</div>
                          <input type="text" value={capGenCfg.manufacturer} onChange={e=>setCapGenCfg(c=>({...c,manufacturer:e.target.value}))}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                        </div>
                        <div style={{ flex:"2 1 200px" }}>
                          <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Description Prefix</div>
                          <input type="text" value={capGenCfg.descPrefix} onChange={e=>setCapGenCfg(c=>({...c,descPrefix:e.target.value}))}
                            style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,border:"1px solid #d2d2d7",boxSizing:"border-box" }} />
                        </div>
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:10,color:"#86868b",marginBottom:6 }}>Decades (12 values each)</div>
                        <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                          {capDecadeLabels.map((label, i) => (
                            <label key={i} style={{ display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer",
                              padding:"4px 10px",borderRadius:6,border:"1px solid "+(capGenCfg.decades[i]?"#5856d6":"#d2d2d7"),
                              background:capGenCfg.decades[i]?"rgba(88,86,214,0.06)":"transparent" }}>
                              <input type="checkbox" checked={capGenCfg.decades[i]||false}
                                onChange={e=>setCapGenCfg(c=>({...c,decades:{...c.decades,[i]:e.target.checked}}))}
                                style={{ width:13,height:13,accentColor:"#5856d6",cursor:"pointer" }} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
                        <span style={{ fontSize:12,color:"#86868b" }}>{capParts.length} capacitors ({selectedCount} decade{selectedCount!==1?"s":""})</span>
                        <button className="btn-ghost btn-sm" onClick={()=>setCapGenPreview(!capGenPreview)}>
                          {capGenPreview ? "Hide Preview" : "Preview"}
                        </button>
                        <button disabled={capParts.length===0}
                          onClick={async () => {
                            if (!window.confirm(`Import ${capParts.length} capacitors into the master library?`)) return;
                            try {
                              const dbRows = capParts.map(p => ({
                                mpn: p.mpn, value: p.value, description: p.description, manufacturer: p.manufacturer,
                                quantity: p.quantity, product_id: null, reference: "", footprint: "0603",
                                unit_cost: null, reorder_qty: null, stock_qty: null, preferred_supplier: "mouser",
                                order_qty: null, flagged_for_order: false,
                                pricing_status: "idle", pricing_error: "",
                              }));
                              await upsertParts(dbRows, user.id);
                              setImportOk(`Imported ${capParts.length} capacitors into master library.`);
                              setShowResGen(false);
                            } catch (err) { alert("Import failed: " + err.message); }
                          }}
                          style={{ padding:"7px 18px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
                            border:"none",background:"#5856d6",color:"#fff",opacity:capParts.length>0?"1":"0.4" }}>
                          Import All ({capParts.length})
                        </button>
                      </div>
                      {capGenPreview && capParts.length > 0 && (
                        <div style={{ marginTop:12,maxHeight:300,overflowY:"auto",border:"1px solid #e5e5ea",borderRadius:8 }}>
                          <table style={{ width:"100%",borderCollapse:"collapse",fontSize:11 }}>
                            <thead>
                              <tr style={{ background:"#f5f5f7" }}>
                                <th style={{ padding:"6px 10px",textAlign:"left" }}>MPN</th>
                                <th style={{ padding:"6px 10px",textAlign:"left" }}>Value</th>
                                <th style={{ padding:"6px 10px",textAlign:"left" }}>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {capParts.slice(0, 200).map((p, i) => (
                                <tr key={i} style={{ borderBottom:"1px solid #f0f0f2" }}>
                                  <td style={{ padding:"4px 10px",fontWeight:600,color:"#0071e3",fontFamily:"'SF Mono',monospace" }}>{p.mpn}</td>
                                  <td style={{ padding:"4px 10px" }}>{p.value}</td>
                                  <td style={{ padding:"4px 10px",color:"#86868b" }}>{p.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>);
                  })()}
                </div>
              );
            })()}

            {/* ── Bulk-action bar — only visible when parts are selected */}
            {selectedParts.size > 0 && (
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"6px 12px",
                background:"rgba(0,113,227,0.06)",border:"1px solid rgba(0,113,227,0.3)",borderRadius:6,marginBottom:6 }}>
                <span style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#0071e3" }}>
                  {selectedParts.size} part{selectedParts.size!==1?"s":""} selected
                </span>
                <button
                  onClick={deleteSelected}
                  style={{ background:"#ff3b30",color:"#fff",border:"none",borderRadius:6,
                    padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",display:"flex",alignItems:"center",gap:7 }}>
                  🗑 Delete Selected
                </button>
                <button
                  onClick={() => { const sel = parts.filter(p => selectedParts.has(p.id)); console.log("[QR] Opening labels for", sel.length, "parts"); setQrModalParts(sel); }}
                  style={{ background:"#5856d6",color:"#fff",border:"none",borderRadius:6,
                    padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",display:"flex",alignItems:"center",gap:7 }}>
                  ⊞ Print QR Labels
                </button>
                <button className="btn-ghost btn-sm" onClick={selectNone}>Cancel</button>
                {/* Bulk Edit */}
                <div style={{ marginLeft:8,borderLeft:"1px solid rgba(0,113,227,0.3)",paddingLeft:10,display:"flex",alignItems:"center",gap:6 }}>
                  <select id="bulkField" style={{ padding:"5px 8px",borderRadius:5,fontSize:12,border:"1px solid #d2d2d7" }}>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="value">Value</option>
                    <option value="description">Description</option>
                    <option value="reorderQty">Reorder Point</option>
                    <option value="reelQty">Reel Qty</option>
                    <option value="stockQty">Stock</option>
                    <option value="preferredSupplier">Supplier</option>
                  </select>
                  <input id="bulkValue" type="text" placeholder="Set value…"
                    style={{ padding:"5px 8px",borderRadius:5,fontSize:12,border:"1px solid #d2d2d7",width:140 }} />
                  <button onClick={async () => {
                    const field = document.getElementById("bulkField").value;
                    const val = document.getElementById("bulkValue").value;
                    if (!val && field !== "stockQty") return;
                    for (const id of selectedParts) {
                      await updatePart(id, field, val);
                    }
                    document.getElementById("bulkValue").value = "";
                  }}
                    style={{ background:"#0071e3",color:"#fff",border:"none",borderRadius:6,
                      padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" }}>
                    Apply to {selectedParts.size}
                  </button>
                </div>
              </div>
            )}

            {parts.length === 0 ? (
              <div style={{ textAlign:"center",padding:"80px 20px",color:"#aeaeb2" }}>
                <div style={{ fontSize:44,marginBottom:14 }}>🔩</div>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:15 }}>No parts yet — import a BOM to get started</div>
              </div>
            ) : (
              <div style={{ overflowX:"auto",background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#b8bdd1",color:"#3a3f51" }}>
                      <th style={{ padding:"12px 10px",width:28,borderRadius:"8px 0 0 0" }}>
                        <input
                          type="checkbox"
                          title={selectedParts.size === visibleParts.length && visibleParts.length > 0 ? "Deselect all" : "Select all visible"}
                          style={{ width:15,height:15,cursor:"pointer",accentColor:"#0071e3" }}
                          checked={visibleParts.length > 0 && visibleParts.every((p) => selectedParts.has(p.id))}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedParts.size > 0 && !visibleParts.every((p) => selectedParts.has(p.id));
                          }}
                          onChange={(e) => {
                            if (e.target.checked) selectAll(visibleParts.map((p) => p.id));
                            else selectNone();
                          }}
                        />
                      </th>
                      {["MPN","Value","Description","Manufacturer","Current Stock","Reorder Pt","Reel Qty","Stock Value",""].map((h,hi,arr)=>(
                        <th key={hi} style={{ textAlign:"left",padding:"12px 14px",
                          fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                          fontSize:11,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",
                          borderRadius:hi===arr.length-1?"0 8px 0 0":undefined }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleParts.map((part,i) => {
                      const sn=parseInt(part.stockQty)||0,rn=parseInt(part.reorderQty);
                      const isLow = !isNaN(rn)&&rn>0&&sn<=rn;
                      const inputStyle = { width:"100%",padding:"6px 10px",borderRadius:6,fontSize:13,
                        fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                        border:"1px solid transparent",background:"transparent",outline:"none",color:"#1d1d1f",
                        transition:"border-color 0.15s, background 0.15s" };
                      const focusIn = (e) => { e.target.style.borderColor="#d2d2d7"; e.target.style.background="#fff"; };
                      const focusOut = (e) => { e.target.style.borderColor="transparent"; e.target.style.background="transparent"; };
                      return (
                        <tr key={part.id} className="table-row"
                          style={{ borderBottom:"1px solid #ededf0",
                            background: selectedParts.has(part.id) ? "rgba(0,113,227,0.05)" : "transparent" }}>
                          <td style={{ padding:"10px 10px",width:28 }}>
                            <input type="checkbox"
                              style={{ width:15,height:15,cursor:"pointer",accentColor:"#0071e3" }}
                              checked={selectedParts.has(part.id)}
                              onChange={() => toggleSelect(part.id)} />
                          </td>
                          <td style={{ padding:"6px 8px" }}>
                            <input type="text" value={part.mpn||""}
                              onChange={(e)=>updatePart(part.id,"mpn",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={{ ...inputStyle,color:"#0071e3",fontWeight:600 }} placeholder="—" />
                          </td>
                          <td style={{ padding:"6px 8px" }}>
                            <input type="text" value={part.value||""}
                              onChange={(e)=>updatePart(part.id,"value",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={inputStyle} placeholder="" />
                          </td>
                          <td style={{ padding:"6px 8px" }}>
                            <input type="text" value={part.description||""}
                              onChange={(e)=>updatePart(part.id,"description",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={{ ...inputStyle,color:"#6e6e73" }} placeholder="" />
                          </td>
                          <td style={{ padding:"6px 8px" }}>
                            <input type="text" value={part.manufacturer||""}
                              onChange={(e)=>updatePart(part.id,"manufacturer",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={{ ...inputStyle,color:"#86868b" }} placeholder="" />
                          </td>
                          <td style={{ padding:"6px 8px",width:90 }}>
                            <input type="number" placeholder="0" value={part.stockQty}
                              onChange={(e)=>updatePart(part.id,"stockQty",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={{ ...inputStyle,fontWeight:600,
                                color:isLow?"#ff3b30":"#1d1d1f" }} min="0" />
                          </td>
                          <td style={{ padding:"6px 8px",width:80 }}>
                            <input type="number" placeholder="0" value={part.reorderQty}
                              onChange={(e)=>updatePart(part.id,"reorderQty",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={inputStyle} min="0" />
                          </td>
                          <td style={{ padding:"6px 8px",width:80 }}>
                            <input type="number" placeholder="" value={part.reelQty}
                              onChange={(e)=>updatePart(part.id,"reelQty",e.target.value)}
                              onFocus={focusIn} onBlur={focusOut}
                              style={{ ...inputStyle,color:"#34c759" }} min="0" />
                          </td>
                          <td style={{ padding:"6px 8px",width:90 }}>
                            {(() => {
                              const cost = priceAtQty(part);
                              const val = sn * cost;
                              return val > 0
                                ? <span style={{ fontSize:13,color:"#34c759",fontWeight:600 }}>${fmtDollar(val)}</span>
                                : <span style={{ fontSize:13,color:"#aeaeb2" }}>—</span>;
                            })()}
                          </td>
                          <td style={{ padding:"6px 4px",width:56,whiteSpace:"nowrap" }}>
                            <button onClick={()=>{console.log("[QR] Opening label for",part.mpn);setQrModalParts([part]);}} title="QR Label"
                              style={{ background:"none",border:"none",cursor:"pointer",color:"#c7c7cc",fontSize:13,padding:"2px 4px",borderRadius:4,transition:"color 0.15s" }}
                              onMouseOver={(e)=>e.target.style.color="#0071e3"}
                              onMouseOut={(e)=>e.target.style.color="#c7c7cc"}>⊞</button>
                            <button onClick={()=>deletePart(part.id)}
                              style={{ background:"none",border:"none",cursor:"pointer",color:"#c7c7cc",fontSize:14,padding:"2px 4px",borderRadius:4,transition:"color 0.15s" }}
                              onMouseOver={(e)=>e.target.style.color="#ff3b30"}
                              onMouseOut={(e)=>e.target.style.color="#c7c7cc"}>✕</button>
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
              <div style={{ display:"flex",gap:10,marginTop:14,flexWrap:"wrap",alignItems:"center" }}>
                <div style={{ position:"relative",flex:"1 1 260px",maxWidth:400 }}>
                  <input type="text" placeholder="Search parts…" value={pricingSearch}
                    onChange={(e) => setPricingSearch(e.target.value)}
                    style={{ width:"100%",padding:"8px 14px 8px 34px",borderRadius:980,fontSize:13,border:"1px solid #d2d2d7",fontFamily:"inherit",outline:"none" }} />
                  <span style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#aeaeb2",pointerEvents:"none" }}>🔍</span>
                </div>
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
                <div style={{ display:"flex",borderRadius:980,overflow:"hidden",border:"1px solid #d2d2d7" }}>
                  <button onClick={()=>setCountryFilter("us")}
                    style={{ padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",
                      background:countryFilter==="us"?"#1d1d1f":"transparent",color:countryFilter==="us"?"#fff":"#86868b",transition:"all 0.15s" }}>
                    USA!! USA!!
                  </button>
                  <button onClick={()=>setCountryFilter("rest")}
                    style={{ padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",borderLeft:"1px solid #d2d2d7",
                      background:countryFilter==="rest"?"#1d1d1f":"transparent",color:countryFilter==="rest"?"#fff":"#86868b",transition:"all 0.15s" }}>
                    The Rest
                  </button>
                </div>
              </div>
            </div>

            {parts.length === 0 ? (
              <div style={{ textAlign:"center",padding:60,color:"#86868b" }}>
                <div style={{ fontSize:14,fontFamily:"-apple-system,sans-serif" }}>Import a BOM first</div>
              </div>
            ) : (
              <>
                {/* Part list */}
                <div style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden" }}>
                  {(() => {
                    const pq = pricingSearch.toLowerCase().trim();
                    return parts.filter(p => !pq || p.reference.toLowerCase().includes(pq) || p.value.toLowerCase().includes(pq) || p.mpn.toLowerCase().includes(pq) || p.description.toLowerCase().includes(pq) || (p.manufacturer||"").toLowerCase().includes(pq));
                  })().map((part, partIdx) => {
                    const pricingObj = part.pricing && typeof part.pricing === "object" ? part.pricing : null;
                    const hasPricing = pricingObj && Object.keys(pricingObj).length > 0;
                    const best = part.bestSupplier || (hasPricing ? bestPriceSupplier(pricingObj) : null);
                    const bestData = hasPricing && best ? pricingObj[best] : null;
                    const effectiveStatus = hasPricing ? "done" : part.pricingStatus;
                    const isOpen = expandedPart === part.id;

                    // Sort suppliers — price at buy qty
                    const bq = buyQtys[part.id] || parseInt(part.quantity) || 1;
                    const pAtQty = (d) => { let p = d.unitPrice; if (d.priceBreaks?.length) { for (const pb of d.priceBreaks) { if (bq >= pb.qty) p = pb.price; } } return parseFloat(p) || d.unitPrice; };
                    const getCountry = (d) => d.country || DIST_COUNTRY[d.displayName] || DIST_COUNTRY[d.supplierId] || "";
                    const isNonUS = (d) => { const c = getCountry(d); return c && c !== "US"; };
                    // Tariff helpers (needed for sorting by landed price)
                    let userTariffs; try { userTariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { userTariffs = { ...DEFAULT_TARIFFS }; }
                    // Landed price = unit price + tariff for non-US suppliers
                    const landedAt = (d) => {
                      const p = pAtQty(d);
                      const c = getCountry(d);
                      const origin = (c && c !== "US") ? c : "";
                      const rate = getTariffRate(origin, userTariffs);
                      return origin ? p * (1 + rate / 100) : p;
                    };
                    // If an exclusive custom supplier exists, only show that one
                    const exclusiveSupplier = hasPricing ? Object.entries(pricingObj).find(([,d]) => d.isCustom && d.exclusive) : null;
                    const sorted = hasPricing ? (exclusiveSupplier
                      ? [exclusiveSupplier]
                      : Object.entries(pricingObj)
                        .filter(([,d]) => d.stock > 0 && (countryFilter === "us" ? !isNonUS(d) : isNonUS(d)))
                        .sort((a,b) => (landedAt(a[1])||Infinity) - (landedAt(b[1])||Infinity))
                    ) : [];

                    // Best display price — use landed price (includes tariff)
                    const filteredBest = sorted.length > 0 ? sorted[0][0] : null;
                    const filteredBestData = sorted.length > 0 ? sorted[0][1] : null;
                    const bestDisplayPrice = filteredBestData ? landedAt(filteredBestData) : null;

                    return (
                      <div key={part.id} style={{ borderBottom: partIdx < parts.length-1 ? "1px solid #f0f0f2" : "none" }}>
                        {/* Collapsed row — click to expand */}
                        <div onClick={() => setExpandedPart(isOpen ? null : part.id)}
                          style={{ display:"flex",alignItems:"center",padding:"14px 22px",cursor:"pointer",
                            transition:"background 0.15s",background:isOpen?"rgba(0,0,0,0.02)":"transparent" }}
                          onMouseOver={e=>{if(!isOpen)e.currentTarget.style.background="rgba(0,0,0,0.02)"}}
                          onMouseOut={e=>{if(!isOpen)e.currentTarget.style.background="transparent"}}>
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontSize:15,fontWeight:600,color:"#1d1d1f" }}>
                              {part.mpn || part.reference}
                            </div>
                            <div style={{ fontSize:12,color:"#86868b",marginTop:1,minHeight:18 }}>
                              {[part.description, part.value].filter(Boolean).join(" — ") || "\u00A0"}
                            </div>
                          </div>
                          <div style={{ flex:1,display:"flex",alignItems:"center",gap:6,justifyContent:"center" }}>
                            <span style={{ fontSize:10,color:"#86868b",fontWeight:500,whiteSpace:"nowrap",letterSpacing:"0.5px",textTransform:"uppercase" }}>Quote Quantity</span>
                            <input type="text" inputMode="numeric" value={bq}
                              onClick={(e)=>e.stopPropagation()}
                              onChange={(e)=>{e.stopPropagation();const v=e.target.value.replace(/[^0-9]/g,"");setBuyQtys(q=>({...q,[part.id]:parseInt(v)||1}));}}
                              style={{ width:72,padding:"2px 4px",border:"none",borderBottom:"1px solid transparent",fontSize:15,textAlign:"center",fontFamily:"inherit",fontWeight:600,color:"#1d1d1f",background:"transparent",outline:"none",transition:"border-color 0.15s" }}
                              onFocus={(e)=>{e.target.style.borderBottom="1px solid #0071e3";e.target.select();}}
                              onBlur={(e)=>{e.target.style.borderBottom="1px solid transparent";}} />
                          </div>
                          <div style={{ flex:1,textAlign:"right" }}>
                            {effectiveStatus === "done" && bestDisplayPrice ? (
                              (() => {
                                const basePrice = filteredBestData ? pAtQty(filteredBestData) : bestDisplayPrice;
                                const bestCtry = filteredBestData ? getCountry(filteredBestData) : "";
                                const bestOrigin = (bestCtry && bestCtry !== "US") ? bestCtry : "";
                                const bestTariffRate = bestOrigin ? getTariffRate(bestOrigin, userTariffs) : 0;
                                return <>
                                  <div style={{ fontSize:20,fontWeight:600,letterSpacing:"-0.3px",color:"#1d1d1f" }}>{"$"}{fmtPrice(bestDisplayPrice)}</div>
                                  {bestTariffRate > 0 ? (
                                    <div style={{ fontSize:10,color:"#ff9500",marginTop:1 }}>
                                      {"$"}{fmtPrice(basePrice)} + {bestTariffRate}% tariff = landed
                                    </div>
                                  ) : (
                                    <div style={{ fontSize:10,color:"#34c759",marginTop:1 }}>Landed Cost (0% tariff)</div>
                                  )}
                                  <div style={{ fontSize:11,color:"#86868b",marginTop:1 }}>
                                    <span style={{ display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#34c759",marginRight:4,verticalAlign:"middle" }}></span>
                                    {filteredBestData?.displayName || filteredBest}
                                  </div>
                                </>;
                              })()
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
                              <>
                              <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:14 }}>
                                {sorted.map(([key, data], idx) => {
                                  const isBest = idx === 0;
                                  const ctry = getCountry(data);
                                  const displayPrice = pAtQty(data);
                                  const origin = (ctry && ctry !== "US") ? ctry : "";
                                  const tariffRate = getTariffRate(origin, userTariffs);
                                  const landedPrice = origin ? displayPrice * (1 + tariffRate / 100) : 0;
                                  return (
                                    <div key={key} style={{
                                      background: isBest ? "rgba(52,199,89,0.08)" : "#f5f5f7",
                                      border: isBest ? "1.5px solid rgba(52,199,89,0.3)" : "1.5px solid transparent",
                                      borderRadius:12, padding:"12px 16px", minWidth:150, flex:1, maxWidth:200,
                                      transition:"all 0.15s", display:"flex", flexDirection:"column"
                                    }}>
                                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",minHeight:32 }}>
                                        <span style={{ fontSize:12,fontWeight:500,color:"#86868b",lineHeight:"16px" }}>{data.displayName}</span>
                                        <span style={{ fontSize:10,color:"#aeaeb2",fontWeight:500,flexShrink:0,marginLeft:4 }}>{ctry}</span>
                                      </div>
                                      <div style={{ fontSize:18,fontWeight:700,letterSpacing:"-0.3px",
                                        color:isBest?"#248a3d":"#1d1d1f" }}>{"$"}{fmtPrice(origin ? landedPrice : displayPrice)}</div>
                                      {origin ? (
                                        <div style={{ fontSize:9,color:"#86868b",fontWeight:400,marginTop:2,lineHeight:"13px" }}>
                                          {"$"}{fmtPrice(displayPrice)} unit{data.originalCurrency ? ` (${data.originalCurrency} → USD)` : ""}
                                          {tariffRate > 0 ? ` + ${tariffRate}% tariff` : ""}
                                        </div>
                                      ) : data.originalCurrency ? (
                                        <div style={{ fontSize:9,color:"#0071e3",fontWeight:500,marginTop:1 }}>
                                          Converted from {data.originalCurrency}
                                        </div>
                                      ) : null}
                                      <div style={{ fontSize:10,marginTop:4 }}><span style={{ color: data.stock < bq ? "#ff3b30" : "#aeaeb2", fontWeight: data.stock < bq ? 600 : 400 }}>Stock: {data.stock.toLocaleString()}</span><span style={{ color:"#aeaeb2" }}> · MOQ: {data.moq}</span></div>
                                      {/* Compliance & lifecycle badges */}
                                      <div style={{ display:"flex",gap:4,flexWrap:"wrap",marginTop:4 }}>
                                        {data.rohsStatus && (
                                          <span style={{ display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:600,
                                            background: data.rohsStatus.toLowerCase().includes("compliant") ? "rgba(52,199,89,0.12)" : "rgba(255,59,48,0.1)",
                                            color: data.rohsStatus.toLowerCase().includes("compliant") ? "#34c759" : "#ff3b30" }}>
                                            RoHS {data.rohsStatus.toLowerCase().includes("compliant") ? "✓" : "✗"}
                                          </span>
                                        )}
                                        {data.lifecycleStatus && (
                                          <span style={{ display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:600,
                                            background: data.lifecycleStatus.toLowerCase().includes("eol") || data.lifecycleStatus.toLowerCase().includes("obsolete") ? "rgba(255,59,48,0.1)" :
                                              data.lifecycleStatus.toLowerCase().includes("nrnd") || data.lifecycleStatus.toLowerCase().includes("not recommended") ? "rgba(255,149,0,0.1)" :
                                              "rgba(52,199,89,0.12)",
                                            color: data.lifecycleStatus.toLowerCase().includes("eol") || data.lifecycleStatus.toLowerCase().includes("obsolete") ? "#ff3b30" :
                                              data.lifecycleStatus.toLowerCase().includes("nrnd") || data.lifecycleStatus.toLowerCase().includes("not recommended") ? "#ff9500" :
                                              "#34c759" }}>
                                            {data.lifecycleStatus}
                                          </span>
                                        )}
                                        {data.leadTime && (
                                          <span style={{ display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:500,
                                            background:"rgba(0,113,227,0.08)",color:"#0071e3" }}>
                                            Lead: {data.leadTime}
                                          </span>
                                        )}
                                      </div>
                                      {data.datasheetUrl && (
                                        <a href={data.datasheetUrl} target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          style={{ display:"inline-block",marginTop:4,fontSize:10,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>
                                          📄 Datasheet
                                        </a>
                                      )}
                                      {data.suggestedReplacement && (
                                        <div style={{ fontSize:9,color:"#ff9500",marginTop:3,fontWeight:500 }}>
                                          Replacement: {data.suggestedReplacement}
                                        </div>
                                      )}
                                      <div style={{ fontSize:10,color:"#aeaeb2",marginTop:2 }}>@ {bq} pcs</div>
                                      {data.url && (
                                        <a href={data.url} target="_blank" rel="noopener noreferrer"
                                          style={{ display:"block",marginTop:8,fontSize:11,color:"#0071e3",textDecoration:"none",fontWeight:500 }}
                                          onClick={e=>e.stopPropagation()}>
                                          View on site →
                                        </a>
                                      )}
                                      {data.isCustom && (
                                        <div style={{ display:"flex",gap:10,marginTop:6 }}>
                                          <button onClick={(e)=>{e.stopPropagation();setCustomSupplierForm({ partId:part.id, editKey:key, name:data.displayName, url:data.url||"", country:data.country||"US", stock:String(data.stock||""), breaks:data.priceBreaks?.length ? data.priceBreaks.map(b=>({qty:b.qty,price:b.price})) : [{qty:1,price:""}], exclusive:!!data.exclusive });}}
                                            style={{ fontSize:10,color:"#0071e3",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",fontWeight:500 }}>
                                            Edit
                                          </button>
                                          <button onClick={(e)=>{e.stopPropagation();removeCustomSupplier(part.id,key);}}
                                            style={{ fontSize:10,color:"#ff3b30",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",fontWeight:500 }}>
                                            Remove
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {/* Out-of-stock supplier note with alternatives link */}
                              {(() => {
                                const oosSuppliers = hasPricing ? Object.entries(pricingObj).filter(([k,d]) => k !== "_countryOfOrigin" && d.stock <= 0) : [];
                                if (oosSuppliers.length === 0 || !part.mpn) return null;
                                return (
                                  <div style={{ padding:"8px 16px",fontSize:11,color:"#aeaeb2",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap" }}>
                                    <span style={{ color:"#ff3b30",fontWeight:500 }}>{oosSuppliers.length} supplier{oosSuppliers.length > 1 ? "s" : ""} out of stock</span>
                                    <span>({oosSuppliers.map(([,d]) => d.displayName || "Unknown").join(", ")})</span>
                                    <a href={`https://octopart.com/search?q=${encodeURIComponent(part.mpn)}&start=0`}
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      style={{ fontSize:11,color:"#0071e3",textDecoration:"none",fontWeight:600,cursor:"pointer",marginLeft:4 }}>
                                      Search Alternatives
                                    </a>
                                  </div>
                                );
                              })()}
                              </>
                            ) : effectiveStatus === "done" ? (
                              <div style={{ padding:16,textAlign:"center",color:"#aeaeb2",fontSize:13 }}>
                                No suppliers with stock{countryFilter === "us" ? " (US Only filter is on)" : " (international filter is on)"}
                                {part.mpn && (
                                  <div style={{ marginTop:10 }}>
                                    <span style={{ fontSize:12,color:"#ff9500",fontWeight:500 }}>Consider searching for alternative parts.</span>
                                    <a href={`https://octopart.com/search?q=${encodeURIComponent(part.mpn)}&start=0`}
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      style={{ display:"inline-block",marginLeft:8,fontSize:12,color:"#0071e3",textDecoration:"none",fontWeight:600,cursor:"pointer" }}>
                                      Search Alternatives on Octopart
                                    </a>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ padding:16,textAlign:"center",color:"#aeaeb2",fontSize:13 }}>No pricing data yet</div>
                            )}

                            {/* Add Custom Supplier + Refresh */}
                            <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
                              <button onClick={(e)=>{e.stopPropagation();setCustomSupplierForm({ partId:part.id, name:"", url:"", country:"US", stock:"", breaks:[{qty:1,price:""}], exclusive:false });}}
                                style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                  border:"1px solid #0071e3",background:"none",color:"#0071e3" }}>
                                + Custom Supplier
                              </button>
                              {effectiveStatus === "done" && (
                                <button onClick={(e)=>{e.stopPropagation();fetchPartPricing(part.id);}}
                                  style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                    border:"1px solid #d2d2d7",background:"none",color:"#86868b" }}>
                                  Refresh Prices
                                </button>
                              )}
                            </div>

                            {/* Custom Supplier Form */}
                            {customSupplierForm && customSupplierForm.partId === part.id && (
                              <div style={{ padding:"16px",background:"#f0f4ff",borderRadius:12,marginBottom:14,border:"1px solid rgba(0,113,227,0.15)" }}
                                onClick={e=>e.stopPropagation()}>
                                <div style={{ fontSize:12,fontWeight:600,color:"#1d1d1f",marginBottom:12 }}>{customSupplierForm.editKey ? "Edit" : "Add"} Custom Supplier</div>
                                <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:10 }}>
                                  <div>
                                    <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Supplier Name *</div>
                                    <input type="text" value={customSupplierForm.name} placeholder="e.g. CEdist"
                                      onChange={e=>setCustomSupplierForm(f=>({...f,name:e.target.value}))}
                                      style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:140 }} />
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Website URL</div>
                                    <input type="text" value={customSupplierForm.url} placeholder="https://..."
                                      onChange={e=>setCustomSupplierForm(f=>({...f,url:e.target.value}))}
                                      style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:180 }} />
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Country</div>
                                    <input type="text" value={customSupplierForm.country} placeholder="US"
                                      onChange={e=>setCustomSupplierForm(f=>({...f,country:e.target.value.toUpperCase()}))}
                                      style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:50 }} />
                                  </div>
                                  <div>
                                    <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:3,textTransform:"uppercase",letterSpacing:"0.3px" }}>Stock</div>
                                    <input type="number" value={customSupplierForm.stock} placeholder="∞"
                                      onChange={e=>setCustomSupplierForm(f=>({...f,stock:e.target.value}))}
                                      style={{ padding:"7px 10px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:13,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:70 }} />
                                  </div>
                                </div>

                                {/* Price breaks */}
                                <div style={{ fontSize:10,color:"#86868b",fontWeight:500,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.3px" }}>Price Breaks</div>
                                {customSupplierForm.breaks.map((b, i) => (
                                  <div key={i} style={{ display:"flex",gap:8,alignItems:"center",marginBottom:6 }}>
                                    <input type="number" value={b.qty} placeholder="Qty" min="1"
                                      onChange={e=>{const breaks=[...customSupplierForm.breaks];breaks[i]={...breaks[i],qty:parseInt(e.target.value)||0};setCustomSupplierForm(f=>({...f,breaks}));}}
                                      style={{ padding:"6px 8px",border:"1px solid #d2d2d7",borderRadius:6,fontSize:12,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:70 }} />
                                    <span style={{ fontSize:11,color:"#86868b" }}>+</span>
                                    <div style={{ position:"relative" }}>
                                      <span style={{ position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:12,color:"#86868b" }}>$</span>
                                      <input type="number" value={b.price} placeholder="0.00" step="0.001" min="0"
                                        onChange={e=>{const breaks=[...customSupplierForm.breaks];breaks[i]={...breaks[i],price:e.target.value};setCustomSupplierForm(f=>({...f,breaks}));}}
                                        style={{ padding:"6px 8px 6px 20px",border:"1px solid #d2d2d7",borderRadius:6,fontSize:12,fontFamily:"inherit",background:"#fff",color:"#1d1d1f",outline:"none",width:90 }} />
                                    </div>
                                    {customSupplierForm.breaks.length > 1 && (
                                      <button onClick={()=>{const breaks=customSupplierForm.breaks.filter((_,j)=>j!==i);setCustomSupplierForm(f=>({...f,breaks}));}}
                                        style={{ background:"none",border:"none",cursor:"pointer",color:"#aeaeb2",fontSize:14,padding:"0 4px" }}>✕</button>
                                    )}
                                  </div>
                                ))}
                                <button onClick={()=>setCustomSupplierForm(f=>({...f,breaks:[...f.breaks,{qty:"",price:""}]}))}
                                  style={{ fontSize:11,color:"#0071e3",background:"none",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:"inherit",fontWeight:500,marginBottom:12 }}>
                                  + Add price break
                                </button>

                                <label style={{ display:"flex",alignItems:"center",gap:8,marginTop:8,marginBottom:10,cursor:"pointer",userSelect:"none" }}>
                                  <input type="checkbox" checked={customSupplierForm.exclusive || false}
                                    onChange={e=>setCustomSupplierForm(f=>({...f,exclusive:e.target.checked}))}
                                    style={{ width:16,height:16,accentColor:"#5856d6",cursor:"pointer" }} />
                                  <span style={{ fontSize:12,fontWeight:600,color:"#5856d6",letterSpacing:"0.3px" }}>EXCLUSIVE SUPPLIER</span>
                                </label>

                                <div style={{ display:"flex",gap:8,marginTop:4 }}>
                                  <button onClick={()=>{
                                    if (!customSupplierForm.name.trim()) return;
                                    const breaks = customSupplierForm.breaks
                                      .map(b => ({ qty: parseInt(b.qty)||1, price: parseFloat(b.price)||0 }))
                                      .filter(b => b.price > 0)
                                      .sort((a,b) => a.qty - b.qty);
                                    if (breaks.length === 0) return;
                                    saveCustomSupplier(part.id, { ...customSupplierForm, breaks });
                                  }}
                                    style={{ padding:"7px 18px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                      border:"none",background:"#0071e3",color:"#fff" }}>
                                    Save
                                  </button>
                                  <button onClick={()=>setCustomSupplierForm(null)}
                                    style={{ padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"inherit",
                                      border:"1px solid #d2d2d7",background:"none",color:"#86868b" }}>
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* ── Price History ── */}
                            {(() => {
                              const history = partPriceHistoryCache[part.id];
                              const loadHistory = () => {
                                fetchPriceHistory(part.id).then(rows => {
                                  setPartPriceHistoryCache(prev => ({ ...prev, [part.id]: rows || [] }));
                                }).catch(e => console.error("[priceHistory]", e));
                              };
                              if (!history) {
                                // Auto-load when expanded
                                loadHistory();
                                return (
                                  <div style={{ padding:"12px 16px",background:"#f9f9fb",borderRadius:12,marginBottom:14,fontSize:12,color:"#86868b" }}>
                                    Loading price history...
                                  </div>
                                );
                              }
                              if (history.length === 0) return (
                                <div style={{ padding:"12px 16px",background:"#f9f9fb",borderRadius:12,marginBottom:14,fontSize:12,color:"#aeaeb2" }}>
                                  No price history recorded yet
                                </div>
                              );
                              const prices = history.map(h => parseFloat(h.unit_price));
                              const minP = Math.min(...prices);
                              const maxP = Math.max(...prices);
                              const avgP = prices.reduce((s,v)=>s+v,0) / prices.length;
                              const latest = prices[0];
                              const previous = prices.length > 1 ? prices[1] : null;
                              const trendUp = previous !== null && latest > previous;
                              const trendDown = previous !== null && latest < previous;
                              // Sparkline — colored bars for last N prices (reversed so oldest first)
                              const sparkData = prices.slice(0, 12).reverse();
                              const sparkMin = Math.min(...sparkData);
                              const sparkMax = Math.max(...sparkData);
                              const sparkRange = sparkMax - sparkMin || 1;
                              return (
                                <div style={{ padding:"14px 16px",background:"#f9f9fb",borderRadius:12,marginBottom:14,border:"1px solid #e5e5ea" }}>
                                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                                    <div style={{ fontSize:12,fontWeight:700,color:"#1d1d1f",letterSpacing:"0.3px" }}>
                                      Price History
                                      {trendUp && <span style={{ color:"#ff3b30",marginLeft:6,fontSize:13 }}>{"\u2191"}</span>}
                                      {trendDown && <span style={{ color:"#34c759",marginLeft:6,fontSize:13 }}>{"\u2193"}</span>}
                                      {previous !== null && latest !== previous && (
                                        <span style={{ fontSize:10,color:trendUp?"#ff3b30":"#34c759",marginLeft:4,fontWeight:500 }}>
                                          {((Math.abs(latest - previous) / previous) * 100).toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                    <button onClick={(e)=>{e.stopPropagation();loadHistory();}}
                                      style={{ fontSize:10,color:"#0071e3",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>
                                      Refresh
                                    </button>
                                  </div>
                                  {/* Stats row */}
                                  <div style={{ display:"flex",gap:16,marginBottom:10,fontSize:11 }}>
                                    <div><span style={{ color:"#86868b" }}>Min: </span><span style={{ fontWeight:600,color:"#34c759" }}>${fmtPrice(minP)}</span></div>
                                    <div><span style={{ color:"#86868b" }}>Max: </span><span style={{ fontWeight:600,color:"#ff3b30" }}>${fmtPrice(maxP)}</span></div>
                                    <div><span style={{ color:"#86868b" }}>Avg: </span><span style={{ fontWeight:600,color:"#1d1d1f" }}>${fmtPrice(avgP)}</span></div>
                                    <div><span style={{ color:"#86868b" }}>Records: </span><span style={{ fontWeight:600,color:"#1d1d1f" }}>{history.length}</span></div>
                                  </div>
                                  {/* Sparkline bar chart */}
                                  {sparkData.length >= 3 && (
                                    <div style={{ display:"flex",alignItems:"flex-end",gap:2,height:32,marginBottom:10 }}>
                                      {sparkData.map((v, i) => {
                                        const pct = ((v - sparkMin) / sparkRange) * 100;
                                        const h = Math.max(4, 4 + (pct / 100) * 28);
                                        const isLast = i === sparkData.length - 1;
                                        return <div key={i} style={{ flex:1,height:h,borderRadius:2,background:isLast?"#0071e3":"#d2d2d7",transition:"height 0.2s" }}
                                          title={`$${fmtPrice(v)}`} />;
                                      })}
                                    </div>
                                  )}
                                  {/* History table */}
                                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:11 }}>
                                    <thead>
                                      <tr style={{ borderBottom:"1px solid #e5e5ea" }}>
                                        {["Date","Price","Supplier","Source"].map(h=>(
                                          <th key={h} style={{ textAlign:"left",padding:"5px 8px",fontSize:9,fontWeight:700,color:"#86868b",letterSpacing:"0.05em",textTransform:"uppercase" }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {history.slice(0, 10).map((row, ri) => (
                                        <tr key={row.id || ri} style={{ borderBottom:"1px solid #f0f0f2" }}>
                                          <td style={{ padding:"5px 8px",color:"#6e6e73" }}>{new Date(row.recorded_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td>
                                          <td style={{ padding:"5px 8px",fontWeight:600,color:"#1d1d1f" }}>${fmtPrice(row.unit_price)}</td>
                                          <td style={{ padding:"5px 8px",color:"#6e6e73" }}>{row.supplier || "—"}</td>
                                          <td style={{ padding:"5px 8px" }}>
                                            <span style={{ display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:600,
                                              background:row.source==="invoice"?"rgba(255,149,0,0.1)":row.source==="pricing"?"rgba(0,113,227,0.08)":"rgba(134,134,139,0.1)",
                                              color:row.source==="invoice"?"#ff9500":row.source==="pricing"?"#0071e3":"#86868b" }}>
                                              {row.source}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {history.length > 10 && <div style={{ fontSize:10,color:"#aeaeb2",marginTop:6,textAlign:"center" }}>Showing 10 of {history.length} records</div>}
                                  {history.length >= 2 && (
                                    <div style={{ marginTop:14 }}>
                                      <PriceChart data={history} darkMode={darkMode} title={`${part.mpn || part.reference || "Part"} — Price History`} height={180} />
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

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
            PURCHASING — Build Order Checkout
        ══════════════════════════════════════ */}
        {activeView === "purchasing" && (() => {
          // Aggregate parts demand across all queued products
          const aggregated = {};
          for (const item of buildQueue) {
            const prodParts = parts.filter(p => p.projectId === item.productId);
            for (const part of prodParts) {
              if (!aggregated[part.id]) {
                aggregated[part.id] = { part, totalNeeded: 0, products: [] };
              }
              aggregated[part.id].totalNeeded += (parseInt(part.quantity) || 1) * item.qty;
              aggregated[part.id].products.push({ name: item.name, qty: item.qty, perUnit: parseInt(part.quantity) || 1 });
            }
          }
          const demandList = Object.values(aggregated).map(d => {
            const stock = parseInt(d.part.stockQty) || 0;
            const net = Math.max(0, d.totalNeeded - stock);
            // Get best price
            const pr = d.part.pricing && typeof d.part.pricing === "object" ? d.part.pricing : null;
            let bestPrice = parseFloat(d.part.unitCost) || 0;
            let bestSupplier = d.part.preferredSupplier || "mouser";
            let bestSupplierName = "";
            if (pr) {
              const entries = Object.entries(pr).filter(([,dd]) => dd.stock > 0);
              if (entries.length) {
                const calc = (dd) => { let p = dd.unitPrice; if (dd.priceBreaks?.length) { for (const pb of dd.priceBreaks) { if (net >= pb.qty) p = pb.price; } } return parseFloat(p) || dd.unitPrice; };
                entries.sort((a,b) => (calc(a[1])||Infinity) - (calc(b[1])||Infinity));
                bestPrice = calc(entries[0][1]);
                bestSupplier = entries[0][0];
                bestSupplierName = entries[0][1].displayName || entries[0][0];
              }
            }
            return { ...d, stock, net, bestPrice, bestSupplier, bestSupplierName, isInternal: d.part.isInternal || false };
          }).filter(d => d.net > 0);

          // Group by supplier
          const supplierGroups = {};
          const internalItems = [];
          for (const d of demandList) {
            if (d.isInternal) { internalItems.push(d); continue; }
            const sid = d.bestSupplier;
            if (!supplierGroups[sid]) supplierGroups[sid] = [];
            supplierGroups[sid].push(d);
          }

          const grandTotal = demandList.reduce((s, d) => s + d.bestPrice * d.net, 0);
          const totalParts = demandList.length;

          return (
          <div style={{ background:"#f5f5f7",borderRadius:16,padding:"28px 24px",margin:"-8px -4px",minHeight:"60vh" }}>
            <div style={{ marginBottom:28 }}>
              <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:"#1d1d1f",marginBottom:4 }}>Purchasing</h2>
              <p style={{ fontSize:14,color:"#86868b" }}>Add products on the Products page, then review and order parts here.</p>
            </div>

            {buildQueue.length === 0 ? (
              <div style={{ background:"#fff",borderRadius:16,padding:"60px 30px",textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize:16,fontWeight:600,color:"#1d1d1f",marginBottom:8 }}>No products in the build queue</div>
                <div style={{ color:"#86868b",fontSize:13,maxWidth:400,margin:"0 auto 20px" }}>
                  Go to Products and enter a quantity next to any product, then click Order to add it here.
                </div>
                <button onClick={()=>setActiveView("projects")}
                  style={{ padding:"8px 24px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#0071e3",color:"#fff" }}>
                  Go to Products
                </button>
              </div>
            ) : (<>
              {/* ── Build Queue */}
              <div style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:24 }}>
                <div style={{ padding:"16px 22px",borderBottom:"1px solid #f0f0f2",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:500,letterSpacing:"0.5px",textTransform:"uppercase" }}>Build Queue — {buildQueue.length} product{buildQueue.length!==1?"s":""}</div>
                  <button onClick={() => setBuildQueue([])}
                    style={{ fontSize:11,color:"#ff3b30",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>
                    Clear All
                  </button>
                </div>
                {buildQueue.map((item, idx) => {
                  const prod = productCosts.find(p => p.id === item.productId);
                  const unitCost = prod ? prod.total : 0;
                  const extCost = unitCost * item.qty;
                  return (
                    <div key={item.productId} style={{ display:"flex",alignItems:"center",padding:"14px 22px",
                      borderBottom:idx<buildQueue.length-1?"1px solid #f0f0f2":"none",gap:16 }}>
                      <div style={{ flex:1,minWidth:0 }}>
                        <div style={{ fontSize:15,fontWeight:600,color:"#1d1d1f" }}>{item.name}</div>
                        <div style={{ fontSize:12,color:"#86868b",marginTop:1 }}>
                          <span style={{ display:"inline-block",width:6,height:6,borderRadius:"50%",background:item.color,marginRight:4,verticalAlign:"middle" }} />
                          ${fmtPrice(unitCost)} per unit
                        </div>
                      </div>
                      <div style={{ flex:"0 0 auto",display:"flex",alignItems:"center",gap:6 }}>
                        <span style={{ fontSize:10,color:"#86868b",fontWeight:500,letterSpacing:"0.5px",textTransform:"uppercase" }}>Qty</span>
                        <input type="number" min="1" value={item.qty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 1;
                            setBuildQueue(prev => prev.map(q => q.productId === item.productId ? { ...q, qty: val } : q));
                          }}
                          style={{ width:64,padding:"5px 8px",borderRadius:6,fontSize:14,fontWeight:700,textAlign:"center",
                            border:"1px solid #d2d2d7",fontFamily:"inherit",outline:"none",color:"#1d1d1f" }} />
                      </div>
                      <div style={{ flex:"0 0 auto",textAlign:"right",minWidth:90 }}>
                        <div style={{ fontSize:18,fontWeight:600,color:"#1d1d1f" }}>{"$"}{fmtDollar(extCost)}</div>
                      </div>
                      <button onClick={() => setBuildQueue(prev => prev.filter(q => q.productId !== item.productId))}
                        style={{ background:"none",border:"none",color:"#c7c7cc",fontSize:14,cursor:"pointer",padding:"2px 6px",borderRadius:4,transition:"color 0.15s" }}
                        onMouseOver={(e)=>e.target.style.color="#ff3b30"}
                        onMouseOut={(e)=>e.target.style.color="#c7c7cc"}>✕</button>
                    </div>
                  );
                })}
                {/* Queue totals */}
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 22px",background:"#f9f9fb",borderTop:"1px solid #f0f0f2" }}>
                  <div style={{ fontSize:12,color:"#86868b" }}>
                    {buildQueue.reduce((s,q) => s+q.qty, 0).toLocaleString()} total units · {totalParts} unique parts to order
                  </div>
                  <div style={{ fontSize:18,fontWeight:700,color:"#1d1d1f" }}>
                    Est. {"$"}{fmtDollar(grandTotal)}
                  </div>
                </div>
              </div>

              {/* ── Parts Needed (aggregated across all products) */}
              {demandList.length > 0 && (
                <div style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:24 }}>
                  <div style={{ padding:"16px 22px",borderBottom:"1px solid #f0f0f2" }}>
                    <div style={{ fontSize:10,color:"#86868b",fontWeight:500,letterSpacing:"0.5px",textTransform:"uppercase" }}>Parts to Order — {demandList.length} items</div>
                  </div>
                  {demandList.map((d, idx) => (
                    <div key={d.part.id} style={{ display:"flex",alignItems:"center",padding:"14px 22px",
                      borderBottom:idx<demandList.length-1?"1px solid #f0f0f2":"none",gap:16 }}>
                      <div style={{ flex:"1 1 200px",minWidth:0 }}>
                        <div style={{ fontSize:15,fontWeight:600,color:"#1d1d1f" }}>{d.part.mpn || d.part.reference || "—"}</div>
                        <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>
                          {[d.part.description, d.part.value].filter(Boolean).join(" — ") || ""}
                          {d.products.length > 0 && (
                            <span style={{ marginLeft:6 }}>
                              {d.products.map((p,i) => <span key={i} style={{ color:"#5856d6" }}>{i>0?", ":""}{p.name} ×{p.perUnit}</span>)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ flex:"0 0 auto",textAlign:"center",minWidth:70 }}>
                        <div style={{ fontSize:10,color:"#86868b",fontWeight:500,letterSpacing:"0.5px",textTransform:"uppercase" }}>Need</div>
                        <div style={{ fontSize:15,fontWeight:700,color:"#1d1d1f" }}>{d.net.toLocaleString()}</div>
                      </div>
                      <div style={{ flex:"0 0 auto",textAlign:"center",minWidth:60 }}>
                        {d.isInternal
                          ? <span style={{ fontSize:9,fontWeight:700,letterSpacing:"0.04em",padding:"3px 8px",borderRadius:4,background:"rgba(88,86,214,0.1)",color:"#5856d6" }}>IN-HOUSE</span>
                          : d.bestSupplierName
                          ? <span style={{ fontSize:10,color:"#86868b" }}>{d.bestSupplierName}</span>
                          : null}
                      </div>
                      <div style={{ flex:"0 0 auto",textAlign:"right",minWidth:90 }}>
                        {d.bestPrice > 0
                          ? <>
                              <div style={{ fontSize:18,fontWeight:600,color:"#1d1d1f" }}>{"$"}{fmtDollar(d.bestPrice * d.net)}</div>
                              <div style={{ fontSize:11,color:"#86868b" }}>${fmtPrice(d.bestPrice)} ea</div>
                            </>
                          : <div style={{ fontSize:14,color:"#c7c7cc" }}>—</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Supplier PO Cards */}
              {internalItems.length > 0 && (
                <div style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:16 }}>
                  <div style={{ padding:"16px 22px",borderBottom:"1px solid #f0f0f2",display:"flex",alignItems:"center",gap:10 }}>
                    <span style={{ fontSize:10,fontWeight:700,letterSpacing:"0.04em",padding:"3px 8px",borderRadius:4,background:"rgba(88,86,214,0.1)",color:"#5856d6" }}>IN-HOUSE</span>
                    <span style={{ fontSize:12,color:"#86868b" }}>{internalItems.length} items to produce internally</span>
                  </div>
                  {internalItems.map((d, idx) => (
                    <div key={d.part.id} style={{ display:"flex",alignItems:"center",padding:"12px 22px",borderBottom:idx<internalItems.length-1?"1px solid #f0f0f2":"none" }}>
                      <div style={{ flex:1 }}><span style={{ fontWeight:600,color:"#1d1d1f" }}>{d.part.mpn || d.part.reference}</span></div>
                      <div style={{ fontWeight:700 }}>{d.net.toLocaleString()} needed</div>
                    </div>
                  ))}
                </div>
              )}

              {Object.entries(supplierGroups).map(([sid, items]) => {
                let distNames = {}; try { distNames = JSON.parse(apiKeys.distributor_names || "{}"); } catch {}
                const baseSup = SUPPLIERS.find(s => s.id === sid) || { id: sid, name: sid, color: "#86868b", bg: "#f5f5f7", logo: "?" };
                const sup = { ...baseSup, name: distNames[sid] || baseSup.name };
                const poNum = genPONumber(sid);
                const poTotal = items.reduce((s, d) => s + d.bestPrice * d.net, 0);
                const totalUnits = items.reduce((s, d) => s + d.net, 0);
                const poLines = items.map(d => ({ ...d.part, neededQty: d.net, unitCost: d.bestPrice, orderQty: d.net }));
                const orderMode = getSupplierOrderMode(sid, apiKeys.supplier_order_modes);
                const modeConf = ORDER_MODE_CONFIG[orderMode] || ORDER_MODE_CONFIG.manual;
                let supplierEmails = {}; try { supplierEmails = JSON.parse(apiKeys.supplier_emails || "{}"); } catch {}
                const repEmail = supplierEmails[sid] || "";
                const repName = distNames[sid] || sup.name;
                // Find last order date for this supplier from PO history
                const lastOrder = poHistory.filter(po => (po.supplier||"").toLowerCase().includes(sid)).sort((a,b) => new Date(b.ordered_at||b.created_at) - new Date(a.ordered_at||a.created_at))[0];
                return (
                  <div key={sid} style={{ background:"#fff",borderRadius:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:16 }}>
                    <div style={{ padding:"16px 22px",borderBottom:"1px solid #f0f0f2",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                        <div style={{ width:32,height:32,background:sup.color,borderRadius:8,display:"flex",
                          alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:11,color:"#fff" }}>{sup.logo}</div>
                        <div>
                          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                            <span style={{ fontWeight:700,fontSize:14,color:"#1d1d1f" }}>{sup.name}</span>
                            <span style={{ display:"inline-block",padding:"2px 8px",borderRadius:980,fontSize:9,fontWeight:700,
                              letterSpacing:"0.04em",textTransform:"uppercase",background:modeConf.bg,color:modeConf.color }}>
                              {modeConf.label}
                            </span>
                          </div>
                          <div style={{ fontSize:11,color:"#86868b" }}>{items.length} parts · {totalUnits.toLocaleString()} units · {"$"}{fmtDollar(poTotal)}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:8,flexWrap:"wrap",alignItems:"center" }}>
                        <button onClick={()=>exportPOasCSV(sup,poLines,poNum)}
                          style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}>
                          CSV
                        </button>
                        <button onClick={()=>printPO(sup,poLines,poNum,{name:apiKeys.company_name,address:apiKeys.company_address})}
                          style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}>
                          Print PO
                        </button>
                        <button onClick={() => {
                            const draft = buildPOEmailDraft(sup.name, poLines, poNum, {name:apiKeys.company_name,address:apiKeys.company_address});
                            window.location.href = `mailto:${repEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
                          }}
                          style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}>
                          Email PO
                        </button>

                        {/* ── Order Mode Action Button */}
                        {orderMode === "api" && sup.id === "mouser" && apiKeys.mouser_order_api_key && (
                          <button disabled={mouserCartStatus?.loading}
                            onClick={async () => {
                              setMouserCartStatus({ loading: true });
                              try {
                                const cartItems = [];
                                for (const d of items) {
                                  const mouserPN = d.part.pricing?.mouser?.mouserPartNumber || d.part.mpn;
                                  cartItems.push({ mouserPartNumber: mouserPN, quantity: d.net });
                                }
                                const result = await mouserCreateCart(apiKeys.mouser_order_api_key, cartItems);
                                setMouserCartStatus({ loading: false, ...result });
                                addTrackedOrder({ supplier: "Mouser", supplierColor: "#e8500a", poNumber: poNum,
                                  items: items.map(d => ({ mpn: d.part.mpn, reference: d.part.reference, qty: d.net, unitPrice: d.bestPrice })),
                                  totalEstimate: poTotal, cartKey: result.cartKey, cartUrl: result.cartUrl });
                                try { await createPORecord({ supplier: sup.name, po_number: poNum, status: "submitted", items: items.map(d => ({ mpn: d.part.mpn, qty: d.net, unitPrice: d.bestPrice })), total_value: poTotal, notes: "Sent to Mouser Cart via API", ordered_at: new Date().toISOString() }, user.id); } catch {}
                                window.open(result.cartUrl, "_blank");
                              } catch (e) { setMouserCartStatus({ loading: false, error: e.message }); }
                            }}
                            style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#34c759",color:"#fff" }}>
                            {mouserCartStatus?.loading ? "Sending..." : "Place Order via API"}
                          </button>
                        )}
                        {orderMode === "api" && sup.id === "digikey" && (
                          <button onClick={async () => {
                              const dkItems = items.map(d => ({
                                partNumber: d.part.pricing?.digikey?.supplierPartNumber || d.part.mpn,
                                quantity: d.net,
                              }));
                              const cartUrl = buildDigiKeyCartUrl(dkItems);
                              addTrackedOrder({ supplier: sup.name, supplierColor: sup.color, poNumber: poNum,
                                items: items.map(d => ({ mpn: d.part.mpn, reference: d.part.reference, qty: d.net, unitPrice: d.bestPrice })),
                                totalEstimate: poTotal, cartUrl });
                              try { await createPORecord({ supplier: sup.name, po_number: poNum, status: "submitted", items: items.map(d => ({ mpn: d.part.mpn, qty: d.net, unitPrice: d.bestPrice })), total_value: poTotal, notes: "DigiKey cart URL opened", ordered_at: new Date().toISOString() }, user.id); } catch {}
                              window.open(cartUrl, "_blank");
                            }}
                            style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#34c759",color:"#fff" }}>
                            Place Order via API
                          </button>
                        )}
                        {orderMode === "api" && sup.id !== "mouser" && sup.id !== "digikey" && (
                          <button onClick={() => {
                              const url = SUPPLIER_WEBSITE_URLS[sid] || sup.searchUrl?.(items[0]?.part?.mpn || "") || "#";
                              window.open(url, "_blank");
                            }}
                            style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#34c759",color:"#fff" }}>
                            Open {sup.name}
                          </button>
                        )}
                        {orderMode === "rep" && (
                          <button onClick={async () => {
                              const draft = buildPOEmailDraft(repName, poLines, poNum, {name:apiKeys.company_name,address:apiKeys.company_address});
                              window.location.href = `mailto:${repEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
                              addTrackedOrder({ supplier: sup.name, supplierColor: sup.color, poNumber: poNum,
                                items: items.map(d => ({ mpn: d.part.mpn, reference: d.part.reference, qty: d.net, unitPrice: d.bestPrice })),
                                totalEstimate: poTotal, notes: `Submitted to rep: ${repName} (${repEmail})` });
                              try { await createPORecord({ supplier: sup.name, po_number: poNum, status: "submitted", items: items.map(d => ({ mpn: d.part.mpn, qty: d.net, unitPrice: d.bestPrice })), total_value: poTotal, notes: `Emailed to rep: ${repEmail}`, ordered_at: new Date().toISOString() }, user.id); } catch {}
                            }}
                            style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#0071e3",color:"#fff" }}>
                            Email PO to Rep
                          </button>
                        )}
                        {orderMode === "manual" && (
                          <button onClick={() => {
                              const url = SUPPLIER_WEBSITE_URLS[sid] || sup.searchUrl?.(items[0]?.part?.mpn || "") || "#";
                              window.open(url, "_blank");
                            }}
                            style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}>
                            Open Supplier Website
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ── Rep Contact Info (for rep-managed suppliers) */}
                    {orderMode === "rep" && (repEmail || lastOrder) && (
                      <div style={{ padding:"8px 22px",background:"rgba(0,113,227,0.04)",borderBottom:"1px solid #f0f0f2",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap",fontSize:11,color:"#6e6e73" }}>
                        {repEmail && (
                          <span>Rep: <strong style={{ color:"#0071e3" }}>{repName}</strong> &middot; <a href={`mailto:${repEmail}`} style={{ color:"#0071e3",textDecoration:"none" }}>{repEmail}</a></span>
                        )}
                        {lastOrder && (
                          <span>Last ordered: {new Date(lastOrder.ordered_at || lastOrder.created_at).toLocaleDateString()}</span>
                        )}
                      </div>
                    )}

                    {items.map((d, idx) => {
                      const isFullReel = fullReelParts.has(d.part.id);
                      const reelQty = getReelQty(d.part);
                      const qty = isFullReel && reelQty ? reelQty : d.net;
                      // Get best price at reel quantity
                      const priceAtReel = (() => {
                        if (!isFullReel || !d.part.pricing) return d.bestPrice;
                        const pr = d.part.pricing[sid] || Object.values(d.part.pricing).find(s => s.priceBreaks?.length);
                        if (!pr?.priceBreaks?.length) return d.bestPrice;
                        let price = pr.unitPrice;
                        for (const pb of pr.priceBreaks) { if (qty >= pb.qty) price = pb.price; }
                        return parseFloat(price) || d.bestPrice;
                      })();
                      return (
                      <div key={d.part.id} style={{ display:"flex",alignItems:"center",padding:"12px 22px",
                        borderBottom:idx<items.length-1?"1px solid #f0f0f2":"none",gap:12 }}>
                        <div style={{ flex:"1 1 200px",minWidth:0 }}>
                          <div style={{ fontWeight:600,fontSize:14,color:"#1d1d1f" }}>{d.part.mpn || d.part.reference}</div>
                          <div style={{ fontSize:11,color:"#86868b" }}>{[d.part.description, d.part.value].filter(Boolean).join(" — ")}</div>
                        </div>
                        <div style={{ flex:"0 0 auto",display:"flex",alignItems:"center",gap:6 }}>
                          <label style={{ display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,
                            padding:"3px 8px",borderRadius:4,
                            border:isFullReel?"1px solid #34c759":"1px solid #d2d2d7",
                            background:isFullReel?"rgba(52,199,89,0.08)":"transparent",
                            color:isFullReel?"#34c759":"#86868b",fontWeight:600 }}
                            title={reelQty ? `Full reel: ${reelQty.toLocaleString()} units` : "Full reel"}>
                            <input type="checkbox" checked={isFullReel}
                              onChange={()=>setFullReelParts(prev=>{const s=new Set(prev);s.has(d.part.id)?s.delete(d.part.id):s.add(d.part.id);return s;})}
                              style={{ width:12,height:12,accentColor:"#34c759",cursor:"pointer" }} />
                            Reel{reelQty ? ` (${reelQty.toLocaleString()})` : ""}
                          </label>
                        </div>
                        <div style={{ flex:"0 0 auto",fontWeight:700,fontSize:14,color:isFullReel?"#34c759":"#1d1d1f",minWidth:60,textAlign:"center" }}>
                          {qty.toLocaleString()}
                        </div>
                        <div style={{ flex:"0 0 auto",textAlign:"right",minWidth:80 }}>
                          <div style={{ fontWeight:600,color:"#1d1d1f" }}>{"$"}{fmtDollar(priceAtReel * qty)}</div>
                          <div style={{ fontSize:10,color:isFullReel?"#34c759":"#86868b" }}>${fmtPrice(priceAtReel)} ea{isFullReel && priceAtReel < d.bestPrice ? " (reel price)" : ""}</div>
                        </div>
                      </div>
                    );})}
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"12px 22px",background:"#f9f9fb",borderTop:"1px solid #f0f0f2" }}>
                      {fullReelParts.size > 0 && <span style={{ fontSize:11,color:"#34c759",fontWeight:600 }}>{[...fullReelParts].filter(id => items.some(d => d.part.id === id)).length} full reel(s)</span>}
                      <span style={{ fontSize:16,fontWeight:700,color:"#1d1d1f",marginLeft:"auto" }}>{"$"}{fmtDollar(items.reduce((s, d) => {
                        const isReel = fullReelParts.has(d.part.id);
                        const rq = getReelQty(d.part);
                        const q = isReel && rq ? rq : d.net;
                        const pr = (() => { if (!isReel || !d.part.pricing) return d.bestPrice; const p = d.part.pricing[sid] || Object.values(d.part.pricing).find(x => x.priceBreaks?.length); if (!p?.priceBreaks?.length) return d.bestPrice; let price = p.unitPrice; for (const pb of p.priceBreaks) { if (q >= pb.qty) price = pb.price; } return parseFloat(price) || d.bestPrice; })();
                        return s + pr * q;
                      }, 0))}</span>
                    </div>
                  </div>
                );
              })}

              {/* Grand total */}
              <div style={{ display:"flex",justifyContent:"flex-end",padding:"16px 0",gap:20,alignItems:"center" }}>
                <span style={{ fontSize:14,color:"#86868b" }}>Estimated Total</span>
                <span style={{ fontSize:24,fontWeight:800,color:"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif" }}>
                  {"$"}{fmtDollar(grandTotal)}
                </span>
              </div>
            </>)}
          </div>
          );
        })()}

        {/* ══════════════════════════════════════
            ORDERS — Order Tracker & Shipment Tracking
        ══════════════════════════════════════ */}
        {activeView === "orders" && (
          <div>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12 }}>
              <div>
                <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:21,fontWeight:800,marginBottom:4 }}>Order Tracker</h2>
                <p style={{ color:"#86868b",fontSize:13,marginBottom:8 }}>Track orders across all suppliers. Mouser cart orders are logged automatically.</p>
                <div style={{ display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                  <span style={{ fontSize:12,color:"#86868b" }}>Mobile Invoice Scanner:</span>
                  <code style={{ fontSize:11,color:darkMode?"#f8d377":"#5856d6",background:darkMode?"#1c1c1e":"#f0f0f2",padding:"3px 8px",borderRadius:5,fontFamily:"SF Mono,monospace",userSelect:"all" }}>
                    {window.location.origin + window.location.pathname + "#invoice"}
                  </code>
                  <button onClick={() => { navigator.clipboard.writeText(window.location.origin + window.location.pathname + "#invoice"); }}
                    style={{ padding:"4px 10px",borderRadius:980,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:darkMode?"#3a3a3e":"#e5e5ea",color:darkMode?"#f5f5f7":"#1d1d1f" }}>
                    Copy Link
                  </button>
                  <button onClick={() => window.open(window.location.origin + window.location.pathname + "#invoice", "_blank", "noopener")}
                    style={{ padding:"4px 10px",borderRadius:980,fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#f8d377",color:"#0a0a0f" }}>
                    Open &#8599;
                  </button>
                </div>
              </div>
              <button className="btn-primary" onClick={() => setOrderForm({
                supplier: "Mouser", supplierColor: "#e8500a", poNumber: "", notes: "",
                items: [{ mpn: "", qty: 1, unitPrice: "" }],
              })}>
                + Log Existing Order
              </button>
            </div>

            {/* Manual order form */}
            {orderForm && (
              <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:20,overflow:"hidden" }}>
                <div style={{ background:"#b8bdd1",padding:"14px 20px" }}>
                  <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                    Log New Order
                  </div>
                </div>
                <div style={{ padding:"16px 20px" }}>
                  <div style={{ display:"flex",gap:12,flexWrap:"wrap",marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:3,textTransform:"uppercase" }}>Supplier</div>
                      <select value={orderForm.supplier}
                        onChange={e => {
                          const sup = SUPPLIERS.find(s => s.name === e.target.value);
                          setOrderForm(f => ({ ...f, supplier: e.target.value, supplierColor: sup?.color || "#8e8e93" }));
                        }}
                        style={{ padding:"7px 10px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",minWidth:140 }}>
                        {SUPPLIERS.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:3,textTransform:"uppercase" }}>PO / Order Number</div>
                      <input type="text" placeholder="PO-2026-001" value={orderForm.poNumber}
                        onChange={e => setOrderForm(f => ({ ...f, poNumber: e.target.value }))}
                        style={{ padding:"7px 10px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",width:160 }} />
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:3,textTransform:"uppercase" }}>Notes</div>
                      <input type="text" placeholder="Optional notes" value={orderForm.notes}
                        onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))}
                        style={{ padding:"7px 10px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",width:"100%" }} />
                    </div>
                  </div>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:6,textTransform:"uppercase" }}>Line Items</div>
                  {orderForm.items.map((item, ii) => (
                    <div key={ii} style={{ display:"flex",gap:8,marginBottom:6,alignItems:"center" }}>
                      <input type="text" placeholder="MPN" value={item.mpn}
                        onChange={e => { const items = [...orderForm.items]; items[ii] = { ...items[ii], mpn: e.target.value }; setOrderForm(f => ({ ...f, items })); }}
                        style={{ padding:"6px 10px",borderRadius:6,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",width:180 }} />
                      <input type="number" placeholder="Qty" value={item.qty} min={1}
                        onChange={e => { const items = [...orderForm.items]; items[ii] = { ...items[ii], qty: parseInt(e.target.value)||1 }; setOrderForm(f => ({ ...f, items })); }}
                        style={{ padding:"6px 10px",borderRadius:6,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",width:70 }} />
                      <span style={{ fontSize:11,color:"#aeaeb2" }}>$</span>
                      <input type="number" step="0.01" placeholder="Unit price" value={item.unitPrice}
                        onChange={e => { const items = [...orderForm.items]; items[ii] = { ...items[ii], unitPrice: e.target.value }; setOrderForm(f => ({ ...f, items })); }}
                        style={{ padding:"6px 10px",borderRadius:6,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit",width:100 }} />
                      {orderForm.items.length > 1 && (
                        <button onClick={() => { const items = orderForm.items.filter((_,i) => i !== ii); setOrderForm(f => ({ ...f, items })); }}
                          style={{ background:"none",border:"none",color:"#ff3b30",cursor:"pointer",fontSize:14,fontWeight:700,padding:"2px 6px" }}>×</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => setOrderForm(f => ({ ...f, items: [...f.items, { mpn: "", qty: 1, unitPrice: "" }] }))}
                    style={{ fontSize:11,color:"#0071e3",background:"none",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",fontWeight:500,marginTop:4 }}>
                    + Add Line
                  </button>
                  <div style={{ display:"flex",gap:8,marginTop:14 }}>
                    <button className="btn-primary" onClick={async () => {
                      const total = orderForm.items.reduce((s, i) => s + (parseFloat(i.unitPrice)||0) * (i.qty||0), 0);
                      const filteredItems = orderForm.items.filter(i => i.mpn);
                      const newOrder = addTrackedOrder({ ...orderForm, totalEstimate: total, items: filteredItems });
                      // Also save to po_history table
                      try {
                        await createPORecord({
                          supplier: orderForm.supplier || "Mouser",
                          po_number: orderForm.poNumber || "",
                          status: "submitted",
                          items: filteredItems,
                          total_value: total,
                          notes: orderForm.notes || "",
                          ordered_at: new Date().toISOString(),
                        }, user.id);
                      } catch (e) { console.warn("[PO History] DB save failed:", e.message); }
                      setOrderForm(null);
                    }}>Save Order</button>
                    <button className="btn-ghost" onClick={() => setOrderForm(null)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {trackedOrders.length === 0 ? (
              <div className="card" style={{ textAlign:"center",padding:"60px 30px" }}>
                <div style={{ fontSize:44,marginBottom:14 }}>📋</div>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:16,marginBottom:8 }}>No Orders Tracked Yet</div>
                <div style={{ color:"#86868b",fontSize:13,maxWidth:440,margin:"0 auto" }}>
                  Orders are logged automatically when you use "Send to Mouser Cart" from the Purchasing page, or you can log orders from any supplier manually.
                </div>
              </div>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
                {trackedOrders.map((order) => {
                  const isOpen = expandedOrder === order.id;
                  const statusColors = {
                    submitted: { bg: "rgba(0,113,227,0.1)", color: "#0071e3", label: "Submitted" },
                    processing: { bg: "rgba(255,149,0,0.1)", color: "#ff9500", label: "Processing" },
                    shipped: { bg: "rgba(52,199,89,0.1)", color: "#34c759", label: "Shipped" },
                    delivered: { bg: "rgba(52,199,89,0.15)", color: "#248a3d", label: "Delivered" },
                    cancelled: { bg: "rgba(255,59,48,0.1)", color: "#ff3b30", label: "Cancelled" },
                  };
                  const st = statusColors[order.status] || statusColors.submitted;
                  const orderDate = new Date(order.createdAt).toLocaleDateString();
                  const itemCount = order.items?.length || 0;

                  return (
                    <div key={order.id} style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",overflow:"hidden" }}>
                      {/* Order header row */}
                      <div onClick={() => setExpandedOrder(isOpen ? null : order.id)}
                        style={{ display:"flex",alignItems:"center",padding:"14px 20px",cursor:"pointer",gap:16,transition:"background 0.15s" }}
                        onMouseOver={e => e.currentTarget.style.background = "rgba(0,0,0,0.015)"}
                        onMouseOut={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width:36,height:36,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",
                          background: order.supplierColor || "#8e8e93",color:"#fff",fontWeight:800,fontSize:11,
                          fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",flexShrink:0 }}>
                          {(order.supplier || "?").slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                            <span style={{ fontWeight:700,fontSize:14,color:"#1d1d1f" }}>{order.supplier}</span>
                            {order.poNumber && <span style={{ fontSize:12,color:"#86868b" }}>#{order.poNumber}</span>}
                            <span style={{ display:"inline-block",padding:"2px 10px",borderRadius:980,fontSize:10,fontWeight:600,
                              background: st.bg, color: st.color }}>{st.label}</span>
                          </div>
                          <div style={{ fontSize:12,color:"#86868b",marginTop:2 }}>
                            {orderDate} · {itemCount} item{itemCount !== 1 ? "s" : ""}
                            {order.totalEstimate > 0 ? ` · est. $${fmtDollar(order.totalEstimate)}` : ""}
                            {order.trackingNumbers?.length > 0 && ` · ${order.trackingNumbers.length} tracking #`}
                          </div>
                        </div>
                        {/* Tracking link shortcut */}
                        {order.trackingNumbers?.length > 0 && (
                          <a href={getTrackingUrl(order.trackingNumbers[0], order.carrier)}
                            target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            style={{ padding:"5px 12px",borderRadius:980,fontSize:11,fontWeight:600,textDecoration:"none",
                              background:"rgba(0,113,227,0.08)",color:"#0071e3",whiteSpace:"nowrap" }}>
                            Track Package
                          </a>
                        )}
                        <span style={{ fontSize:12,color:"#86868b",transition:"transform 0.2s",display:"inline-block",
                          transform: isOpen ? "rotate(90deg)" : "none", flexShrink:0 }}>›</span>
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div style={{ padding:"0 20px 18px",borderTop:"1px solid #f0f0f2" }}>
                          {/* Status + tracking controls */}
                          <div style={{ display:"flex",gap:16,flexWrap:"wrap",marginTop:16,marginBottom:16 }}>
                            <div>
                              <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:4,textTransform:"uppercase" }}>Status</div>
                              <select value={order.status}
                                onChange={e => updateTrackedOrder(order.id, { status: e.target.value, ...(e.target.value === "delivered" ? { receivedAt: new Date().toISOString() } : {}) })}
                                style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit" }}>
                                <option value="submitted">Submitted</option>
                                <option value="processing">Processing</option>
                                <option value="shipped">Shipped</option>
                                <option value="delivered">Delivered</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                            </div>
                            <div>
                              <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:4,textTransform:"uppercase" }}>Carrier</div>
                              <select value={order.carrier || ""}
                                onChange={e => updateTrackedOrder(order.id, { carrier: e.target.value })}
                                style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #d2d2d7",fontSize:12,fontFamily:"inherit" }}>
                                <option value="">Select carrier</option>
                                <option value="UPS">UPS</option>
                                <option value="FedEx">FedEx</option>
                                <option value="DHL">DHL</option>
                                <option value="USPS">USPS</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <div style={{ flex:1,minWidth:200 }}>
                              <div style={{ fontSize:10,color:"#86868b",fontWeight:600,marginBottom:4,textTransform:"uppercase" }}>Tracking Numbers</div>
                              <div style={{ display:"flex",gap:6,flexWrap:"wrap",alignItems:"center" }}>
                                {(order.trackingNumbers || []).map((tn, ti) => (
                                  <div key={ti} style={{ display:"flex",alignItems:"center",gap:4,background:"rgba(0,113,227,0.06)",
                                    borderRadius:8,padding:"4px 10px" }}>
                                    <a href={getTrackingUrl(tn, order.carrier)} target="_blank" rel="noopener noreferrer"
                                      style={{ fontSize:12,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>
                                      {tn} ↗
                                    </a>
                                    <button onClick={() => {
                                      const nums = order.trackingNumbers.filter((_, i) => i !== ti);
                                      updateTrackedOrder(order.id, { trackingNumbers: nums });
                                    }}
                                      style={{ background:"none",border:"none",color:"#ff3b30",cursor:"pointer",fontSize:12,fontWeight:700,padding:0 }}>×</button>
                                  </div>
                                ))}
                                <button onClick={() => {
                                  const tn = prompt("Enter tracking number:");
                                  if (!tn?.trim()) return;
                                  updateTrackedOrder(order.id, {
                                    trackingNumbers: [...(order.trackingNumbers || []), tn.trim()],
                                    status: order.status === "submitted" ? "shipped" : order.status,
                                  });
                                }}
                                  style={{ fontSize:11,color:"#0071e3",background:"none",border:"1px solid rgba(0,113,227,0.2)",
                                    borderRadius:8,cursor:"pointer",padding:"4px 10px",fontFamily:"inherit",fontWeight:500 }}>
                                  + Add Tracking
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Notes */}
                          {order.notes && (
                            <div style={{ fontSize:12,color:"#86868b",marginBottom:12,fontStyle:"italic" }}>
                              {order.notes}
                            </div>
                          )}

                          {/* Cart link */}
                          {order.cartUrl && (
                            <div style={{ marginBottom:12 }}>
                              <a href={order.cartUrl} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize:12,color:"#e8500a",textDecoration:"none",fontWeight:500 }}>
                                View Cart on Mouser →
                              </a>
                            </div>
                          )}

                          {/* Line items */}
                          {order.items?.length > 0 && (
                            <div style={{ background:"#fafafa",borderRadius:10,overflow:"hidden",border:"1px solid #f0f0f2" }}>
                              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                                <thead>
                                  <tr style={{ background:"#f0f0f2" }}>
                                    {["MPN","Qty","Unit Price","Extended"].map((h, hi) => (
                                      <th key={hi} style={{ padding:"8px 12px",textAlign:hi>=1?"right":"left",fontSize:10,fontWeight:700,
                                        color:"#3a3f51",textTransform:"uppercase",letterSpacing:"0.04em" }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.items.map((item, li) => (
                                    <tr key={li} style={{ borderBottom:"1px solid #f0f0f2" }}>
                                      <td style={{ padding:"7px 12px",fontWeight:500 }}>{item.mpn || item.reference || "—"}</td>
                                      <td style={{ padding:"7px 12px",textAlign:"right" }}>{item.qty || "—"}</td>
                                      <td style={{ padding:"7px 12px",textAlign:"right" }}>
                                        {item.unitPrice ? `$${parseFloat(item.unitPrice).toFixed(4)}` : "—"}
                                      </td>
                                      <td style={{ padding:"7px 12px",textAlign:"right",fontWeight:600 }}>
                                        {item.unitPrice && item.qty ? `$${fmtDollar(parseFloat(item.unitPrice) * item.qty)}` : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Received date + delete */}
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14 }}>
                            <div style={{ fontSize:11,color:"#86868b" }}>
                              Created {new Date(order.createdAt).toLocaleString()}
                              {order.receivedAt && ` · Received ${new Date(order.receivedAt).toLocaleDateString()}`}
                            </div>
                            <button onClick={() => deleteTrackedOrder(order.id)}
                              style={{ fontSize:11,color:"#ff3b30",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:500 }}>
                              Delete Order
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            SUPPLIER SCORECARDS
        ══════════════════════════════════════ */}
        {activeView === "suppliers" && (() => {
          // Build supplier list from all sources
          const supplierMap = {};
          SUPPLIERS.forEach(s => { supplierMap[s.name] = { name: s.name, color: s.color, bg: s.bg, id: s.id }; });
          trackedOrders.forEach(o => {
            if (o.supplier && !supplierMap[o.supplier]) {
              supplierMap[o.supplier] = { name: o.supplier, color: o.supplierColor || "#888", bg: "rgba(136,136,136,0.06)", id: o.supplier.toLowerCase().replace(/\s+/g,"") };
            }
          });
          parts.forEach(p => {
            if (p.preferredSupplier) {
              const s = SUPPLIERS.find(x => x.id === p.preferredSupplier);
              if (s && !supplierMap[s.name]) supplierMap[s.name] = { name: s.name, color: s.color, bg: s.bg, id: s.id };
            }
          });

          const allSuppliers = Object.values(supplierMap).map(sup => {
            // Orders for this supplier
            const orders = trackedOrders.filter(o => o.supplier === sup.name || o.supplier === sup.id ||
              (SUPPLIERS.find(s => s.id === sup.id)?.name === o.supplier));
            const orderCount = orders.length;
            const totalSpend = orders.reduce((sum, o) => {
              const orderTotal = o.totalEstimate || (o.items || []).reduce((s2, it) => s2 + (it.qty || 0) * (it.unitPrice || 0), 0);
              return sum + orderTotal;
            }, 0);

            // Lead time — from createdAt to receivedAt/deliveredAt
            const deliveredOrders = orders.filter(o => (o.receivedAt || o.deliveredAt) && o.createdAt);
            const leadTimes = deliveredOrders.map(o => {
              const start = new Date(o.createdAt);
              const end = new Date(o.receivedAt || o.deliveredAt);
              return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
            }).filter(d => d >= 0 && d < 365);
            const avgLeadTime = leadTimes.length > 0 ? Math.round(leadTimes.reduce((a,b)=>a+b,0) / leadTimes.length * 10) / 10 : null;

            // On-time rate — delivered vs total
            const deliveredCount = orders.filter(o => o.status === "delivered" || o.status === "received" || o.receivedAt || o.deliveredAt).length;
            const onTimeRate = orderCount > 0 ? Math.round(deliveredCount / orderCount * 100) : null;

            // Parts supplied — where this is preferred supplier
            const partsSupplied = parts.filter(p => p.preferredSupplier === sup.id).length;

            // Price competitiveness — how often cheapest among parts they supply
            let cheapestCount = 0, comparedCount = 0;
            parts.forEach(p => {
              if (p.preferredSupplier !== sup.id || !p.pricing) return;
              const myPrice = p.pricing[sup.id]?.unitPrice;
              if (!myPrice || myPrice <= 0) return;
              comparedCount++;
              const otherPrices = Object.entries(p.pricing)
                .filter(([k, v]) => k !== sup.id && v.unitPrice > 0)
                .map(([, v]) => v.unitPrice);
              if (otherPrices.length === 0 || myPrice <= Math.min(...otherPrices)) cheapestCount++;
            });
            const priceCompetitiveness = comparedCount > 0 ? Math.round(cheapestCount / comparedCount * 100) : null;

            // Stock availability — avg stock across parts they supply
            let stockTotal = 0, stockCount = 0;
            parts.forEach(p => {
              if (p.preferredSupplier !== sup.id || !p.pricing?.[sup.id]) return;
              const s = p.pricing[sup.id].stock;
              if (s != null && s >= 0) { stockTotal += s; stockCount++; }
            });
            const avgStock = stockCount > 0 ? Math.round(stockTotal / stockCount) : null;

            return { ...sup, orderCount, totalSpend, avgLeadTime, onTimeRate, partsSupplied, priceCompetitiveness, avgStock, deliveredCount };
          }).filter(s => s.orderCount > 0 || s.partsSupplied > 0);

          // Sort
          const sorted = [...allSuppliers].sort((a, b) => {
            if (supplierSort === "spend") return b.totalSpend - a.totalSpend;
            if (supplierSort === "leadtime") return (a.avgLeadTime ?? 999) - (b.avgLeadTime ?? 999);
            if (supplierSort === "orders") return b.orderCount - a.orderCount;
            return 0;
          });

          // Summary
          const totalOrders = trackedOrders.length;
          const allLeadTimes = allSuppliers.filter(s => s.avgLeadTime != null).map(s => s.avgLeadTime);
          const overallAvgLead = allLeadTimes.length > 0 ? Math.round(allLeadTimes.reduce((a,b)=>a+b,0) / allLeadTimes.length * 10) / 10 : null;
          const bestSupplier = allSuppliers.filter(s => s.orderCount >= 3 && s.avgLeadTime != null).sort((a,b) => a.avgLeadTime - b.avgLeadTime)[0];

          const cardBg = darkMode ? "#2c2c2e" : "#fff";
          const textPrimary = darkMode ? "#f5f5f7" : "#1d1d1f";
          const textSecondary = darkMode ? "#98989d" : "#86868b";
          const borderColor = darkMode ? "#3a3a3e" : "#e5e5ea";
          const ratingColor = (val, goodBelow, badAbove) => {
            if (val == null) return textSecondary;
            if (typeof goodBelow === "number") return val <= goodBelow ? "#34c759" : val >= badAbove ? "#ff3b30" : "#ff9500";
            return val >= goodBelow ? "#34c759" : val <= badAbove ? "#ff3b30" : "#ff9500";
          };
          const pctColor = (val) => val == null ? textSecondary : val >= 80 ? "#34c759" : val >= 50 ? "#ff9500" : "#ff3b30";

          return (
            <div style={{ maxWidth:1100 }}>
              <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:textPrimary,marginBottom:4 }}>Supplier Scorecards</h2>
              <p style={{ fontSize:14,color:textSecondary,marginBottom:24 }}>Performance metrics and analytics for all suppliers.</p>

              {/* Summary stats */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:16,marginBottom:28 }}>
                {[
                  { label:"Total Suppliers", value:allSuppliers.length, color:"#5856d6" },
                  { label:"Total Orders", value:totalOrders, color:"#0071e3" },
                  { label:"Avg Lead Time", value:overallAvgLead != null ? `${overallAvgLead} days` : "—", color:"#ff9500" },
                  { label:"Best Supplier", value:bestSupplier ? bestSupplier.name.replace(/ Electronics/,"") : "—", sub:bestSupplier ? `${bestSupplier.avgLeadTime}d avg, ${bestSupplier.orderCount} orders` : "Need 3+ orders", color:"#34c759" },
                ].map(card => (
                  <div key={card.label} style={{ background:cardBg,borderRadius:14,padding:"18px 20px",boxShadow:darkMode?"none":"0 1px 4px rgba(0,0,0,0.06)",border:`1px solid ${borderColor}` }}>
                    <div style={{ fontSize:11,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6 }}>{card.label}</div>
                    <div style={{ fontSize:26,fontWeight:700,color:card.color,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif" }}>{card.value}</div>
                    {card.sub && <div style={{ fontSize:11,color:textSecondary,marginTop:2 }}>{card.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Sort controls */}
              <div style={{ display:"flex",gap:8,marginBottom:20,alignItems:"center" }}>
                <span style={{ fontSize:12,fontWeight:600,color:textSecondary }}>Sort by:</span>
                {[{k:"spend",l:"Total Spend"},{k:"leadtime",l:"Lead Time"},{k:"orders",l:"Order Count"}].map(opt => (
                  <button key={opt.k} onClick={() => setSupplierSort(opt.k)}
                    style={{ padding:"6px 14px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
                      border:`1px solid ${borderColor}`,
                      background:supplierSort===opt.k ? (darkMode?"#3a3a3e":"#1d1d1f") : "transparent",
                      color:supplierSort===opt.k ? "#fff" : textSecondary }}>
                    {opt.l}
                  </button>
                ))}
              </div>

              {/* Supplier cards grid */}
              {sorted.length === 0 ? (
                <div style={{ textAlign:"center",padding:60,color:textSecondary }}>
                  <div style={{ fontSize:48,marginBottom:16 }}>📊</div>
                  <div style={{ fontSize:16,fontWeight:600,marginBottom:8 }}>No supplier data yet</div>
                  <div style={{ fontSize:13 }}>Place orders and set preferred suppliers to see scorecards here.</div>
                </div>
              ) : (
                <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(320px, 1fr))",gap:20 }}>
                  {sorted.map(sup => (
                    <div key={sup.name} style={{ background:cardBg,borderRadius:14,padding:"22px 24px",boxShadow:darkMode?"none":"0 2px 8px rgba(0,0,0,0.06)",border:`1px solid ${borderColor}`,position:"relative",overflow:"hidden" }}>
                      {/* Color accent bar */}
                      <div style={{ position:"absolute",top:0,left:0,right:0,height:4,background:sup.color }} />

                      {/* Supplier name */}
                      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16,marginTop:4 }}>
                        <div style={{ width:36,height:36,borderRadius:10,background:sup.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,fontFamily:"inherit" }}>
                          {(SUPPLIERS.find(s=>s.id===sup.id)?.logo) || sup.name.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize:16,fontWeight:700,color:textPrimary }}>{sup.name}</div>
                          <div style={{ fontSize:11,color:textSecondary }}>{sup.orderCount} order{sup.orderCount!==1?"s":""} · {sup.partsSupplied} part{sup.partsSupplied!==1?"s":""}</div>
                        </div>
                      </div>

                      {/* Metrics grid */}
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px 16px" }}>
                        {/* Total Spend */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Total Spend</div>
                          <div style={{ fontSize:18,fontWeight:700,color:textPrimary }}>${sup.totalSpend >= 1000 ? (sup.totalSpend/1000).toFixed(1)+"k" : sup.totalSpend.toFixed(2)}</div>
                        </div>

                        {/* Order Count */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Orders</div>
                          <div style={{ fontSize:18,fontWeight:700,color:textPrimary }}>{sup.orderCount}</div>
                        </div>

                        {/* Avg Lead Time */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Avg Lead Time</div>
                          <div style={{ fontSize:18,fontWeight:700,color:sup.avgLeadTime != null ? ratingColor(sup.avgLeadTime, 5, 14) : textSecondary }}>
                            {sup.avgLeadTime != null ? `${sup.avgLeadTime}d` : "—"}
                          </div>
                        </div>

                        {/* On-Time Rate */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Delivery Rate</div>
                          <div style={{ fontSize:18,fontWeight:700,color:pctColor(sup.onTimeRate) }}>
                            {sup.onTimeRate != null ? `${sup.onTimeRate}%` : "—"}
                          </div>
                        </div>

                        {/* Price Competitiveness */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Best Price Rate</div>
                          <div style={{ fontSize:18,fontWeight:700,color:pctColor(sup.priceCompetitiveness) }}>
                            {sup.priceCompetitiveness != null ? `${sup.priceCompetitiveness}%` : "—"}
                          </div>
                        </div>

                        {/* Stock Availability */}
                        <div>
                          <div style={{ fontSize:10,fontWeight:600,color:textSecondary,textTransform:"uppercase",letterSpacing:"0.4px",marginBottom:3 }}>Avg Stock</div>
                          <div style={{ fontSize:18,fontWeight:700,color:sup.avgStock != null ? (sup.avgStock > 100 ? "#34c759" : sup.avgStock > 10 ? "#ff9500" : "#ff3b30") : textSecondary }}>
                            {sup.avgStock != null ? sup.avgStock.toLocaleString() : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ══════════════════════════════════════
            SCOREBOARD
        ══════════════════════════════════════ */}
        {activeView === "scoreboard" && (
          <div style={{ margin:"-24px -28px", minHeight:"calc(100vh - 120px)" }}>
            <div style={{ padding:"12px 28px",display:"flex",justifyContent:"flex-end" }}>
              <button onClick={() => window.open(window.location.origin + window.location.pathname + "#scoreboard", "_blank", "noopener")}
                style={{ padding:"8px 18px",borderRadius:980,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#f8d377",color:"#0a0a0f" }}>
                Full Screen ↗
              </button>
            </div>
            <Scoreboard teamMembers={teamMembers} buildOrders={buildOrders} buildAssignments={buildAssignments} products={products} />
          </div>
        )}

        {/* ══════════════════════════════════════
            PRODUCTS
        ══════════════════════════════════════ */}
        {activeView === "projects" && !selectedProduct && (
          <div style={{ background:darkMode?"#1c1c1e":"#f5f5f7",borderRadius:16,padding:"28px 24px",margin:"-8px -4px",minHeight:"60vh" }}>
            {/* Header */}
            <div style={{ marginBottom:28 }}>
              <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:4 }}>Products</h2>
              <p style={{ fontSize:14,color:"#86868b" }}>Click any product to view its BOM, add parts, and run simulations.</p>
              <div style={{ display:"flex",gap:10,marginTop:14,flexWrap:"wrap",alignItems:"center" }}>
                <input type="text" placeholder="New product name…" value={newProjName}
                  onChange={(e)=>setNewProjName(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&addProduct()}
                  style={{ padding:"8px 14px",borderRadius:980,fontSize:13,border:"1px solid #d2d2d7",fontFamily:"inherit",outline:"none",width:220,background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                <select value={newProjBrand} onChange={e=>{
                    let val=e.target.value;
                    if(val==="__new__"){val=window.prompt("New brand name:");if(!val){setNewProjBrand("Jackson Audio");return;}}
                    setNewProjBrand(val);
                  }}
                  style={{ padding:"7px 10px",borderRadius:980,fontSize:12,border:"1px solid #d2d2d7" }}>
                  {[...new Set(["Jackson Audio","Fulltone USA",...products.map(p=>p.brand).filter(Boolean)])].sort().map(b=>
                    <option key={b} value={b}>{b}</option>
                  )}
                  <option value="__new__">+ New Brand...</option>
                </select>
                <button onClick={addProduct}
                  style={{ padding:"8px 18px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#0071e3",color:"#fff" }}>
                  + New Product
                </button>
                <span style={{ marginLeft:"auto",fontSize:12,color:"#86868b" }}>Filter:</span>
                <select value={selBrand||"all"} onChange={e=>setSelBrand(e.target.value)}
                  style={{ padding:"5px 10px",borderRadius:980,fontSize:12,border:"1px solid #d2d2d7" }}>
                  <option value="all">All Brands</option>
                  {[...new Set(products.map(p=>p.brand||"Jackson Audio"))].sort().map(b=>
                    <option key={b} value={b}>{b}</option>
                  )}
                </select>
              </div>
            </div>

            {products.length === 0 && (
              <div style={{ textAlign:"center",padding:60,color:"#86868b" }}>
                <div style={{ fontSize:14,fontFamily:"-apple-system,sans-serif" }}>No products yet — create one above</div>
              </div>
            )}

            {/* Product list rows grouped by brand */}
            {(() => {
              const filtered = productCosts.filter(p => selBrand === "all" || (p.brand || "Jackson Audio") === selBrand);
              // Sort: Jackson Audio first, then Fulltone USA, alphabetical within each
              const brandOrder = { "Jackson Audio": 0, "Fulltone USA": 1 };
              const sorted = [...filtered].sort((a, b) => {
                const ba = a.brand || "Jackson Audio", bb = b.brand || "Jackson Audio";
                const oa = brandOrder[ba] ?? 99, ob = brandOrder[bb] ?? 99;
                if (oa !== ob) return oa - ob;
                return a.name.localeCompare(b.name);
              });
              // Group by brand
              const groups = {};
              sorted.forEach(p => { const b = p.brand || "Jackson Audio"; (groups[b] = groups[b] || []).push(p); });
              const brandKeys = Object.keys(groups);
              return (
                <div style={{ background:darkMode?"#2c2c2e":"#fff",borderRadius:12,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                  {/* Column headers */}
                  <div style={{ display:"grid",gridTemplateColumns:"24px 1fr 90px 80px 100px 70px 80px 36px",gap:8,padding:"10px 22px",
                    fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",
                    borderBottom:"2px solid "+(darkMode?"#3a3a3e":"#e5e5ea"),background:darkMode?"#1c1c1e":"#fafafa" }}>
                    <div></div><div>Product</div><div>Brand</div><div style={{textAlign:"right"}}>Parts</div>
                    <div style={{textAlign:"right"}}>BOM Cost</div><div style={{textAlign:"right"}}>Build</div><div>Queue</div><div></div>
                  </div>
                  {brandKeys.map(brand => (
                    <div key={brand}>
                      {brandKeys.length > 1 && (
                        <div style={{ padding:"8px 22px",fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",
                          color:darkMode?"#aeaeb2":"#86868b",background:darkMode?"#1c1c1e":"#f0f0f2",borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#e5e5ea"),
                          cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center" }}
                          onClick={()=>setCollapsedBrands(prev=>{const s=new Set(prev);s.has(brand)?s.delete(brand):s.add(brand);return s;})}>
                          <span>{brand} ({groups[brand].length})</span>
                          <span style={{ fontSize:11,transform:collapsedBrands.has(brand)?"rotate(0deg)":"rotate(180deg)",transition:"transform 0.2s" }}>▼</span>
                        </div>
                      )}
                      {!collapsedBrands.has(brand) &&
                      groups[brand].map(prod => (
                        <div key={prod.id}
                          onClick={() => { setSelectedProduct(prod.id); setPdImportError(""); setPdImportOk(""); setPdPasteText(""); }}
                          style={{ display:"grid",gridTemplateColumns:"24px 1fr 90px 80px 100px 70px 80px 36px",gap:8,alignItems:"center",
                            padding:"12px 22px",cursor:"pointer",
                            borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#ededf0"),transition:"background 0.12s" }}
                          onMouseOver={e=>e.currentTarget.style.background=darkMode?"#3a3a3e":"#f5f5f7"}
                          onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                          <span style={{ display:"inline-block",width:10,height:10,borderRadius:"50%",background:prod.color }} />
                          <div style={{ fontSize:15,fontWeight:600,color:darkMode?"#f5f5f7":"#1d1d1f",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                            {prod.name}
                          </div>
                          <div onClick={e=>e.stopPropagation()}>
                            <select value={prod.brand||"Jackson Audio"}
                              onChange={async(e)=>{
                                let val=e.target.value;
                                if(val==="__new__"){val=window.prompt("New brand name:");if(!val)return;}
                                setProducts(prev=>prev.map(p=>p.id===prod.id?{...p,brand:val}:p));
                                await supabase.from("products").update({brand:val}).eq("id",prod.id);
                              }}
                              style={{ fontSize:11,padding:"2px 4px",borderRadius:4,border:"1px solid #d2d2d7",color:"#1d1d1f",background:"transparent",cursor:"pointer" }}>
                              {[...new Set(["Jackson Audio","Fulltone USA",...products.map(p=>p.brand).filter(Boolean)])].sort().map(b=>
                                <option key={b} value={b}>{b}</option>
                              )}
                              <option value="__new__">+ New Brand...</option>
                            </select>
                          </div>
                          <div style={{ fontSize:12,color:"#86868b",textAlign:"right" }}>{prod.partCount}</div>
                          <div style={{ fontSize:14,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",textAlign:"right" }}>${fmtDollar(prod.total)}</div>
                          <div style={{ fontSize:11,color:"#86868b",textAlign:"right" }}>{prod.buildMinutes ? (prod.buildMinutes < 60 ? `${prod.buildMinutes}m` : `${Math.floor(prod.buildMinutes/60)}h${prod.buildMinutes%60?` ${prod.buildMinutes%60}m`:""}`) : "—"}</div>
                          <div>{buildQueue.find(q=>q.productId===prod.id)
                            ? <span style={{ fontSize:11,color:"#34c759",fontWeight:600 }}>{buildQueue.find(q=>q.productId===prod.id).qty}</span>
                            : <span style={{ fontSize:11,color:"#aeaeb2" }}>—</span>}</div>
                          <button title="Duplicate product"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const name = window.prompt("Name for the new product:", prod.name + " (copy)");
                              if (!name) return;
                              try {
                                const created = await createProduct({ name, color: prod.color, userId: user.id, brand: prod.brand || "Jackson Audio" });
                                // Copy parts
                                const srcParts = parts.filter(p => p.projectId === prod.id);
                                if (srcParts.length > 0) {
                                  const dbRows = srcParts.map(p => {
                                    const row = uiPartToDB(p);
                                    row.product_id = created.id;
                                    delete row.pricing;
                                    delete row.pricing_status;
                                    delete row.pricing_error;
                                    delete row.best_supplier;
                                    return row;
                                  });
                                  await upsertParts(dbRows, user.id);
                                }
                              } catch (err) { console.error("Duplicate product failed:", err); alert("Duplicate failed: " + err.message); }
                            }}
                            style={{ background:"none",border:"none",cursor:"pointer",color:"#c7c7cc",fontSize:15,padding:"2px 6px",borderRadius:4,transition:"color 0.15s",flexShrink:0 }}
                            onMouseOver={e=>{e.stopPropagation();e.currentTarget.style.color="#0071e3";}}
                            onMouseOut={e=>{e.stopPropagation();e.currentTarget.style.color="#c7c7cc";}}>
                            ⧉
                          </button>
                        </div>
                      ))
                      }
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════════════════════════════
            PRODUCT DETAIL PAGE
        ══════════════════════════════════════ */}
        {activeView === "projects" && selectedProduct && (() => {
          const prod = productCosts.find(p => p.id === selectedProduct);
          if (!prod) { setSelectedProduct(null); return null; }
          const prodParts = parts.filter(p => p.projectId === prod.id);
          const qa = quickAdd[prod.id] || {};
          const showOpt = qa.showOptional || false;
          const prodSelectedParts = [...selectedParts].filter(id => prodParts.some(p => p.id === id));
          const allProdSelected = prodParts.length > 0 && prodParts.every(p => selectedParts.has(p.id));

          return (
          <div style={{ background:darkMode?"#1c1c1e":"#f5f5f7",borderRadius:16,padding:"28px 24px",margin:"-8px -4px",minHeight:"60vh" }}>

            {/* Back button */}
            <button onClick={() => { setSelectedProduct(null); selectNone(); }}
              style={{ display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",
                fontSize:13,fontWeight:600,color:"#0071e3",fontFamily:"inherit",padding:"4px 0",marginBottom:20 }}>
              ← Back to Products
            </button>

            {/* Header */}
            <div style={{ display:"flex",alignItems:"flex-start",gap:16,marginBottom:28,flexWrap:"wrap" }}>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                  <span style={{ display:"inline-block",width:12,height:12,borderRadius:"50%",background:prod.color }} />
                  <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:darkMode?"#f5f5f7":"#1d1d1f",margin:0 }}>
                    {prod.name}
                  </h2>
                  {prod.brand && prod.brand !== "Jackson Audio" && (
                    <span style={{ fontSize:11,fontWeight:700,color:"#fff",background:"#5856d6",padding:"3px 10px",borderRadius:980 }}>{prod.brand}</span>
                  )}
                  <button title="Duplicate product"
                    onClick={async () => {
                      const name = window.prompt("Name for the new product:", prod.name + " (copy)");
                      if (!name) return;
                      try {
                        const created = await createProduct({ name, color: prod.color, userId: user.id, brand: prod.brand || "Jackson Audio" });
                        const srcParts = parts.filter(p => p.projectId === prod.id);
                        if (srcParts.length > 0) {
                          const dbRows = srcParts.map(p => { const row = uiPartToDB(p); row.product_id = created.id; delete row.pricing; delete row.best_supplier; return row; });
                          await upsertParts(dbRows, user.id);
                        }
                        setSelectedProduct(created.id);
                      } catch (e) { alert("Duplicate failed: " + e.message); }
                    }}
                    style={{ background:"none",border:"1px solid #d2d2d7",borderRadius:6,cursor:"pointer",padding:"4px 10px",
                      fontSize:12,color:"#86868b",fontFamily:"inherit",display:"flex",alignItems:"center",gap:4 }}
                    onMouseOver={e=>e.currentTarget.style.borderColor="#0071e3"}
                    onMouseOut={e=>e.currentTarget.style.borderColor="#d2d2d7"}>
                    Duplicate
                  </button>
                </div>
                <div style={{ display:"flex",gap:20,fontSize:13,color:"#86868b",flexWrap:"wrap",alignItems:"center" }}>
                  <span><strong style={{ color:darkMode?"#f5f5f7":"#1d1d1f" }}>{"$"}{fmtDollar(prod.total)}</strong> BOM cost/unit</span>
                  <span>{prod.partCount} part{prod.partCount!==1?"s":""}</span>
                  {prod.buildMinutes && (
                    <span>{prod.buildMinutes < 60 ? `${prod.buildMinutes}m` : `${Math.floor(prod.buildMinutes/60)}h ${prod.buildMinutes%60}m`} build time</span>
                  )}
                </div>
              </div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <span style={{ fontSize:10,color:"#86868b" }}>Brand:</span>
                  <select style={{ fontSize:11,padding:"4px 8px",borderRadius:5,border:"1px solid #e5e5ea",color:darkMode?"#f5f5f7":"#1d1d1f",background:darkMode?"#2c2c2e":"#fff",minWidth:120 }}
                    value={prod.brand || "Jackson Audio"}
                    onChange={async (e) => {
                      const val = e.target.value;
                      setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, brand: val } : p));
                      try { await supabase.from("products").update({ brand: val }).eq("id", prod.id); } catch (err) { console.error("Brand save failed:", err); }
                    }}>
                    <option value="Jackson Audio">Jackson Audio</option>
                    <option value="Fulltone USA">Fulltone USA</option>
                  </select>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                  <span style={{ fontSize:10,color:"#86868b" }}>Build Time:</span>
                  <input type="number" min="1" placeholder="min"
                    value={prod.buildMinutes || ""}
                    onChange={async (e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, buildMinutes: val } : p));
                      try { await supabase.from("products").update({ build_minutes: val }).eq("id", prod.id); } catch (err) { console.error("Build time save failed:", err); }
                    }}
                    style={{ width:52,padding:"4px 6px",borderRadius:5,fontSize:11,fontWeight:600,textAlign:"center",border:"1px solid #d2d2d7",fontFamily:"inherit",outline:"none",background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                  <span style={{ fontSize:10,color:"#86868b" }}>
                    {prod.buildMinutes ? (prod.buildMinutes < 60 ? `${prod.buildMinutes}m` : `${Math.floor(prod.buildMinutes/60)}h ${prod.buildMinutes%60}m`) : "min"}
                  </span>
                </div>
                {shopifyProducts.length > 0 && (
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:10,color:"#86868b" }}>Shopify:</span>
                    <select style={{ fontSize:11,padding:"4px 8px",borderRadius:5,border:"1px solid #e5e5ea",color:darkMode?"#f5f5f7":"#1d1d1f",background:darkMode?"#2c2c2e":"#fff",minWidth:120 }}
                      value={prod.shopifyProductId || ""}
                      onChange={async (e) => {
                        const val = e.target.value || null;
                        setProducts(prev => prev.map(p => p.id === prod.id ? { ...p, shopifyProductId: val } : p));
                        try { await supabase.from("products").update({ shopify_product_id: val }).eq("id", prod.id); } catch (err) { console.error("Shopify mapping save failed:", err); }
                      }}>
                      <option value="">-- Not linked --</option>
                      {shopifyProducts.map(sp => (
                        <option key={sp.id} value={sp.id}>{sp.storeName ? `[${sp.storeName}] ` : ""}{sp.title}</option>
                      ))}
                    </select>
                    {prod.shopifyProductId && <span style={{ fontSize:10,color:"#34c759" }}>Linked</span>}
                  </div>
                )}
                <button style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}
                  disabled={!prodParts.some(p => p.mpn) || prodParts.some(p => p.pricingStatus === "loading")}
                  onClick={async () => {
                    const toFetch = prodParts.filter(p => p.mpn);
                    for (const p of toFetch) { await fetchPartPricing(p.id); await new Promise(r => setTimeout(r, 300)); }
                  }}>
                  {prodParts.some(p => p.pricingStatus === "loading") ? "Refreshing..." : `Refresh Prices (${prodParts.filter(p=>p.mpn).length})`}
                </button>
                <button style={{ padding:"5px 14px",borderRadius:980,fontSize:11,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"1px solid #d2d2d7",background:"transparent",color:"#86868b" }}
                  onClick={async () => {
                    const prodPartsSnap = prodParts.map(p => ({ id:p.id, mpn:p.mpn, reference:p.reference, value:p.value, description:p.description,
                      quantity:p.quantity, stockQty:p.stockQty, unitCost:p.unitCost, projectId:p.projectId, manufacturer:p.manufacturer }));
                    const bomCostPerUnit = prodParts.reduce((s, p) => s + priceAtQty(p) * (parseInt(p.quantity)||1), 0);
                    const snapshot = {
                      date: new Date().toISOString(),
                      product_id: prod.id,
                      products: [{ id: prod.id, name: prod.name }],
                      parts: prodPartsSnap,
                      bomCost: bomCostPerUnit,
                    };
                    const label = `${prod.name} — ${prodPartsSnap.length} parts, $${fmtDollar(bomCostPerUnit)}/unit`;
                    try {
                      const saved = await saveBomSnapshot(label, snapshot, user.id);
                      setBomSnapshots(prev => [saved, ...prev].slice(0, 50));
                      alert(`Product snapshot saved: ${prod.name} (${prodPartsSnap.length} parts, $${fmtDollar(bomCostPerUnit)}/unit)`);
                    } catch (err) {
                      alert("Snapshot save failed: " + err.message);
                    }
                  }}>
                  Save Snapshot
                </button>
              </div>
            </div>

            {/* ── Import / Add Parts Section */}
            <div style={{ background:darkMode?"#2c2c2e":"#fff",borderRadius:14,padding:"20px 22px",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize:12,color:"#86868b",letterSpacing:"0.5px",fontWeight:600,marginBottom:14,textTransform:"uppercase" }}>
                Add Parts to {prod.name}
              </div>

              {/* Quick-add form */}
              {qa._error && (
                <div style={{ background:"#fff2f2",border:"1px solid #ffccc7",borderRadius:8,padding:"8px 12px",
                  marginBottom:10,fontSize:12,color:"#ff3b30" }}>{qa._error}</div>
              )}
              <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:16 }}>
                <div style={{ flex:"1 1 200px",position:"relative" }}>
                  <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Part Number <span style={{ color:"#ff3b30" }}>*</span></div>
                  <input type="text" placeholder="e.g. LOP-300-24"
                    value={qa.pn || ""}
                    onChange={(e) => setQAField(prod.id, "pn", e.target.value)}
                    onKeyDown={(e) => { if(e.key==="Enter") quickAddPart(prod.id); }}
                    onFocus={() => setQAField(prod.id, "_focused", true)}
                    onBlur={() => setTimeout(() => setQAField(prod.id, "_focused", false), 200)}
                    style={{ padding:"8px 12px",borderRadius:6,width:"100%",fontSize:13,fontWeight:600,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                  {/* Autocomplete dropdown */}
                  {qa._focused && qa.pn && qa.pn.trim().length >= 2 && (() => {
                    const q = qa.pn.trim().toLowerCase();
                    const matches = parts
                      .filter(p => p.projectId !== prod.id && (
                        (p.mpn && p.mpn.toLowerCase().includes(q)) ||
                        (p.value && p.value.toLowerCase().includes(q)) ||
                        (p.description && p.description.toLowerCase().includes(q))
                      ))
                      .slice(0, 8);
                    if (matches.length === 0) return null;
                    return (
                      <div style={{ position:"absolute",top:"100%",left:0,right:0,zIndex:100,
                        background:darkMode?"#2c2c2e":"#fff",borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",
                        border:"1px solid "+(darkMode?"#48484a":"#e5e5ea"),marginTop:4,maxHeight:240,overflowY:"auto" }}>
                        <div style={{ padding:"6px 12px",fontSize:9,color:"#aeaeb2",letterSpacing:"0.1em",fontWeight:700,borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#f0f0f2") }}>
                          EXISTING PARTS
                        </div>
                        {matches.map(m => (
                          <div key={m.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              updatePart(m.id, "projectId", prod.id);
                              setQAField(prod.id, "pn", "");
                              setQAField(prod.id, "_focused", false);
                            }}
                            style={{ padding:"8px 12px",cursor:"pointer",borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#f5f5f7"),transition:"background 0.1s" }}
                            onMouseOver={e=>e.currentTarget.style.background=darkMode?"#3a3a3e":"#f5f5f7"}
                            onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                            <div style={{ fontSize:13,fontWeight:600,color:darkMode?"#f5f5f7":"#1d1d1f" }}>{m.mpn || m.reference}</div>
                            <div style={{ fontSize:11,color:"#86868b",marginTop:1 }}>
                              {[m.value, m.description, m.manufacturer].filter(Boolean).join(" · ") || "No details"}
                              {m.projectId && (() => {
                                const p = products.find(x => x.id === m.projectId);
                                return p ? <span style={{ color:"#aeaeb2" }}> -- {p.name}</span> : null;
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <div style={{ flex:"0 0 80px" }}>
                  <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Qty <span style={{ color:"#ff3b30" }}>*</span></div>
                  <input type="number" placeholder="1" min="1"
                    value={qa.qty || ""}
                    onChange={(e) => setQAField(prod.id, "qty", e.target.value)}
                    onKeyDown={(e) => { if(e.key==="Enter") quickAddPart(prod.id); }}
                    style={{ padding:"8px 10px",borderRadius:6,width:"100%",fontSize:13,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                </div>
                <div style={{ flex:"0 0 auto",alignSelf:"flex-end" }}>
                  <button disabled={!qa.pn?.trim()} onClick={() => quickAddPart(prod.id)}
                    style={{ padding:"8px 18px",borderRadius:980,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#0071e3",color:"#fff",opacity:qa.pn?.trim()?"1":"0.4" }}>
                    + Add Part
                  </button>
                </div>
                <div style={{ flex:"0 0 auto",alignSelf:"flex-end" }}>
                  <button className="btn-ghost" style={{ fontSize:11 }}
                    onClick={() => setQAField(prod.id, "showOptional", !showOpt)}>
                    {showOpt ? "Less" : "More fields"}
                  </button>
                </div>
              </div>
              {showOpt && (
                <div style={{ display:"flex",gap:8,flexWrap:"wrap",marginBottom:14 }}>
                  <div style={{ flex:"1 1 160px" }}>
                    <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Description</div>
                    <input type="text" placeholder="e.g. 24V Power Supply" value={qa.desc || ""}
                      onChange={(e) => setQAField(prod.id, "desc", e.target.value)}
                      style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                  </div>
                  <div style={{ flex:"1 1 100px" }}>
                    <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Value</div>
                    <input type="text" placeholder="e.g. 10k" value={qa.value || ""}
                      onChange={(e) => setQAField(prod.id, "value", e.target.value)}
                      style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                  </div>
                  <div style={{ flex:"1 1 140px" }}>
                    <div style={{ fontSize:10,color:"#86868b",marginBottom:3 }}>Manufacturer</div>
                    <input type="text" placeholder="e.g. Mean Well" value={qa.mfr || ""}
                      onChange={(e) => setQAField(prod.id, "mfr", e.target.value)}
                      style={{ padding:"7px 10px",borderRadius:6,width:"100%",fontSize:12,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,paddingTop:14 }}>
                    <input type="checkbox" checked={qa.isInternal || false}
                      onChange={(e) => setQAField(prod.id, "isInternal", e.target.checked)}
                      style={{ width:14,height:14,accentColor:"#5856d6",cursor:"pointer" }} />
                    <span style={{ fontSize:11,color:"#5856d6",fontWeight:600 }}>In-House</span>
                  </div>
                </div>
              )}

              {/* Import drop zone */}
              <div style={{ borderTop:"1px solid "+(darkMode?"#3a3a3e":"#f0f0f2"),paddingTop:14,marginTop:4 }}>
                <div style={{ fontSize:10,color:"#86868b",letterSpacing:"0.5px",fontWeight:600,marginBottom:8,textTransform:"uppercase" }}>
                  Import BOM into {prod.name}
                </div>
                <div className={`drop-zone ${pdDragOver?"drag-over":""}`}
                  onDragOver={(e)=>{e.preventDefault();setPdDragOver(true);}}
                  onDragLeave={()=>setPdDragOver(false)}
                  onDrop={(e)=>handleProductDrop(e, prod.id)}
                  onClick={()=>pdFileRef.current?.click()}
                  style={{ padding:"18px 16px",marginBottom:8,cursor:"pointer" }}>
                  <div style={{ fontWeight:700,fontSize:13,marginBottom:4 }}>Drop BOM file here</div>
                  <div style={{ color:"#aeaeb2",fontSize:11 }}>CSV / TSV / TXT -- or click to browse</div>
                  <input ref={pdFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display:"none" }}
                    onChange={(e)=>handleProductFilePick(e, prod.id)} />
                </div>
                <textarea placeholder="Or paste BOM text here..." value={pdPasteText} onChange={(e)=>setPdPasteText(e.target.value)}
                  style={{ width:"100%",minHeight:50,padding:"8px 12px",borderRadius:8,border:"1px solid "+(darkMode?"#48484a":"#d2d2d7"),fontSize:12,resize:"vertical",fontFamily:"inherit",boxSizing:"border-box",marginBottom:6,background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                {pdPasteText.trim() && (
                  <div style={{ display:"flex",gap:8 }}>
                    <button className="btn-primary" style={{ fontSize:12 }} onClick={()=>handleProductImport(pdPasteText, prod.id)}>Parse & Import into {prod.name}</button>
                    <button className="btn-ghost" style={{ fontSize:12 }} onClick={()=>setPdPasteText("")}>Clear</button>
                  </div>
                )}
                {pdImportError && <div style={{ marginTop:6,color:"#ff3b30",fontSize:12 }}>{pdImportError}</div>}
                {pdImportOk && <div style={{ marginTop:6,color:"#34c759",fontSize:12 }}>{pdImportOk}</div>}
              </div>
            </div>

            {/* ── Bulk action bar */}
            {prodSelectedParts.length > 0 && (
              <div style={{ display:"flex",alignItems:"center",gap:10,padding:"6px 12px",
                background:"rgba(0,113,227,0.06)",border:"1px solid rgba(0,113,227,0.3)",borderRadius:6,marginBottom:10 }}>
                <span style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#0071e3" }}>
                  {prodSelectedParts.length} part{prodSelectedParts.length!==1?"s":""} selected
                </span>
                <button onClick={deleteSelected}
                  style={{ background:"#ff3b30",color:"#fff",border:"none",borderRadius:6,
                    padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:7 }}>
                  Delete Selected
                </button>
                <button onClick={() => { const sel = parts.filter(p => selectedParts.has(p.id) && p.projectId === prod.id); setQrModalParts(sel); }}
                  style={{ background:"#5856d6",color:"#fff",border:"none",borderRadius:6,
                    padding:"7px 16px",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:7 }}>
                  Print QR Labels
                </button>
                <button className="btn-ghost btn-sm" onClick={selectNone}>Cancel</button>
                <div style={{ marginLeft:8,borderLeft:"1px solid rgba(0,113,227,0.3)",paddingLeft:10,display:"flex",alignItems:"center",gap:6 }}>
                  <select id="pdBulkField" style={{ padding:"5px 8px",borderRadius:5,fontSize:12,border:"1px solid #d2d2d7" }}>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="value">Value</option>
                    <option value="description">Description</option>
                    <option value="reorderQty">Reorder Point</option>
                    <option value="reelQty">Reel Qty</option>
                    <option value="stockQty">Stock</option>
                    <option value="preferredSupplier">Supplier</option>
                  </select>
                  <input id="pdBulkValue" type="text" placeholder="Set value..."
                    style={{ padding:"5px 8px",borderRadius:5,fontSize:12,border:"1px solid #d2d2d7",width:140 }} />
                  <button onClick={async () => {
                    const field = document.getElementById("pdBulkField").value;
                    const val = document.getElementById("pdBulkValue").value;
                    if (!val && field !== "stockQty") return;
                    for (const id of prodSelectedParts) { await updatePart(id, field, val); }
                    document.getElementById("pdBulkValue").value = "";
                  }}
                    style={{ background:"#0071e3",color:"#fff",border:"none",borderRadius:6,
                      padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" }}>
                    Apply to {prodSelectedParts.length}
                  </button>
                </div>
              </div>
            )}

            {/* ── Parts Table */}
            {prodParts.length > 0 ? (
              <div style={{ background:darkMode?"#2c2c2e":"#fff",borderRadius:14,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:20 }}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                    <thead>
                      <tr style={{ background:darkMode?"#3a3a3e":"#b8bdd1",color:darkMode?"#e5e5ea":"#3a3f51" }}>
                        <th style={{ padding:"12px 10px",width:28,borderRadius:"8px 0 0 0" }}>
                          <input type="checkbox" style={{ width:15,height:15,cursor:"pointer",accentColor:"#0071e3" }}
                            checked={allProdSelected}
                            ref={(el) => { if (el) el.indeterminate = prodSelectedParts.length > 0 && !allProdSelected; }}
                            onChange={(e) => {
                              if (e.target.checked) selectAll(prodParts.map(p => p.id));
                              else selectNone();
                            }} />
                        </th>
                        {["MPN","Value","Description","Manufacturer","Qty/Build","Stock","Reorder Pt","Stock Value","Actions"].map((h,hi,arr)=>(
                          <th key={hi} style={{ padding:"12px 10px",textAlign:hi>=4?"right":"left",
                            fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                            fontSize:10,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",
                            borderRadius:hi===arr.length-1?"0 8px 0 0":undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {prodParts.map((part) => {
                        const stockVal = (parseInt(part.stockQty)||0) * priceAtQty(part);
                        return (
                          <tr key={part.id} style={{ borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#ededf0"),
                            background:selectedParts.has(part.id)?(darkMode?"rgba(0,113,227,0.15)":"rgba(0,113,227,0.04)"):"transparent" }}>
                            <td style={{ padding:"10px 10px" }}>
                              <input type="checkbox" checked={selectedParts.has(part.id)} onChange={()=>toggleSelect(part.id)}
                                style={{ width:15,height:15,cursor:"pointer",accentColor:"#0071e3" }} />
                            </td>
                            <td style={{ padding:"10px 10px" }}>
                              <input type="text" value={part.mpn||""} onChange={e=>updatePart(part.id,"mpn",e.target.value)}
                                style={{ border:"none",background:"transparent",fontWeight:700,fontSize:13,width:"100%",color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";e.target.style.padding="2px 4px";}}
                                onBlur={e=>{e.target.style.background="transparent";e.target.style.padding="0";}} />
                            </td>
                            <td style={{ padding:"10px 10px" }}>
                              <input type="text" value={part.value||""} onChange={e=>updatePart(part.id,"value",e.target.value)}
                                style={{ border:"none",background:"transparent",fontSize:12,width:"100%",color:darkMode?"#c7c7cc":"#6e6e73",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px",maxWidth:180 }}>
                              <input type="text" value={part.description||""} onChange={e=>updatePart(part.id,"description",e.target.value)}
                                style={{ border:"none",background:"transparent",fontSize:12,width:"100%",color:darkMode?"#c7c7cc":"#6e6e73",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px" }}>
                              <input type="text" value={part.manufacturer||""} onChange={e=>updatePart(part.id,"manufacturer",e.target.value)}
                                style={{ border:"none",background:"transparent",fontSize:12,width:"100%",color:darkMode?"#c7c7cc":"#6e6e73",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px",textAlign:"right" }}>
                              <input type="number" min="1" value={part.quantity||""} onChange={e=>updatePart(part.id,"quantity",parseInt(e.target.value)||1)}
                                style={{ border:"none",background:"transparent",fontSize:13,fontWeight:700,width:50,textAlign:"right",color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px",textAlign:"right" }}>
                              <input type="number" min="0" value={part.stockQty||""} onChange={e=>updatePart(part.id,"stockQty",e.target.value)}
                                style={{ border:"none",background:"transparent",fontSize:13,width:50,textAlign:"right",color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px",textAlign:"right" }}>
                              <input type="number" min="0" value={part.reorderQty||""} onChange={e=>updatePart(part.id,"reorderQty",e.target.value)}
                                style={{ border:"none",background:"transparent",fontSize:12,width:50,textAlign:"right",color:darkMode?"#c7c7cc":"#86868b",fontFamily:"inherit",outline:"none" }}
                                onFocus={e=>{e.target.style.background=darkMode?"#3a3a3e":"#f5f5f7";e.target.style.borderRadius="4px";}}
                                onBlur={e=>{e.target.style.background="transparent";}} />
                            </td>
                            <td style={{ padding:"10px 10px",textAlign:"right",fontSize:12,color:stockVal>0?(darkMode?"#f5f5f7":"#1d1d1f"):"#c7c7cc" }}>
                              {stockVal > 0 ? `$${fmtDollar(stockVal)}` : "--"}
                            </td>
                            <td style={{ padding:"10px 10px",textAlign:"right" }}>
                              <button onClick={()=>{if(window.confirm(`Remove "${part.mpn||part.reference}" from this product?`))updatePart(part.id,"projectId",null);}}
                                title="Remove from product"
                                style={{ background:"none",border:"none",cursor:"pointer",color:"#c7c7cc",fontSize:13,padding:"2px 6px",borderRadius:4,transition:"color 0.15s" }}
                                onMouseOver={(e)=>e.target.style.color="#ff9500"}
                                onMouseOut={(e)=>e.target.style.color="#c7c7cc"}>remove</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ background:darkMode?"#2c2c2e":"#fff",borderRadius:14,padding:"40px 20px",textAlign:"center",color:"#86868b",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize:14 }}>No parts assigned to this product yet. Use the form above to add parts.</div>
              </div>
            )}

            {/* ── Production Run Simulator */}
            {prodParts.length > 0 && (
              <div style={{ background:darkMode?"#2c2c2e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontSize:10,color:"#86868b",letterSpacing:"0.5px",fontWeight:500,marginBottom:10,textTransform:"uppercase" }}>
                  Production Run Simulator
                </div>
                <div style={{ display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12 }}>
                  <span style={{ fontSize:12,color:"#86868b" }}>If I build</span>
                  <input type="number" min="1" placeholder="100"
                    value={bomSim[prod.id]?.qty || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const pid = prod.id;
                      setBomSim(prev => ({ ...prev, [pid]: { ...prev[pid], qty: val } }));
                      clearTimeout(simTimer.current);
                      if (parseInt(val) > 0) simTimer.current = setTimeout(() => runBomSimulation(pid), 600);
                    }}
                    style={{ width:100,padding:"6px 10px",borderRadius:5,fontSize:14,fontWeight:700,textAlign:"center",background:darkMode?"#3a3a3e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f",border:"1px solid "+(darkMode?"#48484a":"#d2d2d7") }} />
                  <span style={{ fontSize:12,color:"#86868b" }}>units of <strong style={{ color:darkMode?"#f5f5f7":"#1d1d1f" }}>{prod.name}</strong>...</span>
                  <button className="btn-primary" style={{ fontSize:12 }}
                    disabled={bomSim[prod.id]?.loading || !parseInt(bomSim[prod.id]?.qty)}
                    onClick={() => runBomSimulation(prod.id)}>
                    {bomSim[prod.id]?.loading ? <><span className="spinner" /> Calculating...</> : "Run Simulation"}
                  </button>
                  <label style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#86868b",cursor:"pointer",marginLeft:8 }}>
                    <input type="checkbox" checked={simUsOnly} onChange={(e)=>{
                      const v = e.target.checked;
                      setSimUsOnly(v);
                      if (bomSim[prod.id]?.results) runBomSimulation(prod.id, v);
                    }} />
                    US suppliers only
                  </label>
                </div>

                {bomSim[prod.id]?.results && (() => {
                  const results = bomSim[prod.id].results;
                  const baseResult = results.reduce((min, r) => !min || r.qty < min.qty ? r : min, null);
                  if (!baseResult) return null;
                  const baseQty = baseResult.qty;
                  const cheapBase = baseResult.cheapest;
                  const smartBase = baseResult.smart;
                  const smartSavings = cheapBase.total - smartBase.total;
                  const smartResults = results.map(r => ({ qty: r.qty, ...r.smart }));
                  const bestQty = smartResults.reduce((a, b) => a.perUnit < b.perUnit ? a : b);

                  return (
                    <div>
                      <div style={{ display:"flex",gap:12,flexWrap:"wrap",marginBottom:16 }}>
                        <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:8,padding:"12px 16px",minWidth:200,flex:1,border:"1px solid "+(darkMode?"#3a3a3e":"#e5e5ea") }}>
                          <div style={{ fontSize:10,color:"#ff9500",fontWeight:700,letterSpacing:"0.06em",marginBottom:4 }}>CHEAPEST PER PART</div>
                          <div style={{ fontSize:22,fontWeight:800,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",color:darkMode?"#f5f5f7":"#1d1d1f" }}>
                            ${fmtPrice(cheapBase.perUnit)}<span style={{ fontSize:12,color:"#86868b",fontWeight:400 }}> / unit</span>
                          </div>
                          <div style={{ fontSize:11,color:"#86868b",marginTop:8 }}>Parts: {"$"}{fmtDollar(cheapBase.partsCost)}</div>
                          <div style={{ fontSize:11,color:"#86868b" }}>Shipping: {"$"}{fmtDollar(cheapBase.shipping)} ({cheapBase.suppliers.length} vendor{cheapBase.suppliers.length!==1?"s":""})</div>
                          <div style={{ fontSize:11,color:cheapBase.tariffTotal>0?"#ff3b30":"#86868b" }}>Tariffs: {cheapBase.tariffTotal > 0 ? `$${fmtDollar(cheapBase.tariffTotal)}` : "$0.00"}</div>
                          <div style={{ fontSize:12,color:darkMode?"#f5f5f7":"#1d1d1f",fontWeight:700,marginTop:4,borderTop:"1px solid "+(darkMode?"#3a3a3e":"#e5e5ea"),paddingTop:4 }}>Total: {"$"}{fmtDollar(cheapBase.total)}</div>
                          <div style={{ fontSize:10,color:"#aeaeb2",marginTop:6 }}>{cheapBase.shippingBreakdown.map(sb => <div key={sb.supplierId}>{sb.name}: {"$"}{fmtDollar(sb.cost)} shipping</div>)}</div>
                          {cheapBase.tariffBreakdown?.length > 0 && <div style={{ fontSize:10,color:"#ff3b30",marginTop:4 }}>{cheapBase.tariffBreakdown.map((t,i) => <div key={i}>{t.mpn} (made in {t.origin}): {t.rate}% on {"$"}{fmtDollar(t.goodsValue)} = {"$"}{fmtDollar(t.cost)}</div>)}</div>}
                        </div>
                        <div style={{ background:smartSavings>0?"rgba(52,199,89,0.06)":(darkMode?"#1c1c1e":"#fff"),
                          border:smartSavings>0?"1px solid #34c759":"1px solid "+(darkMode?"#3a3a3e":"#e5e5ea"),
                          borderRadius:8,padding:"12px 16px",minWidth:200,flex:1 }}>
                          <div style={{ fontSize:10,color:"#34c759",fontWeight:700,letterSpacing:"0.06em",marginBottom:4 }}>SMART CONSOLIDATED {smartSavings > 0 ? "-- RECOMMENDED" : ""}</div>
                          <div style={{ fontSize:22,fontWeight:800,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",color:"#34c759" }}>
                            ${fmtPrice(smartBase.perUnit)}<span style={{ fontSize:12,color:"#86868b",fontWeight:400 }}> / unit</span>
                          </div>
                          <div style={{ fontSize:11,color:"#86868b",marginTop:8 }}>Parts: {"$"}{fmtDollar(smartBase.partsCost)}</div>
                          <div style={{ fontSize:11,color:"#86868b" }}>Shipping: {"$"}{fmtDollar(smartBase.shipping)} ({smartBase.suppliers.length} vendor{smartBase.suppliers.length!==1?"s":""})</div>
                          <div style={{ fontSize:11,color:smartBase.tariffTotal>0?"#ff3b30":"#86868b" }}>Tariffs: {smartBase.tariffTotal > 0 ? `$${fmtDollar(smartBase.tariffTotal)}` : "$0.00"}</div>
                          <div style={{ fontSize:12,color:darkMode?"#f5f5f7":"#1d1d1f",fontWeight:700,marginTop:4,borderTop:"1px solid "+(darkMode?"#3a3a3e":"#e5e5ea"),paddingTop:4 }}>Total: {"$"}{fmtDollar(smartBase.total)}</div>
                          <div style={{ fontSize:10,color:"#aeaeb2",marginTop:6 }}>{smartBase.shippingBreakdown.map(sb => <div key={sb.supplierId}>{sb.name}: {"$"}{fmtDollar(sb.cost)} shipping</div>)}</div>
                          {smartBase.tariffBreakdown?.length > 0 && <div style={{ fontSize:10,color:"#ff3b30",marginTop:4 }}>{smartBase.tariffBreakdown.map((t,i) => <div key={i}>{t.mpn} (made in {t.origin}): {t.rate}% on {"$"}{fmtDollar(t.goodsValue)} = {"$"}{fmtDollar(t.cost)}</div>)}</div>}
                          {smartSavings > 0 && <div style={{ fontSize:12,color:"#34c759",fontWeight:700,marginTop:6 }}>Saves {"$"}{fmtDollar(smartSavings)} total vs cheapest-per-part</div>}
                        </div>
                      </div>

                      <div style={{ fontSize:10,color:"#5856d6",fontWeight:700,letterSpacing:"0.06em",marginBottom:6 }}>QUANTITY COMPARISON (Smart Consolidated)</div>
                      <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",overflow:"hidden" }}>
                      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                        <thead>
                          <tr style={{ background:darkMode?"#3a3a3e":"#b8bdd1",color:darkMode?"#e5e5ea":"#3a3f51" }}>
                            {["Units","Parts Cost","Shipping","Tariffs","Total","Per Unit","Vendors","vs Base"].map((h,hi,arr)=>(
                              <th key={hi} style={{ padding:"12px 14px",textAlign:hi>0?"right":"left",
                                fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",
                                fontSize:11,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap",
                                borderRadius:hi===0?"8px 0 0 0":hi===arr.length-1?"0 8px 0 0":undefined }}>{h}</th>
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
                              <tr key={r.qty} style={{ borderBottom:"1px solid "+(darkMode?"#3a3a3e":"#ededf0"),
                                background: isBest ? "rgba(52,199,89,0.06)" : isBase ? (darkMode?"#2c2c2e":"#f9f9fb") : "transparent" }}>
                                <td style={{ padding:"12px 14px",fontWeight:isBase||isBest?700:400,color:isBest?"#34c759":isBase?(darkMode?"#f5f5f7":"#1d1d1f"):"#6e6e73" }}>
                                  {r.qty.toLocaleString()}{isBest?" (best value)":""}{isBase?" (base)":""}
                                </td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:"#6e6e73" }}>{"$"}{fmtDollar(s.partsCost)}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:"#6e6e73" }}>{"$"}{fmtDollar(s.shipping)}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:s.tariffTotal>0?"#ff3b30":"#c7c7cc" }}>{s.tariffTotal > 0 ? `$${fmtDollar(s.tariffTotal)}` : "--"}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:darkMode?"#f5f5f7":"#1d1d1f",fontWeight:600 }}>{"$"}{fmtDollar(s.total)}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",fontWeight:700,color:isBest?"#34c759":(darkMode?"#f5f5f7":"#1d1d1f") }}>{"$"}{fmtPrice(s.perUnit)}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:"#6e6e73" }}>{s.suppliers.length}</td>
                                <td style={{ padding:"12px 14px",textAlign:"right",color:diff>0?"#34c759":diff<0?"#ff3b30":"#c7c7cc",fontWeight:diff!==0?600:400 }}>
                                  {isBase ? "--" : diff > 0 ? `-$${fmtPrice(diff)}/ea` : diff < 0 ? `+$${fmtPrice(Math.abs(diff))}/ea` : "same"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>

                      <div style={{ marginTop:16,display:"flex",alignItems:"center",gap:12 }}>
                        <button className="btn-primary" style={{ fontSize:13,padding:"10px 24px",background:"#34c759" }}
                          onClick={() => {
                            const assign = smartBase.assignments;
                            if (!assign?.length) return;
                            const grouped = {};
                            for (const a of assign) { if (!a.supplierId) continue; if (!grouped[a.supplierId]) grouped[a.supplierId] = []; grouped[a.supplierId].push(a); }
                            setParts(prev => prev.map(p => {
                              const a = assign.find(x => x.partId === p.id);
                              if (!a) return p;
                              return { ...p, flaggedForOrder: true, orderQty: String(a.needed), preferredSupplier: a.supplierId || p.preferredSupplier };
                            }));
                            for (const a of assign) {
                              if (!a.supplierId) continue;
                              dbUpdatePart(a.partId, { flagged_for_order: true, order_qty: a.needed, preferred_supplier: a.supplierId }, user.id).catch(e => console.error("order flag failed:", e));
                            }
                            setActiveView("purchasing");
                          }}>
                          Order This Run
                        </button>
                        <span style={{ fontSize:11,color:"#86868b" }}>
                          Flags all parts for purchase at the base qty ({baseQty.toLocaleString()} units) using Smart Consolidated assignments
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

          </div>
          );
        })()}

        {/* ══════════════════════════════════════
            ALERTS
        ══════════════════════════════════════ */}
        {/* ══════════════════════════════════════
            DEMAND (Shopify Orders)
        ══════════════════════════════════════ */}
        {activeView === "demand" && (() => {
          const partsDemand = computePartsDemand();
          const _skipWords = ["shipping","gift card","tip","gratuity","donation","insurance","handling","gift wrap","express shipping"];
          const _isNonProduct = (title) => { const t = title.toLowerCase(); return _skipWords.some(w => t.includes(w)); };
          const unmapped = shopifyDemand?.products?.filter(sp => {
            if (_isNonProduct(sp.title)) return false;
            return !products.find(p =>
              p.shopifyProductId === sp.shopifyProductId ||
              sp.title.toLowerCase().includes(p.name.toLowerCase()) ||
              p.name.toLowerCase().includes(sp.title.toLowerCase())
            );
          }) || [];
          return (
          <div style={{ maxWidth:1100 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12 }}>
              <div>
                <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:21,fontWeight:800,marginBottom:4 }}>Order Demand</h2>
                <p style={{ color:"#86868b",fontSize:13 }}>Unfulfilled Shopify orders → parts you need to build.</p>
              </div>
              <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                {shopifyDemand?.syncedAt && (
                  <span style={{ fontSize:11,color:"#86868b" }}>
                    Synced {new Date(shopifyDemand.syncedAt).toLocaleString()}
                  </span>
                )}
                <button className="btn-primary" onClick={syncShopifyOrders}
                  disabled={shopifyDemand?.loading}>
                  {shopifyDemand?.loading ? <><span className="spinner" /> Syncing…</> : "⟳ Sync Shopify Orders"}
                </button>
                {partsDemand.length > 0 && (
                  <button className="btn-primary" style={{ background:"#34c759" }}
                    onClick={() => {
                      const toFlag = [];
                      for (const d of partsDemand) {
                        const stock = parseInt(d.part.stockQty) || 0;
                        const deficit = d.needed - stock;
                        if (deficit <= 0) continue;
                        toFlag.push({ id: d.part.id, qty: deficit });
                      }
                      if (!toFlag.length) { alert("All parts are in stock — nothing to order!"); return; }
                      setParts(prev => prev.map(p => {
                        const match = toFlag.find(f => f.id === p.id);
                        if (!match) return p;
                        return { ...p, flaggedForOrder: true, orderQty: String(match.qty) };
                      }));
                      for (const f of toFlag) {
                        dbUpdatePart(f.id, { flagged_for_order: true, order_qty: f.qty }, user.id).catch(e => console.error("flag failed:", e));
                      }
                      setActiveView("purchasing");
                    }}>
                    Order Needed ({partsDemand.filter(d => d.needed > (parseInt(d.part.stockQty) || 0)).length} parts)
                  </button>
                )}
              </div>
            </div>

            {shopifyDemand?.error && (
              <div style={{ background:"#fff2f0",border:"1px solid #ff3b30",borderRadius:8,padding:"12px 16px",marginBottom:16,fontSize:12,color:"#ff3b30" }}>
                {shopifyDemand.error.includes("configured") || shopifyDemand.error.includes("No Shopify") ? (
                  <>No Shopify stores configured. <button className="btn-ghost" style={{ fontSize:11,marginLeft:8 }}
                    onClick={() => setActiveView("settings")}>Go to Settings →</button></>
                ) : shopifyDemand.error}
              </div>
            )}

            {!shopifyDemand && !shopifyDemand?.loading && (
              <div className="card" style={{ textAlign:"center",padding:60 }}>
                <div style={{ fontSize:40,marginBottom:12 }}>🛒</div>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:15,marginBottom:8 }}>Connect Shopify to see order demand</div>
                <p style={{ color:"#86868b",fontSize:13,marginBottom:16 }}>Add your Shopify store domain and admin token in Settings, then sync.</p>
                <button className="btn-primary" onClick={() => setActiveView("settings")}>⚙ Go to Settings</button>
              </div>
            )}

            {shopifyDemand && !shopifyDemand.error && (
              <>
                {/* ── Summary cards */}
                <div style={{ display:"flex",gap:12,marginBottom:20,flexWrap:"wrap" }}>
                  {[
                    { label:"Open Orders", value:shopifyDemand.totalOrders || 0, color:"#0071e3" },
                    { label:"Products in Demand", value:shopifyDemand.products?.length || 0, color:"#5856d6" },
                    { label:"Parts Needed", value:partsDemand.length, color:"#ff9500" },
                    { label:"Parts Short", value:partsDemand.filter(d => d.needed > (parseInt(d.part.stockQty) || 0)).length, color:"#ff3b30" },
                  ].map(c => (
                    <div key={c.label} className="card" style={{ flex:"1 1 140px",textAlign:"center",padding:"16px 12px" }}>
                      <div style={{ fontSize:28,fontWeight:800,color:c.color,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                        {c.value.toLocaleString()}
                      </div>
                      <div style={{ fontSize:10,color:"#86868b",letterSpacing:"0.08em",marginTop:2 }}>{c.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {/* ── Unmapped Shopify products */}
                {unmapped.length > 0 && (
                  <div style={{ background:"#fff8e6",border:"1px solid #ff9500",borderRadius:8,padding:"12px 16px",marginBottom:16 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                      <div style={{ fontSize:12,fontWeight:700,color:"#ff9500" }}>
                        {unmapped.length} Shopify product{unmapped.length !== 1 ? "s" : ""} not mapped to BOM products
                      </div>
                      <button className="btn-ghost" style={{ fontSize:10,fontWeight:700,color:"#ff9500" }}
                        onClick={async () => {
                          const colors = ["#ff9500","#5856d6","#ff3b30","#34c759","#0071e3","#ff2d55"];
                          for (let i = 0; i < unmapped.length; i++) {
                            const u = unmapped[i];
                            const color = colors[(products.length + i) % colors.length];
                            try {
                              await createProduct({ name: u.title, color, userId: user.id, shopify_product_id: u.shopifyProductId });
                            } catch (e) { console.error("Create product failed:", e); }
                          }
                        }}>
                        Create All ({unmapped.length})
                      </button>
                    </div>
                    {unmapped.map((u, i) => (
                      <div key={u.shopifyProductId} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"6px 0",borderBottom:"1px solid #ff950022" }}>
                        <span style={{ fontSize:12,color:"#1d1d1f" }}>{u.title}</span>
                        <button className="btn-ghost" style={{ fontSize:10,whiteSpace:"nowrap" }}
                          onClick={async (e) => {
                            const btn = e.currentTarget;
                            const colors = ["#ff9500","#5856d6","#ff3b30","#34c759","#0071e3","#ff2d55"];
                            const color = colors[(products.length + i) % colors.length];
                            try {
                              await createProduct({ name: u.title, color, userId: user.id, shopify_product_id: u.shopifyProductId });
                              btn.textContent = "Created ✓";
                              btn.style.color = "#34c759";
                              btn.disabled = true;
                            } catch (e) { console.error("Create product failed:", e); }
                          }}>
                          + Create Product
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Parts demand table */}
                {partsDemand.length > 0 && (
                  <div className="card" style={{ marginBottom:16 }}>
                    <div style={{ fontSize:10,color:"#aeaeb2",letterSpacing:"0.1em",fontWeight:700,marginBottom:12 }}>PARTS DEMAND BREAKDOWN</div>
                    <div style={{ overflowX:"auto" }}>
                      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                        <thead>
                          <tr style={{ borderBottom:"2px solid #e5e5ea",textAlign:"left" }}>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600 }}>PART</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600 }}>MPN</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>NEEDED</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>IN STOCK</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>DEFICIT</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600 }}>FOR PRODUCTS</th>
                            <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600 }}>ACTION</th>
                          </tr>
                        </thead>
                        <tbody>
                          {partsDemand.map(d => {
                            const stock = parseInt(d.part.stockQty) || 0;
                            const deficit = d.needed - stock;
                            return (
                              <tr key={d.part.id} style={{ borderBottom:"1px solid #f0f0f2" }}>
                                <td style={{ padding:"10px 10px" }}>
                                  <div style={{ fontWeight:700,color:"#0071e3" }}>{d.part.reference}</div>
                                  <div style={{ fontSize:11,color:"#86868b" }}>{d.part.value}</div>
                                </td>
                                <td style={{ padding:"10px 10px",fontSize:11,color:"#3a3f51" }}>{d.part.mpn || "—"}</td>
                                <td style={{ padding:"10px 10px",textAlign:"right",fontWeight:700,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                  {d.needed.toLocaleString()}
                                </td>
                                <td style={{ padding:"10px 10px",textAlign:"right",color:stock >= d.needed ? "#34c759" : "#86868b" }}>
                                  {stock.toLocaleString()}
                                </td>
                                <td style={{ padding:"10px 10px",textAlign:"right",fontWeight:700,
                                  color: deficit > 0 ? "#ff3b30" : "#34c759",
                                  fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                  {deficit > 0 ? `-${deficit.toLocaleString()}` : "✓"}
                                </td>
                                <td style={{ padding:"10px 10px" }}>
                                  <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
                                    {d.products.map((pr,i) => (
                                      <span key={i} className="badge" style={{ background:pr.color+"22",color:pr.color,fontSize:10 }}>
                                        {pr.name} ×{pr.qty} ({pr.perUnit}/unit)
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td style={{ padding:"10px 10px" }}>
                                  {deficit > 0 && (
                                    <button className="btn-ghost" style={{ fontSize:10 }}
                                      onClick={() => {
                                        setParts(prev => prev.map(p =>
                                          p.id === d.part.id ? { ...p, flaggedForOrder: true, orderQty: String(deficit) } : p
                                        ));
                                      }}>
                                      🚩 Flag ({deficit.toLocaleString()})
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {partsDemand.some(d => d.needed > (parseInt(d.part.stockQty) || 0)) && (
                      <div style={{ marginTop:12,display:"flex",gap:10 }}>
                        <button className="btn-primary" onClick={() => {
                          setParts(prev => prev.map(p => {
                            const d = partsDemand.find(x => x.part.id === p.id);
                            if (!d) return p;
                            const deficit = d.needed - (parseInt(p.stockQty) || 0);
                            if (deficit <= 0) return p;
                            return { ...p, flaggedForOrder: true, orderQty: String(deficit) };
                          }));
                          setActiveView("purchasing");
                        }}>
                          🚩 Flag All Short Parts & Go to Purchasing
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Build Plan + Sales Forecast */}
                {shopifyDemand.orders?.length > 0 && (() => {
                  // Calculate daily sell rate per product from order history
                  const now = new Date();
                  const skipWords = ["shipping","gift card","tip","gratuity","donation","insurance","handling","gift wrap","express shipping"];
                  const isNonProduct = (title) => { const t = title.toLowerCase(); return skipWords.some(w => t.includes(w)); };
                  const productSales = {}; // { title: { total, dates[], storeName } }
                  for (const order of shopifyDemand.orders) {
                    const d = new Date(order.createdAt);
                    for (const li of order.lineItems) {
                      if (isNonProduct(li.title)) continue;
                      if (!productSales[li.title]) productSales[li.title] = { total: 0, oldest: d, newest: d, storeName: order.storeName || "" };
                      productSales[li.title].total += li.quantity;
                      if (d < productSales[li.title].oldest) productSales[li.title].oldest = d;
                      if (d > productSales[li.title].newest) productSales[li.title].newest = d;
                    }
                  }
                  // Calculate rates and forecasts
                  const forecasts = Object.entries(productSales).map(([title, data]) => {
                    const daySpan = Math.max(1, (now - data.oldest) / (1000 * 60 * 60 * 24));
                    const dailyRate = data.total / daySpan;
                    // Find matching BOM product for current unfulfilled count
                    const sp = shopifyDemand.products?.find(p => p.title === title);
                    const unfulfilled = sp?.totalUnfulfilled || 0;
                    return {
                      title, storeName: data.storeName,
                      totalOrdered: data.total, daySpan: Math.round(daySpan),
                      dailyRate, weeklyRate: dailyRate * 7, monthlyRate: dailyRate * 30,
                      forecast30: Math.ceil(dailyRate * 30),
                      forecast60: Math.ceil(dailyRate * 60),
                      forecast90: Math.ceil(dailyRate * 90),
                      unfulfilled,
                    };
                  }).filter(f => f.dailyRate > 0).sort((a, b) => b.monthlyRate - a.monthlyRate);

                  return (
                    <>
                    {/* Sales Forecast */}
                    {forecasts.length > 0 && (
                      <div className="card">
                        <div style={{ fontSize:10,color:"#aeaeb2",letterSpacing:"0.1em",fontWeight:700,marginBottom:12 }}>
                          SALES FORECAST — BASED ON {shopifyDemand.orders.length} ORDERS
                        </div>
                        <div style={{ overflowX:"auto" }}>
                          <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
                            <thead>
                              <tr style={{ borderBottom:"2px solid #e5e5ea",textAlign:"left" }}>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600 }}>PRODUCT</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>DAILY AVG</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>WEEKLY</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>MONTHLY</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"center",background:"#f0f7ff",borderRadius:"6px 0 0 0" }}>30 DAY</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"center",background:"#fff8f0" }}>60 DAY</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"center",background:"#fff2f0",borderRadius:"0 6px 0 0" }}>90 DAY</th>
                                <th style={{ padding:"8px 10px",fontSize:10,color:"#86868b",fontWeight:600,textAlign:"right" }}>UNFULFILLED</th>
                              </tr>
                            </thead>
                            <tbody>
                              {forecasts.map(f => (
                                <tr key={f.title} style={{ borderBottom:"1px solid #f0f0f2" }}>
                                  <td style={{ padding:"10px 10px" }}>
                                    <div style={{ fontWeight:600,color:"#1d1d1f" }}>{f.title}</div>
                                    <div style={{ fontSize:10,color:"#86868b" }}>
                                      {f.totalOrdered.toLocaleString()} sold over {f.daySpan} days
                                      {f.storeName && <span style={{ color:"#5856d6",fontWeight:600,marginLeft:4 }}>{f.storeName}</span>}
                                    </div>
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"right",fontWeight:600,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                    {f.dailyRate.toFixed(1)}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"right",color:"#86868b" }}>
                                    {f.weeklyRate.toFixed(1)}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"right",fontWeight:600 }}>
                                    {Math.round(f.monthlyRate).toLocaleString()}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"center",fontWeight:700,fontSize:14,
                                    background:"#f0f7ff",color:"#0071e3",
                                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                    {f.forecast30.toLocaleString()}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"center",fontWeight:700,fontSize:14,
                                    background:"#fff8f0",color:"#ff9500",
                                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                    {f.forecast60.toLocaleString()}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"center",fontWeight:700,fontSize:14,
                                    background:"#fff2f0",color:"#ff3b30",
                                    fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>
                                    {f.forecast90.toLocaleString()}
                                  </td>
                                  <td style={{ padding:"10px 10px",textAlign:"right",fontWeight:700,
                                    color:f.unfulfilled > 0 ? "#ff3b30" : "#34c759" }}>
                                    {f.unfulfilled > 0 ? f.unfulfilled.toLocaleString() : "✓"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ marginTop:10,fontSize:10,color:"#aeaeb2",fontStyle:"italic" }}>
                          Forecast based on average daily sell rate across all open orders in the sync window. Rates update each time you sync.
                        </div>
                      </div>
                    )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
          );
        })()}

        {activeView === "alerts" && (
          <div style={{ maxWidth:860 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:21,fontWeight:800,marginBottom:6 }}>Low Stock Alerts</h2>
            <p style={{ color:"#86868b",fontSize:13,marginBottom:22 }}>Parts at or below reorder threshold.</p>
            {lowStockParts.length===0 ? (
              <div className="card" style={{ textAlign:"center",padding:60 }}>
                <div style={{ fontSize:40,marginBottom:12 }}>✅</div>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:15,color:"#34c759" }}>All parts above reorder thresholds</div>
              </div>
            ) : (
              <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                {lowStockParts.map((part) => {
                  const projList = products.filter((p)=>part.projectId === p.id);
                  const sup = supplierById(part.preferredSupplier);
                  return (
                    <div key={part.id} className="card" style={{ borderLeft:"3px solid #ff3b30",display:"flex",alignItems:"center",gap:16,padding:"14px 18px",flexWrap:"wrap" }}>
                      <span className="alert-dot" />
                      <div style={{ flex:1,minWidth:200 }}>
                        <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:4,flexWrap:"wrap" }}>
                          <span style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:800,color:"#0071e3" }}>{part.reference}</span>
                          <span style={{ color:"#86868b",fontSize:12 }}>{part.value}</span>
                          <span style={{ color:"#0071e3",fontSize:12 }}>{part.mpn}</span>
                          {projList.map(pr=><span key={pr.id} className="badge" style={{ background:pr.color+"22",color:pr.color }}>{pr.name}</span>)}
                        </div>
                        <div style={{ fontSize:12,color:"#86868b" }}>
                          Stock: <span style={{ color:"#ff3b30",fontWeight:700 }}>{part.stockQty}</span>
                          &nbsp;· Reorder at: <span style={{ color:"#86868b" }}>{part.reorderQty}</span>
                          &nbsp;· Via: <span style={{ color:sup.color,fontWeight:700 }}>{sup.name}</span>
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                        <input type="checkbox" style={{ width:16,height:16,cursor:"pointer",accentColor:"#0071e3" }}
                          checked={part.flaggedForOrder} onChange={()=>toggleFlag(part.id)} />
                        <span style={{ fontSize:11,color:"#86868b" }}>Flag for PO</span>
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
            PRODUCTION FLOOR
        ══════════════════════════════════════ */}
        {activeView === "production" && (() => {
          const activeOrders = buildOrders.filter(b => b.status !== "completed");
          const completedOrders = buildOrders.filter(b => b.status === "completed");
          const today = new Date(); today.setHours(0,0,0,0);
          const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
          const completedToday = completedOrders.filter(b => b.updated_at && new Date(b.updated_at) >= today).length;
          const completedWeek = completedOrders.filter(b => b.updated_at && new Date(b.updated_at) >= weekAgo).length;
          const activeMembers = teamMembers.filter(t => t.active !== false);

          // ── Performance stats per team member
          const memberStats = teamMembers.map(m => {
            const memberAssignments = buildAssignments.filter(a => a.team_member_id === m.id && a.status === "completed" && a.started_at && a.completed_at);
            const totalBuilds = buildAssignments.filter(a => a.team_member_id === m.id && a.status === "completed").length;
            const totalUnits = memberAssignments.reduce((s, a) => {
              const bo = buildOrders.find(b => b.id === a.build_order_id);
              return s + (bo?.quantity || 0);
            }, 0);
            // Average time per build (in hours)
            const durations = memberAssignments.map(a => (new Date(a.completed_at) - new Date(a.started_at)) / 3600000);
            const avgHours = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;
            // Avg time per unit
            const avgPerUnit = totalUnits > 0 && durations.length > 0
              ? durations.reduce((s, d, i) => { const bo = buildOrders.find(b => b.id === memberAssignments[i].build_order_id); return s + d / (bo?.quantity || 1); }, 0) / durations.length * 60
              : 0; // in minutes
            return { ...m, totalBuilds, totalUnits, avgHours, avgPerUnit, durations };
          }).filter(m => m.totalBuilds > 0).sort((a, b) => a.avgPerUnit - b.avgPerUnit || b.totalUnits - a.totalUnits);

          const handleCreateTeamMember = async () => {
            if (!newTeamMember.name.trim()) return;
            setProdBusy(true);
            try {
              await createTeamMember({
                name: newTeamMember.name.trim(),
                role: newTeamMember.role,
                phone: newTeamMember.phone.trim() || null,
                email: newTeamMember.email.trim() || null,
                pin_code: newTeamMember.pin_code.trim() || null,
                active: true,
              });
              // realtime INSERT will add to state
              setNewTeamMember({ name:"", role:"assembler", phone:"", email:"", pin_code:"" });
            } catch (e) { console.error("Create team member failed:", e); alert("Failed to add team member: " + e.message); }
            setProdBusy(false);
          };

          const handleToggleActive = async (member) => {
            try {
              await updateTeamMember(member.id, { active: !member.active });
              setTeamMembers(prev => prev.map(t => t.id === member.id ? { ...t, active: !t.active } : t));
            } catch (e) { console.error("Toggle active failed:", e); }
          };

          const handleDeleteTeamMember = async (id) => {
            if (!window.confirm("Delete this team member?")) return;
            try {
              await deleteTeamMember(id);
              setTeamMembers(prev => prev.filter(t => t.id !== id));
            } catch (e) { console.error("Delete team member failed:", e); }
          };

          const handleCreateBuildOrder = async () => {
            if (!newBuildOrder.product_id || !newBuildOrder.quantity) return;
            setProdBusy(true);
            try {
              const bo = await createBuildOrder({
                product_id: newBuildOrder.product_id,
                quantity: parseInt(newBuildOrder.quantity),
                priority: newBuildOrder.priority,
                status: newBuildOrder.team_member_id ? "assigned" : "pending",
                due_date: newBuildOrder.due_date || null,
                notes: newBuildOrder.notes.trim() || "",
                completed_count: 0,
              }, user.id);
              if (newBuildOrder.team_member_id) {
                await createBuildAssignment({
                  build_order_id: bo.id,
                  team_member_id: newBuildOrder.team_member_id,
                  status: "assigned",
                });
                // SMS notify the assigned builder
                const member = teamMembers.find(m => m.id === newBuildOrder.team_member_id);
                const prod = products.find(p => p.id === newBuildOrder.product_id);
                console.log("[SMS] member:", member?.name, "phone:", member?.phone, "twilio_sid:", apiKeys.twilio_account_sid ? "SET" : "EMPTY");
                if (member?.phone && apiKeys.twilio_account_sid) {
                  const dueStr = newBuildOrder.due_date ? ` Due: ${new Date(newBuildOrder.due_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : "";
                  console.log("[SMS] Sending to", member.phone, "from", apiKeys.twilio_phone_number);
                  fetch("/api/send-sms", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      to: member.phone,
                      message: `New build assigned: ${bo.quantity}x ${prod?.name || "product"}. Priority: ${newBuildOrder.priority}.${dueStr}\n— Jackson Audio BOM Manager`,
                      accountSid: apiKeys.twilio_account_sid,
                      authToken: apiKeys.twilio_auth_token,
                      fromNumber: apiKeys.twilio_phone_number,
                    }),
                  }).then(r => r.json()).then(d => console.log("[SMS] Response:", d)).catch(e => console.error("[SMS] Failed:", e));
                } else {
                  console.warn("[SMS] Skipped — phone:", member?.phone, "twilio_sid:", apiKeys.twilio_account_sid);
                }
              }
              setNewBuildOrder({ product_id:"", quantity:"", priority:"normal", due_date:"", team_member_id:"", notes:"" });
            } catch (e) { console.error("Create build order failed:", e); alert("Failed: " + e.message); }
            setProdBusy(false);
          };

          const handleStartBuild = async (bo) => {
            try {
              await updateBuildOrder(bo.id, { status: "in-progress" });
              setBuildOrders(prev => prev.map(b => b.id === bo.id ? { ...b, status: "in-progress" } : b));
              const assignment = buildAssignments.find(a => a.build_order_id === bo.id && a.status !== "completed");
              if (assignment) {
                await updateBuildAssignment(assignment.id, { status: "in-progress", started_at: new Date().toISOString() });
                setBuildAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, status: "in-progress", started_at: new Date().toISOString() } : a));
              }
            } catch (e) { console.error("Start build failed:", e); }
          };

          // ── Check off one unit (increment completed_count)
          const handleCheckOffUnit = async (bo) => {
            const newCount = (bo.completed_count || 0) + 1;
            const isFinished = newCount >= bo.quantity;
            try {
              if (isFinished) {
                // Auto-start if not started
                if (bo.status === "pending" || bo.status === "assigned") {
                  await updateBuildOrder(bo.id, { status: "in-progress" });
                }
                // Deduct stock for all parts
                const productParts = parts.filter(p => p.projectId === bo.product_id);
                for (const part of productParts) {
                  const currentStock = parseInt(part.stockQty) || 0;
                  const deduction = (part.quantity || 1) * bo.quantity;
                  const newStock = Math.max(0, currentStock - deduction);
                  await updatePart(part.id, "stockQty", String(newStock));
                }
                await updateBuildOrder(bo.id, { status: "completed", completed_count: newCount });
                setBuildOrders(prev => prev.map(b => b.id === bo.id ? { ...b, status: "completed", completed_count: newCount, updated_at: new Date().toISOString() } : b));
                const assignment = buildAssignments.find(a => a.build_order_id === bo.id && a.status !== "completed");
                let buildDuration = null;
                if (assignment) {
                  const now = new Date().toISOString();
                  await updateBuildAssignment(assignment.id, { status: "completed", completed_at: now });
                  setBuildAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, status: "completed", completed_at: now } : a));
                  if (assignment.started_at) buildDuration = (new Date(now) - new Date(assignment.started_at)) / 3600000;
                }
                // Send completion notifications
                const prod = products.find(p => p.id === bo.product_id);
                const member = assignment ? teamMembers.find(m => m.id === assignment.team_member_id) : null;
                const durationStr = buildDuration ? (buildDuration < 1 ? `${Math.round(buildDuration*60)}m` : `${buildDuration.toFixed(1)}h`) : "";
                // Email the manager
                if (apiKeys.notify_email) {
                  fetch("/api/build-complete-notify", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      productName: prod?.name, quantity: bo.quantity,
                      builderName: member?.name, duration: buildDuration,
                      notifyEmail: apiKeys.notify_email,
                    }),
                  }).catch(e => console.error("Email notification failed:", e));
                }
                // Text the builder
                if (member?.phone && apiKeys.twilio_account_sid) {
                  fetch("/api/send-sms", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      to: member.phone,
                      message: `Build complete! ${bo.quantity}x ${prod?.name || "product"} finished${durationStr ? ` in ${durationStr}` : ""}. Great work!\n— Jackson Audio`,
                      accountSid: apiKeys.twilio_account_sid,
                      authToken: apiKeys.twilio_auth_token,
                      fromNumber: apiKeys.twilio_phone_number,
                    }),
                  }).catch(e => console.error("SMS notification failed:", e));
                }
              } else {
                // Auto-start if pending
                const newStatus = (bo.status === "pending" || bo.status === "assigned") ? "in-progress" : bo.status;
                await updateBuildOrder(bo.id, { status: newStatus, completed_count: newCount });
                setBuildOrders(prev => prev.map(b => b.id === bo.id ? { ...b, status: newStatus, completed_count: newCount } : b));
                // Start assignment timer if first check-off
                if (newCount === 1) {
                  const assignment = buildAssignments.find(a => a.build_order_id === bo.id && !a.started_at);
                  if (assignment) {
                    await updateBuildAssignment(assignment.id, { status: "in-progress", started_at: new Date().toISOString() });
                    setBuildAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, status: "in-progress", started_at: new Date().toISOString() } : a));
                  }
                }
              }
            } catch (e) { console.error("Check off failed:", e); }
          };

          const handleDeleteBuildOrder = async (id) => {
            if (!window.confirm("Delete this build order?")) return;
            try {
              await deleteBuildOrder(id);
              setBuildOrders(prev => prev.filter(b => b.id !== id));
            } catch (e) { console.error("Delete build order failed:", e); }
          };

          const priorityColors = { low:"#86868b", normal:"#0071e3", high:"#ff9500", urgent:"#ff3b30" };
          const statusColors = { pending:"#86868b", assigned:"#0071e3", "in-progress":"#ff9500", completed:"#34c759" };
          const inputStyle = { fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif", fontSize:13, padding:"8px 12px", borderRadius:8, border:"1px solid #d2d2d7", outline:"none", transition:"border 0.15s", width:"100%" };
          const selectStyle = { ...inputStyle, background:"#fff", cursor:"pointer" };
          const fmtHours = (h) => h < 1 ? `${Math.round(h*60)}m` : `${h.toFixed(1)}h`;

          return (
          <div style={{ maxWidth:1000 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:4 }}>Production Floor</h2>
            <p style={{ fontSize:14,color:"#86868b",marginBottom:12 }}>Manage build orders, team assignments, and track production progress.</p>

            {/* ── Mobile Builder App link ── */}
            <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:24,flexWrap:"wrap" }}>
              <span style={{ fontSize:13,color:"#86868b" }}>Mobile Builder App:</span>
              <code style={{ fontSize:12,color:darkMode?"#f8d377":"#5856d6",background:darkMode?"#1c1c1e":"#f0f0f2",padding:"4px 10px",borderRadius:6,fontFamily:"SF Mono,monospace",userSelect:"all" }}>
                {window.location.origin + window.location.pathname + "#build"}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(window.location.origin + window.location.pathname + "#build"); }}
                style={{ padding:"5px 12px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:darkMode?"#3a3a3e":"#e5e5ea",color:darkMode?"#f5f5f7":"#1d1d1f" }}>
                Copy Link
              </button>
              <button onClick={() => window.open(window.location.origin + window.location.pathname + "#build", "_blank", "noopener")}
                style={{ padding:"5px 12px",borderRadius:980,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",border:"none",background:"#f8d377",color:"#0a0a0f" }}>
                Open &#8599;
              </button>
            </div>

            {/* ── Summary cards ── */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:16,marginBottom:28 }}>
              {[
                { label:"Active Builds", value:activeOrders.length, color:activeOrders.length>0?"#ff9500":"#34c759" },
                { label:"Team Members", value:activeMembers.length, color:"#0071e3" },
                { label:"Completed Today", value:completedToday, color:"#34c759" },
                { label:"Completed This Week", value:completedWeek, color:"#5856d6" },
              ].map(card => (
                <div key={card.label} style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                  <div style={{ fontSize:10,color:"#86868b",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>{card.label}</div>
                  <div style={{ fontSize:28,fontWeight:800,color:card.color,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",letterSpacing:"-0.5px" }}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* ── Team Performance Leaderboard ── */}
            {memberStats.length > 0 && (
              <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:20,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:14 }}>Team Performance</div>
                <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid "+(darkMode?"#3a3a3e":"#e5e5ea") }}>
                      {["#","Name","Role","Builds","Units","Avg Time/Build","Avg Time/Unit"].map(h=>(
                        <th key={h} style={{ textAlign:"left",padding:"8px 12px",fontSize:10,fontWeight:700,color:"#86868b",letterSpacing:"0.06em",textTransform:"uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {memberStats.map((m, i) => (
                      <tr key={m.id} style={{ borderBottom:"1px solid "+(darkMode?"#2c2c2e":"#f0f0f2") }}>
                        <td style={{ padding:"10px 12px",fontWeight:800,fontSize:16,color:i===0?"#ffd700":i===1?"#c0c0c0":i===2?"#cd7f32":"#86868b" }}>{i+1}</td>
                        <td style={{ padding:"10px 12px",fontWeight:600,color:darkMode?"#f5f5f7":"#1d1d1f" }}>{m.name}</td>
                        <td style={{ padding:"10px 12px",color:"#86868b",textTransform:"capitalize" }}>{m.role}</td>
                        <td style={{ padding:"10px 12px",fontWeight:600 }}>{m.totalBuilds}</td>
                        <td style={{ padding:"10px 12px",fontWeight:600 }}>{m.totalUnits.toLocaleString()}</td>
                        <td style={{ padding:"10px 12px",fontWeight:600,color:"#0071e3" }}>{m.avgHours > 0 ? fmtHours(m.avgHours) : "—"}</td>
                        <td style={{ padding:"10px 12px",fontWeight:700,color:m.avgPerUnit > 0 ? (i === 0 ? "#34c759" : "#1d1d1f") : "#86868b" }}>
                          {m.avgPerUnit > 0 ? `${m.avgPerUnit.toFixed(1)} min` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Team Members (collapsible) ── */}
            <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:20,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setProdTeamCollapsed(!prodTeamCollapsed)}>
                <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f" }}>Team Members ({activeMembers.length} active)</div>
                <span style={{ fontSize:14,color:"#86868b",transform:prodTeamCollapsed?"rotate(0deg)":"rotate(180deg)",transition:"transform 0.2s" }}>▼</span>
              </div>
              {!prodTeamCollapsed && (
                <div style={{ marginTop:16 }}>
                  <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end" }}>
                    <div style={{ flex:"1 1 180px" }}>
                      <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Name *</label>
                      <input style={inputStyle} placeholder="Full name" value={newTeamMember.name}
                        onChange={e => setNewTeamMember({...newTeamMember, name:e.target.value})}
                        onKeyDown={e => { if (e.key === "Enter") handleCreateTeamMember(); }} />
                    </div>
                    <div style={{ flex:"0 0 140px" }}>
                      <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Role</label>
                      <select style={selectStyle} value={newTeamMember.role} onChange={e => setNewTeamMember({...newTeamMember, role:e.target.value})}>
                        <option value="assembler">Assembler</option>
                        <option value="lead">Lead</option>
                        <option value="manager">Manager</option>
                      </select>
                    </div>
                    <div style={{ flex:"1 1 150px" }}>
                      <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Phone</label>
                      <input style={inputStyle} placeholder="Phone number" value={newTeamMember.phone} onChange={e => setNewTeamMember({...newTeamMember, phone:e.target.value})} />
                    </div>
                    <div style={{ flex:"1 1 180px" }}>
                      <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Email</label>
                      <input style={inputStyle} placeholder="Email address" value={newTeamMember.email} onChange={e => setNewTeamMember({...newTeamMember, email:e.target.value})} />
                    </div>
                    <div style={{ flex:"0 0 100px" }}>
                      <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>PIN</label>
                      <input style={inputStyle} placeholder="4-6 digits" value={newTeamMember.pin_code} maxLength={6}
                        onChange={e => setNewTeamMember({...newTeamMember, pin_code:e.target.value.replace(/\D/g,"")})} />
                    </div>
                    <button className="btn-primary btn-sm" disabled={!newTeamMember.name.trim() || prodBusy} onClick={handleCreateTeamMember}
                      style={{ height:37,whiteSpace:"nowrap" }}>+ Add Member</button>
                  </div>
                  {teamMembers.length > 0 && (
                    <div style={{ borderTop:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",paddingTop:12 }}>
                      {teamMembers.map(member => (
                        <div key={member.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 4px",
                          borderBottom:darkMode?"1px solid #2c2c2e":"1px solid #f2f2f7",opacity:member.active===false?0.5:1 }}>
                          <div style={{ flex:1,fontSize:14,fontWeight:600,color:darkMode?"#f5f5f7":"#1d1d1f" }}>{member.name}</div>
                          <div style={{ fontSize:12,color:"#86868b",textTransform:"capitalize",minWidth:80 }}>{member.role || "—"}</div>
                          <div style={{ fontSize:12,color:"#86868b",minWidth:110 }}>{member.phone || "—"}</div>
                          <div style={{ fontSize:12,color:"#86868b",minWidth:160 }}>{member.email || "—"}</div>
                          <div style={{ minWidth:80 }}>
                            <input style={{ width:70,padding:"4px 6px",borderRadius:5,border:darkMode?"1px solid #3a3a3e":"1px solid #d2d2d7",
                              fontSize:11,background:darkMode?"#2c2c2e":"#f9f9fb",color:darkMode?"#f5f5f7":"#1d1d1f",textAlign:"center" }}
                              placeholder="PIN" maxLength={6} defaultValue={member.pin_code || ""}
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g,"");
                                e.target.value = val;
                              }}
                              onBlur={async (e) => {
                                const val = e.target.value.replace(/\D/g,"");
                                if (val !== (member.pin_code || "")) {
                                  try { await updateTeamMember(member.id, { pin_code: val || null }); } catch {}
                                }
                              }} />
                          </div>
                          <button className="btn-ghost btn-sm" onClick={() => handleToggleActive(member)}
                            style={{ fontSize:11,color:member.active!==false?"#34c759":"#86868b" }}>
                            {member.active !== false ? "Active" : "Inactive"}
                          </button>
                          <button onClick={() => handleDeleteTeamMember(member.id)}
                            style={{ background:"none",border:"none",cursor:"pointer",color:"#c7c7cc",fontSize:14,padding:"2px 6px" }}
                            onMouseOver={e=>e.target.style.color="#ff3b30"} onMouseOut={e=>e.target.style.color="#c7c7cc"}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Create Build Order ── */}
            <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:20,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
              <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:16 }}>Create Build Order</div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Product *</label>
                  <select style={selectStyle} value={newBuildOrder.product_id} onChange={e => setNewBuildOrder({...newBuildOrder, product_id:e.target.value})}>
                    <option value="">Select product…</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Quantity *</label>
                  <input style={inputStyle} type="number" min="1" placeholder="e.g. 50" value={newBuildOrder.quantity} onChange={e => setNewBuildOrder({...newBuildOrder, quantity:e.target.value})} />
                </div>
                <div>
                  <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Priority</label>
                  <select style={selectStyle} value={newBuildOrder.priority} onChange={e => setNewBuildOrder({...newBuildOrder, priority:e.target.value})}>
                    <option value="low">Low</option><option value="normal">Normal</option>
                    <option value="high">High</option><option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Due Date</label>
                  <input style={inputStyle} type="date" value={newBuildOrder.due_date} onChange={e => setNewBuildOrder({...newBuildOrder, due_date:e.target.value})} />
                </div>
                <div>
                  <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Assign To</label>
                  <select style={selectStyle} value={newBuildOrder.team_member_id} onChange={e => setNewBuildOrder({...newBuildOrder, team_member_id:e.target.value})}>
                    <option value="">Unassigned</option>
                    {activeMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:10,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#86868b",display:"block",marginBottom:4 }}>Notes</label>
                <textarea style={{ ...inputStyle, minHeight:60,resize:"vertical" }} placeholder="Optional build notes…" value={newBuildOrder.notes}
                  onChange={e => setNewBuildOrder({...newBuildOrder, notes:e.target.value})} />
              </div>
              <button className="btn-primary" disabled={!newBuildOrder.product_id || !newBuildOrder.quantity || prodBusy} onClick={handleCreateBuildOrder}>
                Create Build Order
              </button>
            </div>

            {/* ── Active Build Orders with Progress ── */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f",marginBottom:14 }}>Active Build Orders ({activeOrders.length})</div>
              {activeOrders.length === 0 ? (
                <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"40px 22px",textAlign:"center",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
                  <div style={{ fontSize:32,marginBottom:8 }}>🏭</div>
                  <div style={{ fontSize:14,color:"#86868b" }}>No active build orders. Create one above to get started.</div>
                </div>
              ) : (
                <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
                  {activeOrders.map(bo => {
                    const prod = products.find(p => p.id === bo.product_id);
                    const assignment = buildAssignments.find(a => a.build_order_id === bo.id && a.status !== "completed");
                    const assignedMember = assignment ? teamMembers.find(m => m.id === assignment.team_member_id) : null;
                    const dueDate = bo.due_date ? new Date(bo.due_date) : null;
                    const isOverdue = dueDate && dueDate < new Date();
                    const done = bo.completed_count || 0;
                    const total = bo.quantity || 1;
                    const pct = Math.round(done / total * 100);
                    // Time elapsed since start
                    const startedAt = assignment?.started_at ? new Date(assignment.started_at) : null;
                    const elapsed = startedAt ? (Date.now() - startedAt) / 3600000 : 0;

                    return (
                      <div key={bo.id} style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,
                        boxShadow:"0 1px 4px rgba(0,0,0,0.06)",border:isOverdue?`2px solid #ff3b30`:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",
                        overflow:"hidden" }}>
                        {/* Progress bar at top */}
                        <div style={{ height:4,background:darkMode?"#2c2c2e":"#e5e5ea" }}>
                          <div style={{ height:"100%",background:pct>=100?"#34c759":"#0071e3",width:`${Math.min(pct,100)}%`,
                            transition:"width 0.3s",borderRadius:"0 2px 2px 0" }} />
                        </div>

                        <div style={{ padding:"18px 22px" }}>
                          {/* Header row */}
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              {prod && <div style={{ width:10,height:10,borderRadius:"50%",background:prod.color||"#0071e3",flexShrink:0 }} />}
                              <div style={{ fontSize:17,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f" }}>{prod?.name || "Unknown"}</div>
                            </div>
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              <span style={{ fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,
                                background:statusColors[bo.status]+"18",color:statusColors[bo.status] }}>{bo.status}</span>
                              <span style={{ fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,
                                background:priorityColors[bo.priority]+"18",color:priorityColors[bo.priority] }}>{bo.priority}</span>
                              {isOverdue && <span style={{ fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,background:"#ff3b3018",color:"#ff3b30" }}>Overdue</span>}
                            </div>
                          </div>

                          {/* Progress section — the main feature */}
                          <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:14,flexWrap:"wrap" }}>
                            <div style={{ flex:1,minWidth:200 }}>
                              <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                                <span style={{ fontSize:24,fontWeight:800,color:darkMode?"#f5f5f7":"#1d1d1f",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif" }}>
                                  {done} <span style={{ fontSize:14,fontWeight:400,color:"#86868b" }}>of</span> {total}
                                </span>
                                <span style={{ fontSize:18,fontWeight:700,color:pct>=100?"#34c759":"#0071e3" }}>{pct}%</span>
                              </div>
                              {/* Visual progress bar */}
                              <div style={{ height:10,background:darkMode?"#2c2c2e":"#e5e5ea",borderRadius:5,overflow:"hidden" }}>
                                <div style={{ height:"100%",background:pct>=100?"#34c759":"#0071e3",width:`${Math.min(pct,100)}%`,
                                  transition:"width 0.3s ease",borderRadius:5 }} />
                              </div>
                            </div>
                            {/* Check off button — big and easy to tap */}
                            <button onClick={() => handleCheckOffUnit(bo)} disabled={prodBusy || done >= total}
                              style={{ width:64,height:64,borderRadius:16,border:"none",cursor:done>=total?"not-allowed":"pointer",
                                background:done>=total?"#34c759":"#0071e3",color:"#fff",fontSize:24,fontWeight:800,
                                fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",
                                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
                                boxShadow:"0 2px 8px rgba(0,0,0,0.15)",transition:"transform 0.1s",opacity:done>=total?0.6:1 }}
                              onMouseDown={e=>{if(done<total)e.currentTarget.style.transform="scale(0.92)"}}
                              onMouseUp={e=>e.currentTarget.style.transform="scale(1)"}
                              onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                              {done>=total ? "✓" : "+1"}
                            </button>
                          </div>

                          {/* Details row */}
                          <div style={{ display:"flex",gap:16,fontSize:12,color:"#86868b",flexWrap:"wrap" }}>
                            {assignedMember && <span>Builder: <strong style={{ color:darkMode?"#f5f5f7":"#1d1d1f" }}>{assignedMember.name}</strong></span>}
                            {dueDate && <span>Due: {dueDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
                            {startedAt && <span>Elapsed: <strong style={{ color:"#ff9500" }}>{fmtHours(elapsed)}</strong></span>}
                            {startedAt && done > 0 && <span>Pace: <strong style={{ color:"#0071e3" }}>{(elapsed/done*60).toFixed(1)} min/unit</strong></span>}
                            {bo.notes && <span style={{ fontStyle:"italic" }}>{bo.notes}</span>}
                          </div>

                          {/* Actions */}
                          <div style={{ display:"flex",gap:8,borderTop:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",paddingTop:12,marginTop:12 }}>
                            {(bo.status === "pending" || bo.status === "assigned") && (
                              <button className="btn-primary btn-sm" onClick={() => handleStartBuild(bo)} disabled={prodBusy}>Start Build</button>
                            )}
                            <button className="btn-ghost btn-sm" onClick={() => handleDeleteBuildOrder(bo.id)}
                              style={{ color:"#ff3b30",marginLeft:"auto" }}>Delete</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Completed Orders (collapsible) ── */}
            <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:14,padding:"20px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:20,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setProdCompletedCollapsed(!prodCompletedCollapsed)}>
                <div style={{ fontSize:16,fontWeight:700,color:darkMode?"#f5f5f7":"#1d1d1f" }}>Completed Orders ({completedOrders.length})</div>
                <span style={{ fontSize:14,color:"#86868b",transform:prodCompletedCollapsed?"rotate(0deg)":"rotate(180deg)",transition:"transform 0.2s" }}>▼</span>
              </div>
              {!prodCompletedCollapsed && (
                <div style={{ marginTop:16 }}>
                  <div style={{ display:"flex",gap:16,marginBottom:16 }}>
                    <div style={{ fontSize:13,color:"#86868b" }}>Today: <strong style={{ color:"#34c759" }}>{completedToday}</strong></div>
                    <div style={{ fontSize:13,color:"#86868b" }}>This week: <strong style={{ color:"#5856d6" }}>{completedWeek}</strong></div>
                    <div style={{ fontSize:13,color:"#86868b" }}>All time: <strong>{completedOrders.length}</strong></div>
                  </div>
                  {completedOrders.length === 0 ? (
                    <div style={{ fontSize:13,color:"#aeaeb2",textAlign:"center",padding:20 }}>No completed orders yet.</div>
                  ) : (
                    <div>
                      {completedOrders.slice(0, 50).map(bo => {
                        const prod = products.find(p => p.id === bo.product_id);
                        const assignment = buildAssignments.find(a => a.build_order_id === bo.id);
                        const member = assignment ? teamMembers.find(m => m.id === assignment.team_member_id) : null;
                        const duration = assignment?.started_at && assignment?.completed_at
                          ? (new Date(assignment.completed_at) - new Date(assignment.started_at)) / 3600000 : null;
                        return (
                          <div key={bo.id} style={{ display:"flex",alignItems:"center",gap:12,padding:"10px 4px",
                            borderBottom:darkMode?"1px solid #2c2c2e":"1px solid #f2f2f7" }}>
                            {prod && <div style={{ width:8,height:8,borderRadius:"50%",background:prod.color||"#0071e3",flexShrink:0 }} />}
                            <div style={{ flex:1,fontSize:13,fontWeight:600,color:darkMode?"#f5f5f7":"#1d1d1f" }}>{prod?.name || "—"}</div>
                            <div style={{ fontSize:13,fontWeight:700,color:"#0071e3",minWidth:50 }}>×{bo.quantity}</div>
                            <div style={{ fontSize:12,color:"#86868b",minWidth:100 }}>{member?.name || "—"}</div>
                            {duration !== null && <div style={{ fontSize:12,fontWeight:600,color:"#34c759",minWidth:60 }}>{fmtHours(duration)}</div>}
                            {duration !== null && bo.quantity > 0 && (
                              <div style={{ fontSize:11,color:"#86868b",minWidth:80 }}>{(duration/bo.quantity*60).toFixed(1)} min/unit</div>
                            )}
                            <div style={{ fontSize:11,color:"#aeaeb2",minWidth:80 }}>{bo.updated_at ? new Date(bo.updated_at).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—"}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ══════════════════════════════════════
            API KEYS / SETTINGS
        ══════════════════════════════════════ */}
        {activeView === "settings" && (
          <div style={{ maxWidth:760 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontSize:21,fontWeight:800,marginBottom:6,color:"#1d1d1f" }}>Settings</h2>
            <p style={{ color:"#86868b",fontSize:13,marginBottom:24 }}>
              Keys are stored in the shared team database — one set for everyone.
            </p>

            {/* ── Company Info (Ship-To for POs) */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("company") ? s.delete("company") : s.add("company"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("company") ? "▶" : "▼"}</span>
                  Company Info — Ship-To Address
                </div>
              </div>
              {!collapsedSettings.has("company") && <div style={{ padding:"16px 20px" }}>
                <label style={{ display:"block",fontSize:13,fontWeight:600,color:"#3a3f51",marginBottom:6 }}>Company Name</label>
                <input style={{ width:"100%",padding:"8px 12px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:14,marginBottom:14,boxSizing:"border-box" }}
                  value={apiKeys.company_name ?? ""} onChange={e => setApiKeys(k => ({ ...k, company_name: e.target.value }))} placeholder="Jackson Audio" />
                <label style={{ display:"block",fontSize:13,fontWeight:600,color:"#3a3f51",marginBottom:6 }}>Company Address</label>
                <textarea style={{ width:"100%",padding:"8px 12px",border:"1px solid #d2d2d7",borderRadius:8,fontSize:14,minHeight:80,resize:"vertical",boxSizing:"border-box",fontFamily:"inherit" }}
                  value={apiKeys.company_address ?? ""} onChange={e => setApiKeys(k => ({ ...k, company_address: e.target.value }))} placeholder="123 Main St&#10;City, ST 12345&#10;USA" />
                <p style={{ fontSize:12,color:"#86868b",marginTop:8 }}>This address appears as the "Ship To" on purchase orders.</p>
                {sectionSaveBtn("company", "Company Info")}
              </div>}
            </div>

            {/* ── Distributors — names + emails */}
            {(() => {
              // Collect all unique distributor keys from pricing data
              const distMap = {};
              for (const p of parts) {
                if (!p.pricing || typeof p.pricing !== "object") continue;
                for (const [key, val] of Object.entries(p.pricing)) {
                  if (key.startsWith("_")) continue;
                  if (!distMap[key]) distMap[key] = val.displayName || key;
                }
              }
              // Also include hardcoded SUPPLIERS
              for (const s of SUPPLIERS) { if (!distMap[s.id]) distMap[s.id] = s.name; }
              const distKeys = Object.keys(distMap).sort((a, b) => distMap[a].localeCompare(distMap[b]));
              let nameOverrides = {};
              try { nameOverrides = JSON.parse(apiKeys.distributor_names || "{}"); } catch {}
              let emails = {};
              try { emails = JSON.parse(apiKeys.supplier_emails || "{}"); } catch {}
              let orderModes = {};
              try { orderModes = JSON.parse(apiKeys.supplier_order_modes || "{}"); } catch {}
              let preferredDists = [];
              try { preferredDists = JSON.parse(apiKeys.preferred_distributors || '["mouser"]'); } catch { preferredDists = ["mouser"]; }
              return (
                <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
                  <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                    onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("distributors") ? s.delete("distributors") : s.add("distributors"); return s; })}>
                    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                      <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("distributors") ? "▶" : "▼"}</span>
                      Distributors ({distKeys.length})
                    </div>
                  </div>
                  {!collapsedSettings.has("distributors") && <div style={{ padding:"12px 20px" }}>
                    <div style={{ display:"flex",gap:8,marginBottom:6,fontSize:10,fontWeight:700,color:"#86868b",textTransform:"uppercase",letterSpacing:"0.06em" }}>
                      <div style={{ width:50,textAlign:"center" }}>Pref</div>
                      <div style={{ width:120 }}>Raw Key</div>
                      <div style={{ flex:1 }}>Display Name</div>
                      <div style={{ flex:1 }}>Sales Email</div>
                      <div style={{ width:90 }}>Order Mode</div>
                    </div>
                    <div style={{ maxHeight:400,overflowY:"auto" }}>
                      {distKeys.map(key => {
                        const curMode = orderModes[key] || "manual";
                        const mc = ORDER_MODE_CONFIG[curMode] || ORDER_MODE_CONFIG.manual;
                        return (
                        <div key={key} style={{ display:"flex",gap:8,alignItems:"center",paddingTop:3,paddingBottom:3,borderBottom:"1px solid #f0f0f2" }}>
                          <div style={{ width:50,textAlign:"center" }}>
                            <input type="checkbox" checked={preferredDists.includes(key)}
                              onChange={() => {
                                const updated = preferredDists.includes(key) ? preferredDists.filter(d => d !== key) : [...preferredDists, key];
                                setApiKeys(k => ({ ...k, preferred_distributors: JSON.stringify(updated) }));
                              }}
                              style={{ width:16,height:16,cursor:"pointer",accentColor:"#34c759" }} />
                          </div>
                          <div style={{ width:120,fontSize:11,color:"#86868b",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }} title={key}>{key}</div>
                          <input style={{ flex:1,padding:"4px 8px",border:"1px solid #d2d2d7",borderRadius:5,fontSize:12,boxSizing:"border-box" }}
                            value={nameOverrides[key] ?? distMap[key] ?? ""}
                            onChange={e => {
                              const updated = { ...nameOverrides, [key]: e.target.value };
                              setApiKeys(k => ({ ...k, distributor_names: JSON.stringify(updated) }));
                            }}
                            placeholder={distMap[key]} />
                          <input type="email" style={{ flex:1,padding:"4px 8px",border:"1px solid #d2d2d7",borderRadius:5,fontSize:12,boxSizing:"border-box" }}
                            value={emails[key] || ""}
                            onChange={e => {
                              const updated = { ...emails, [key]: e.target.value };
                              setApiKeys(k => ({ ...k, supplier_emails: JSON.stringify(updated) }));
                            }}
                            placeholder={`orders@${key}.com`} />
                          <select style={{ width:90,padding:"4px 6px",border:"1px solid #d2d2d7",borderRadius:5,fontSize:11,fontFamily:"inherit",boxSizing:"border-box",
                              color:mc.color,fontWeight:600,background:mc.bg,cursor:"pointer" }}
                            value={curMode}
                            onChange={e => {
                              const updated = { ...orderModes, [key]: e.target.value };
                              setApiKeys(k => ({ ...k, supplier_order_modes: JSON.stringify(updated) }));
                            }}>
                            <option value="manual">Manual</option>
                            <option value="api">API</option>
                            <option value="rep">Rep</option>
                          </select>
                        </div>
                      );})}
                    </div>
                    <p style={{ fontSize:11,color:"#86868b",marginTop:8 }}>
                      Order Mode: <strong style={{ color:"#34c759" }}>API</strong> = direct API ordering &middot;
                      <strong style={{ color:"#0071e3" }}> Rep</strong> = email PO to sales rep &middot;
                      <strong style={{ color:"#86868b" }}> Manual</strong> = order on supplier website
                    </p>
                    {sectionSaveBtn("distributors", "Distributors")}
                  </div>}
                </div>
              );
            })()}

            {/* ── Nexar / Octopart — PRIMARY */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("nexar") ? s.delete("nexar") : s.add("nexar"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("nexar") ? "▶" : "▼"}</span>
                  Nexar / Octopart — Primary
                </div>
                {nexarToken && <span style={{ fontSize:11,fontWeight:600,color:"#34c759" }}>Connected</span>}
              </div>
              {!collapsedSettings.has("nexar") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  One API covers Mouser, Digi-Key, Arrow, LCSC, Allied + 900 more. Free: 1,000 parts/month.
                  <a href="https://nexar.com" target="_blank" rel="noopener noreferrer"
                    style={{ marginLeft:6,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>nexar.com →</a>
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Client ID</div><div className="key-hint">From your Nexar app</div></div>
                  <input type="password" placeholder="nexar-client-id" value={apiKeys.nexar_client_id}
                    onChange={(e)=>setApiKeys((k)=>({...k,nexar_client_id:e.target.value}))}
                    style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Client Secret</div><div className="key-hint">From your Nexar app</div></div>
                  <input type="password" placeholder="nexar-client-secret" value={apiKeys.nexar_client_secret}
                    onChange={(e)=>setApiKeys((k)=>({...k,nexar_client_secret:e.target.value}))}
                    style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
                </div>
                {sectionSaveBtn("nexar", "Nexar Keys")}
              </div>}
            </div>

            {/* ── Mouser Direct */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("mouser") ? s.delete("mouser") : s.add("mouser"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("mouser") ? "▶" : "▼"}</span>
                  Mouser Direct
                </div>
              </div>
              {!collapsedSettings.has("mouser") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  Deeper Mouser-specific pricing + Cart/Order API.
                  <a href="https://www.mouser.com/api-hub/" target="_blank" rel="noopener noreferrer"
                    style={{ marginLeft:6,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>mouser.com/api-hub →</a>
                </div>
                <div className="key-input-row">
                  <div className="key-label">Search API Key</div>
                  <input type="password" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={apiKeys.mouser_api_key}
                    onChange={(e)=>setApiKeys((k)=>({...k,mouser_api_key:e.target.value}))}
                    style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Order API Key</div><div className="key-hint">Separate key for Cart + Ordering</div></div>
                  <input type="password" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={apiKeys.mouser_order_api_key}
                    onChange={(e)=>setApiKeys((k)=>({...k,mouser_order_api_key:e.target.value}))}
                    style={{ padding:"8px 12px",borderRadius:6,width:"100%" }} />
                </div>
                {sectionSaveBtn("mouser", "Mouser Keys")}
              </div>}
            </div>

            {/* ── DigiKey Direct */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("digikey") ? s.delete("digikey") : s.add("digikey"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("digikey") ? "▶" : "▼"}</span>
                  Digi-Key Direct
                </div>
              </div>
              {!collapsedSettings.has("digikey") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  OAuth2 client credentials.
                  <a href="https://developer.digikey.com" target="_blank" rel="noopener noreferrer"
                    style={{ marginLeft:6,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>developer.digikey.com →</a>
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
                {sectionSaveBtn("digikey", "DigiKey Keys")}
              </div>}
            </div>

            {/* ── Arrow Direct */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("arrow") ? s.delete("arrow") : s.add("arrow"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("arrow") ? "▶" : "▼"}</span>
                  Arrow Direct
                </div>
              </div>
              {!collapsedSettings.has("arrow") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  Requires login + API key.
                  <a href="https://developers.arrow.com" target="_blank" rel="noopener noreferrer"
                    style={{ marginLeft:6,color:"#0071e3",textDecoration:"none",fontWeight:500 }}>developers.arrow.com →</a>
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
                {sectionSaveBtn("arrow", "Arrow Keys")}
              </div>}
            </div>

            {/* ── Shopify Integration (Multi-Store) */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#96bf48",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("shopify") ? s.delete("shopify") : s.add("shopify"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#fff",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11 }}>{collapsedSettings.has("shopify") ? "▶" : "▼"}</span>
                  Shopify Stores
                </div>
                {(() => { const s = getShopifyStores(); return s.length > 0 ? <span style={{ fontSize:11,fontWeight:600,color:"#fff" }}>{s.length} store{s.length !== 1 ? "s" : ""}</span> : null; })()}
              </div>
              {!collapsedSettings.has("shopify") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  Connect one or more Shopify stores. Create an app in the Dev Dashboard with <strong>read_orders</strong> and <strong>read_products</strong> scopes, then copy the Client ID and Secret from Settings.
                </div>
                {(() => {
                  const stores = getShopifyStores();
                  const updateStores = (updated) => setApiKeys(k => ({ ...k, shopify_stores_json: JSON.stringify(updated) }));
                  return (
                    <>
                      {stores.map((store, idx) => (
                        <div key={idx} style={{ background:"#f9faf5",border:"1px solid #96bf4844",borderRadius:8,padding:"12px 16px",marginBottom:10 }}>
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                            <div style={{ fontWeight:700,fontSize:13,color:"#3a3f51" }}>{store.name || `Store ${idx + 1}`}</div>
                            <button className="btn-ghost" style={{ fontSize:10,color:"#ff3b30" }}
                              onClick={() => { const u = stores.filter((_, i) => i !== idx); updateStores(u); }}>
                              Remove
                            </button>
                          </div>
                          <div className="key-input-row" style={{ paddingTop:4,paddingBottom:4 }}>
                            <div className="key-label" style={{ minWidth:90 }}>Name</div>
                            <input type="text" placeholder="Jackson Audio" value={store.name || ""}
                              onChange={(e) => { const u = [...stores]; u[idx] = { ...u[idx], name: e.target.value }; updateStores(u); }}
                              style={{ padding:"6px 10px",borderRadius:5,width:"100%",fontSize:12 }} />
                          </div>
                          <div className="key-input-row" style={{ paddingTop:4,paddingBottom:4 }}>
                            <div className="key-label" style={{ minWidth:90 }}>Domain</div>
                            <input type="text" placeholder="your-store.myshopify.com" value={store.domain || ""}
                              onChange={(e) => { const u = [...stores]; u[idx] = { ...u[idx], domain: e.target.value }; updateStores(u); }}
                              style={{ padding:"6px 10px",borderRadius:5,width:"100%",fontSize:12 }} />
                          </div>
                          <div className="key-input-row" style={{ paddingTop:4,paddingBottom:4 }}>
                            <div className="key-label" style={{ minWidth:90 }}>Client ID</div>
                            <input type="text" placeholder="From Dev Dashboard → Settings" value={store.clientId || ""}
                              onChange={(e) => { const u = [...stores]; u[idx] = { ...u[idx], clientId: e.target.value }; updateStores(u); }}
                              style={{ padding:"6px 10px",borderRadius:5,width:"100%",fontSize:12 }} />
                          </div>
                          <div className="key-input-row" style={{ paddingTop:4,paddingBottom:4 }}>
                            <div className="key-label" style={{ minWidth:90 }}>Secret</div>
                            <input type="password" placeholder="From Dev Dashboard → Settings" value={store.clientSecret || ""}
                              onChange={(e) => { const u = [...stores]; u[idx] = { ...u[idx], clientSecret: e.target.value }; updateStores(u); }}
                              style={{ padding:"6px 10px",borderRadius:5,width:"100%",fontSize:12 }} />
                          </div>
                        </div>
                      ))}
                      <button className="btn-ghost" style={{ fontSize:12,marginTop:4 }}
                        onClick={() => updateStores([...stores, { name: "", domain: "", clientId: "", clientSecret: "" }])}>
                        + Add Shopify Store
                      </button>
                    </>
                  );
                })()}
                {sectionSaveBtn("shopify", "Shopify Stores")}
              </div>}
            </div>

            {/* ── Shipping Costs */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("shipping") ? s.delete("shipping") : s.add("shipping"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("shipping") ? "▶" : "▼"}</span>
                  Shipping Costs
                </div>
              </div>
              {!collapsedSettings.has("shipping") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  Used by the simulator to compare consolidation strategies. Adjust to match your actual rates.
                </div>
                <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                  {SUPPLIERS.map((s) => (
                    <div key={s.id} style={{ display:"flex",alignItems:"center",gap:6 }}>
                      <span style={{ fontSize:12,color:"#3a3f51",fontWeight:600,minWidth:70 }}>{s.name}</span>
                      <span style={{ fontSize:11,color:"#aeaeb2" }}>$</span>
                      <input type="number" step="0.01" min="0" value={s.shipping}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)||0;
                          SUPPLIERS.find(x=>x.id===s.id).shipping = v;
                          // Also persist to apiKeys so it saves to DB
                          const shipObj = {};
                          SUPPLIERS.forEach(sup => { shipObj[sup.id] = sup.shipping; });
                          setApiKeys(k => ({ ...k, shipping_json: JSON.stringify(shipObj) }));
                        }}
                        style={{ width:60,padding:"4px 6px",borderRadius:4,fontSize:12 }} />
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:11,color:"#aeaeb2",marginTop:8 }}>
                  Default for unlisted distributors: {"$"}{DEFAULT_SHIPPING.toFixed(2)}
                </div>
                {sectionSaveBtn("shipping", "Shipping Costs")}
              </div>}
            </div>

            {/* ── Import Tariff Rates */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("tariffs") ? s.delete("tariffs") : s.add("tariffs"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("tariffs") ? "▶" : "▼"}</span>
                  Import Tariff Rates
                </div>
              </div>
              {!collapsedSettings.has("tariffs") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
                  Applied in the simulator when parts originate from non-US countries. Rates are % of goods value.
                </div>
              <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                {(() => {
                  let tariffs;
                  try { tariffs = { ...DEFAULT_TARIFFS, ...JSON.parse(apiKeys.tariffs_json || "{}") }; } catch { tariffs = { ...DEFAULT_TARIFFS }; }
                  const countries = Object.keys(tariffs).sort();
                  return countries.map(cc => (
                    <div key={cc} style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <span style={{ fontSize:12,color:"#1d1d1f",fontWeight:700,minWidth:28 }}>{cc}</span>
                      <input type="number" step="1" min="0" max="500"
                        value={tariffs[cc]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          const updated = { ...tariffs, [cc]: v };
                          setApiKeys(k => ({ ...k, tariffs_json: JSON.stringify(updated) }));
                        }}
                        style={{ width:52,padding:"4px 6px",borderRadius:4,fontSize:12,textAlign:"right" }} />
                      <span style={{ fontSize:11,color:"#aeaeb2" }}>%</span>
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
                <span style={{ fontSize:10,color:"#aeaeb2" }}>Rates saved with your API keys</span>
              </div>
              {sectionSaveBtn("tariffs", "Tariff Rates")}
              </div>}
            </div>

            {/* ── Notifications & Email */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("email") ? s.delete("email") : s.add("email"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("email") ? "▶" : "▼"}</span>
                  Email Notifications & PO Drafts
                </div>
              </div>
              {!collapsedSettings.has("email") && <div style={{ padding:"16px 20px" }}>
                <div style={{ fontSize:12,color:"#6e6e73",marginBottom:12 }}>
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
                <p style={{ fontSize:11,color:"#86868b",marginTop:8 }}>Distributor emails are managed in the Distributors section above.</p>
                {apiKeys.notify_email && lowStockParts.length > 0 && (
                  <div style={{ marginTop:14 }}>
                    <button className="btn-ghost" onClick={() => {
                      const body = buildLowStockEmailBody(lowStockParts);
                      if (body) window.location.href = `mailto:${apiKeys.notify_email}?subject=${encodeURIComponent("Low Stock Alert — Jackson Audio BOM")}&body=${encodeURIComponent(body)}`;
                    }}>
                      Preview Low-Stock Alert Email
                    </button>
                    <span style={{ fontSize:11,color:"#86868b",marginLeft:8 }}>{lowStockParts.length} parts below reorder level</span>
                  </div>
                )}
                {sectionSaveBtn("notifications", "Email Settings")}
              </div>}
            </div>


            {/* ── AI / Anthropic API */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("ai") ? s.delete("ai") : s.add("ai"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("ai") ? "▶" : "▼"}</span>
                  AI — Invoice Parsing (Claude)
                </div>
              </div>
              {!collapsedSettings.has("ai") && <div style={{ padding:"16px 20px" }}>
                <p style={{ fontSize:12,color:"#86868b",marginBottom:14 }}>
                  Upload PDF invoices from suppliers — Claude AI extracts part numbers, quantities, and costs automatically.
                  Get your API key from <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" style={{ color:"#0071e3" }}>console.anthropic.com</a>
                </p>
                <div className="key-input-row">
                  <div><div className="key-label">Anthropic API Key</div><div className="key-hint">sk-ant-api03-…</div></div>
                  <input type="password" value={apiKeys.anthropic_api_key||""} onChange={e=>setApiKeys(k=>({...k,anthropic_api_key:e.target.value}))} placeholder="sk-ant-api03-..." style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                {sectionSaveBtn("ai", "AI Settings")}
              </div>}
            </div>

            {/* ── SMS / Twilio */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("sms") ? s.delete("sms") : s.add("sms"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("sms") ? "▶" : "▼"}</span>
                  SMS — Builder Notifications (Twilio)
                </div>
              </div>
              {!collapsedSettings.has("sms") && <div style={{ padding:"16px 20px" }}>
                <p style={{ fontSize:12,color:"#86868b",marginBottom:14 }}>
                  Text builders when they get assigned a build order. Sign up at <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" style={{ color:"#0071e3" }}>twilio.com</a> — free trial includes $15 credit.
                </p>
                <div className="key-input-row">
                  <div><div className="key-label">Account SID</div><div className="key-hint">AC…</div></div>
                  <input type="text" value={apiKeys.twilio_account_sid||""} onChange={e=>setApiKeys(k=>({...k,twilio_account_sid:e.target.value}))} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Auth Token</div><div className="key-hint">Secret token</div></div>
                  <input type="password" value={apiKeys.twilio_auth_token||""} onChange={e=>setApiKeys(k=>({...k,twilio_auth_token:e.target.value}))} placeholder="••••••••" style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Twilio Phone Number</div><div className="key-hint">+1XXXXXXXXXX</div></div>
                  <input type="text" value={apiKeys.twilio_phone_number||""} onChange={e=>setApiKeys(k=>({...k,twilio_phone_number:e.target.value}))} placeholder="+15551234567" style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                {sectionSaveBtn("sms", "SMS Settings")}
              </div>}
            </div>

            {/* ── Facebook Ads */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginBottom:16,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("facebook") ? s.delete("facebook") : s.add("facebook"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("facebook") ? "▶" : "▼"}</span>
                  Facebook / Meta — Ad Spend Tracking
                </div>
              </div>
              {!collapsedSettings.has("facebook") && <div style={{ padding:"16px 20px" }}>
                <p style={{ fontSize:12,color:"#86868b",marginBottom:14 }}>
                  Pull actual ad spend per campaign from Facebook. Get your access token from the
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color:"#0071e3" }}> Graph API Explorer</a>.
                  Your Ad Account ID is in Facebook Ads Manager → Settings (format: act_XXXXXXXXX).
                </p>
                <div style={{ fontWeight:700,fontSize:13,color:"#0071e3",marginBottom:10,marginTop:16 }}>Jackson Audio</div>
                <div className="key-input-row">
                  <div><div className="key-label">Access Token</div><div className="key-hint">Jackson Audio Facebook token</div></div>
                  <input type="password" value={apiKeys.fb_ja_access_token||""} onChange={e=>setApiKeys(k=>({...k,fb_ja_access_token:e.target.value}))} placeholder="EAAxxxxxxx..." style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Ad Account ID</div><div className="key-hint">act_XXXXXXXXX</div></div>
                  <input type="text" value={apiKeys.fb_ja_ad_account_id||""} onChange={e=>setApiKeys(k=>({...k,fb_ja_ad_account_id:e.target.value}))} placeholder="act_123456789" style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                <div style={{ fontWeight:700,fontSize:13,color:"#5856d6",marginBottom:10,marginTop:20 }}>Fulltone USA</div>
                <div className="key-input-row">
                  <div><div className="key-label">Access Token</div><div className="key-hint">Fulltone USA Facebook token</div></div>
                  <input type="password" value={apiKeys.fb_ft_access_token||""} onChange={e=>setApiKeys(k=>({...k,fb_ft_access_token:e.target.value}))} placeholder="EAAxxxxxxx..." style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                <div className="key-input-row">
                  <div><div className="key-label">Ad Account ID</div><div className="key-hint">act_XXXXXXXXX</div></div>
                  <input type="text" value={apiKeys.fb_ft_ad_account_id||""} onChange={e=>setApiKeys(k=>({...k,fb_ft_ad_account_id:e.target.value}))} placeholder="act_123456789" style={{ padding:"8px 12px",borderRadius:8 }} />
                </div>
                {sectionSaveBtn("facebook", "Facebook Settings")}
              </div>}
            </div>

            {/* Key acquisition guide */}
            <div style={{ background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.06)",marginTop:24,overflow:"hidden" }}>
              <div style={{ background:"#b8bdd1",padding:"14px 20px",cursor:"pointer" }}
                onClick={() => setCollapsedSettings(prev => { const s = new Set(prev); s.has("guide") ? s.delete("guide") : s.add("guide"); return s; })}>
                <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",letterSpacing:"0.04em",textTransform:"uppercase" }}>
                  <span style={{ display:"inline-block",width:16,fontSize:11,color:"#3a3f51" }}>{collapsedSettings.has("guide") ? "▶" : "▼"}</span>
                  How to Get Your API Keys
                </div>
              </div>
              {!collapsedSettings.has("guide") && <div style={{ padding:"16px 20px" }}>
                {[
                  { name:"Nexar (covers everything)", steps:["Go to nexar.com and create a free account","Click 'Create App' in the API portal","Copy your Client ID and Client Secret here","Free tier: 1,000 matched parts/month"] },
                  { name:"Mouser", steps:["Go to mouser.com and log into your account","Navigate to My Account → API","Select 'Search API' and generate a key","Copy the key here"] },
                  { name:"Digi-Key", steps:["Go to developer.digikey.com","Create an Organization and App","Select 'Product Information' API","Copy Client ID and Secret here"] },
                  { name:"Arrow", steps:["Email api@arrow.com or contact your sales rep","They will issue you a login + API key","Enter both here"] },
                ].map((src)=>(
                  <div key={src.name} style={{ marginBottom:16,paddingLeft:12,borderLeft:"2px solid #b8bdd1" }}>
                    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif",fontWeight:700,fontSize:13,color:"#3a3f51",marginBottom:6 }}>{src.name}</div>
                    <ol style={{ paddingLeft:16 }}>
                      {src.steps.map((step,i)=>(
                        <li key={i} style={{ fontSize:12,color:"#86868b",marginBottom:3 }}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════
            ADMIN — Profit Analysis
        ══════════════════════════════════════ */}
        {activeView === "admin" && (() => {
          const laborRate = parseFloat(apiKeys.labor_rate_hourly) || 25;
          const adSpendPct = parseFloat(apiKeys.ad_spend_pct) || 0;
          const shippingPerUnit = parseFloat(apiKeys.shipping_cost_per_unit) || 0;
          const hasShopifyPrices = shopifySalesPrices?.products?.length > 0;
          // Build a lookup from shopify product id to price data
          const shopifyPriceLookup = {};
          if (hasShopifyPrices) {
            for (const sp of shopifySalesPrices.products) {
              shopifyPriceLookup[sp.shopifyProductId] = sp;
            }
          }
          const rows = productCosts.map((prod) => {
            const salesPrice = prod.salesPrice ? parseFloat(prod.salesPrice) : null;
            const bomCost = prod.total || 0;
            const buildMins = prod.buildMinutes ? parseFloat(prod.buildMinutes) : 0;
            const laborCost = (buildMins / 60) * laborRate;
            const totalCost = bomCost + laborCost + shippingPerUnit;
            const adCostMSRP = salesPrice != null ? salesPrice * (adSpendPct / 100) : 0;
            const allInCostMSRP = totalCost + adCostMSRP;
            const profit = salesPrice != null ? salesPrice - allInCostMSRP : null;
            const marginPct = salesPrice && salesPrice > 0 ? (profit / salesPrice) * 100 : null;
            const markupPct = allInCostMSRP > 0 && profit != null ? (profit / allInCostMSRP) * 100 : null;
            // Shopify actual prices
            const spData = prod.shopifyProductId ? shopifyPriceLookup[prod.shopifyProductId] : null;
            // Also try matching by product name if no shopifyProductId match
            const spByName = !spData && hasShopifyPrices ? shopifySalesPrices.products.find(sp =>
              sp.title && prod.name && sp.title.toLowerCase().includes(prod.name.toLowerCase())
            ) : null;
            const sp = spData || spByName || null;
            const avgActual = sp ? sp.avgPrice : null;
            const minActual = sp ? sp.minPrice : null;
            const maxActual = sp ? sp.maxPrice : null;
            const adCostAvg = avgActual != null ? avgActual * (adSpendPct / 100) : 0;
            const profitAvg = avgActual != null ? avgActual - totalCost - adCostAvg : null;
            const marginAvg = avgActual && avgActual > 0 ? (profitAvg / avgActual) * 100 : null;
            const adCostMin = minActual != null ? minActual * (adSpendPct / 100) : 0;
            const profitMin = minActual != null ? minActual - totalCost - adCostMin : null;
            const marginMin = minActual && minActual > 0 ? (profitMin / minActual) * 100 : null;
            const adCostMax = maxActual != null ? maxActual * (adSpendPct / 100) : 0;
            const profitMax = maxActual != null ? maxActual - totalCost - adCostMax : null;
            const marginMax = maxActual && maxActual > 0 ? (profitMax / maxActual) * 100 : null;
            const unitsSold = sp ? sp.unitsSold : null;
            const totalRevenue = sp ? sp.totalRevenue : null;
            return { ...prod, salesPrice, bomCost, buildMins, laborCost, totalCost, adCostMSRP, allInCostMSRP, profit, marginPct, markupPct,
              avgActual, minActual, maxActual, profitAvg, marginAvg, profitMin, marginMin, profitMax, marginMax, unitsSold, totalRevenue };
          });
          const withMargin = rows.filter(r => r.marginPct != null);
          const avgMargin = withMargin.length > 0 ? withMargin.reduce((s,r) => s + r.marginPct, 0) / withMargin.length : 0;
          const highest = withMargin.length > 0 ? withMargin.reduce((a,b) => a.marginPct > b.marginPct ? a : b) : null;
          const lowest = withMargin.length > 0 ? withMargin.reduce((a,b) => a.marginPct < b.marginPct ? a : b) : null;
          const marginColor = (m) => m == null ? "#86868b" : m < 20 ? "#ff3b30" : m < 40 ? "#ff9500" : "#34c759";
          // Shopify channel margin summaries
          const withAvgMargin = rows.filter(r => r.marginAvg != null);
          const blendedMargin = withAvgMargin.length > 0 ? withAvgMargin.reduce((s,r) => s + r.marginAvg, 0) / withAvgMargin.length : null;
          const withMinMargin = rows.filter(r => r.marginMin != null);
          const dealerMargin = withMinMargin.length > 0 ? withMinMargin.reduce((s,r) => s + r.marginMin, 0) / withMinMargin.length : null;
          const withMaxMargin = rows.filter(r => r.marginMax != null);
          const directMargin = withMaxMargin.length > 0 ? withMaxMargin.reduce((s,r) => s + r.marginMax, 0) / withMaxMargin.length : null;
          const thStyle = { padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#86868b",textTransform:"uppercase",letterSpacing:"0.05em",
            borderBottom:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",background:darkMode?"#2c2c2e":"#fafafa",whiteSpace:"nowrap" };
          const tdStyle = { padding:"10px 12px",fontSize:13,borderBottom:darkMode?"1px solid #2c2c2e":"1px solid #f0f0f2" };
          const cardStyle = { background:darkMode?"#1c1c1e":"#fff",borderRadius:12,padding:"16px 20px",flex:1,
            border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea" };
          const thGroupBorder = { borderLeft:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea" };
          const tdGroupBorder = { borderLeft:darkMode?"2px solid #2c2c2e":"2px solid #f0f0f2" };
          // Debounced sales price save
          const saveSalesPrice = (() => {
            const timers = {};
            return (productId, value) => {
              clearTimeout(timers[productId]);
              timers[productId] = setTimeout(async () => {
                try {
                  await supabase.from("products").update({ sales_price: value }).eq("id", productId);
                } catch (e) { console.error("Failed to save sales price:", e); }
              }, 500);
            };
          })();
          return (
          <div style={{ maxWidth:1800 }}>
            <h2 style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:4 }}>Profit Analysis</h2>
            <p style={{ fontSize:14,color:"#86868b",marginBottom:24 }}>Margins, markup, and profitability across all products{hasShopifyPrices ? " — with Shopify actual pricing data" : ""}.</p>

            {/* Summary Cards */}
            <div style={{ display:"flex",gap:16,marginBottom:24,flexWrap:"wrap" }}>
              <div style={cardStyle}>
                <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Total Products</div>
                <div style={{ fontSize:28,fontWeight:700,color:"#0071e3" }}>{rows.length}</div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Avg MSRP Margin</div>
                <div style={{ fontSize:28,fontWeight:700,color:marginColor(avgMargin) }}>{avgMargin.toFixed(1)}%</div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Highest Margin</div>
                <div style={{ fontSize:16,fontWeight:700,color:"#34c759" }}>{highest ? `${highest.name} (${highest.marginPct.toFixed(1)}%)` : "—"}</div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Lowest Margin</div>
                <div style={{ fontSize:16,fontWeight:700,color:"#ff3b30" }}>{lowest ? `${lowest.name} (${lowest.marginPct.toFixed(1)}%)` : "—"}</div>
              </div>
            </div>

            {/* Channel Margin Summary — only when Shopify data loaded */}
            {hasShopifyPrices && (
              <div style={{ display:"flex",gap:16,marginBottom:24,flexWrap:"wrap" }}>
                <div style={{ ...cardStyle,borderColor:"#34c759" }}>
                  <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Direct Margin (max price)</div>
                  <div style={{ fontSize:28,fontWeight:700,color:marginColor(directMargin) }}>{directMargin != null ? `${directMargin.toFixed(1)}%` : "—"}</div>
                </div>
                <div style={{ ...cardStyle,borderColor:"#ff9500" }}>
                  <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Dealer Margin (min price)</div>
                  <div style={{ fontSize:28,fontWeight:700,color:marginColor(dealerMargin) }}>{dealerMargin != null ? `${dealerMargin.toFixed(1)}%` : "—"}</div>
                </div>
                <div style={{ ...cardStyle,borderColor:"#0071e3" }}>
                  <div style={{ fontSize:11,color:"#86868b",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>Blended Margin (avg price)</div>
                  <div style={{ fontSize:28,fontWeight:700,color:marginColor(blendedMargin) }}>{blendedMargin != null ? `${blendedMargin.toFixed(1)}%` : "—"}</div>
                </div>
              </div>
            )}

            {/* Controls row */}
            <div style={{ display:"flex",alignItems:"center",gap:16,marginBottom:20,flexWrap:"wrap" }}>
              {/* Labor Rate Config */}
              <div style={{ display:"flex",alignItems:"center",gap:12,background:darkMode?"#1c1c1e":"#fff",
                border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",borderRadius:10,padding:"12px 18px",width:"fit-content" }}>
                <label style={{ fontSize:13,fontWeight:600 }}>Labor Rate:</label>
                <span style={{ fontSize:13,color:"#86868b" }}>$</span>
                <input type="number" step="0.50" min="0"
                  value={apiKeys.labor_rate_hourly || "25"}
                  onChange={(e) => setApiKeys(k => ({ ...k, labor_rate_hourly: e.target.value }))}
                  style={{ width:70,padding:"6px 8px",borderRadius:6,border:darkMode?"1px solid #3a3a3e":"1px solid #d2d2d7",
                    fontSize:13,background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                <span style={{ fontSize:12,color:"#86868b" }}>/hr</span>
                <button className="btn-primary" style={{ fontSize:11,padding:"5px 14px" }}
                  onClick={async () => {
                    try {
                      await saveAllApiKeys(apiKeys, user.id);
                    } catch (e) { alert("Save failed: " + e.message); }
                  }}>Save</button>
              </div>
              {/* Ad Spend % */}
              <div style={{ display:"flex",alignItems:"center",gap:8,background:darkMode?"#1c1c1e":"#fff",
                border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",borderRadius:10,padding:"12px 18px",width:"fit-content" }}>
                <label style={{ fontSize:13,fontWeight:600 }}>Ad Spend:</label>
                <input type="number" step="1" min="0" max="100"
                  value={apiKeys.ad_spend_pct || "0"}
                  onChange={(e) => setApiKeys(k => ({ ...k, ad_spend_pct: e.target.value }))}
                  style={{ width:60,padding:"6px 8px",borderRadius:6,border:darkMode?"1px solid #3a3a3e":"1px solid #d2d2d7",
                    fontSize:13,background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                <span style={{ fontSize:12,color:"#86868b" }}>% of sale</span>
              </div>
              {/* Shipping Cost */}
              <div style={{ display:"flex",alignItems:"center",gap:8,background:darkMode?"#1c1c1e":"#fff",
                border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",borderRadius:10,padding:"12px 18px",width:"fit-content" }}>
                <label style={{ fontSize:13,fontWeight:600 }}>Shipping:</label>
                <span style={{ fontSize:13,color:"#86868b" }}>$</span>
                <input type="number" step="0.50" min="0"
                  value={apiKeys.shipping_cost_per_unit || "0"}
                  onChange={(e) => setApiKeys(k => ({ ...k, shipping_cost_per_unit: e.target.value }))}
                  style={{ width:70,padding:"6px 8px",borderRadius:6,border:darkMode?"1px solid #3a3a3e":"1px solid #d2d2d7",
                    fontSize:13,background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                <span style={{ fontSize:12,color:"#86868b" }}>/unit</span>
              </div>
              {/* Fetch Shopify Prices */}
              <button className="btn-primary" style={{ fontSize:12,padding:"10px 18px",display:"flex",alignItems:"center",gap:6 }}
                onClick={fetchShopifySalesPrices}
                disabled={shopifySalesPrices?.loading}>
                {shopifySalesPrices?.loading ? <><span className="spinner" /> Fetching...</> : "Fetch Shopify Prices"}
              </button>
              {shopifySalesPrices?.syncedAt && (
                <span style={{ fontSize:11,color:"#86868b" }}>
                  Prices synced {new Date(shopifySalesPrices.syncedAt).toLocaleString()}
                </span>
              )}
            </div>
            {shopifySalesPrices?.error && (
              <div style={{ padding:"10px 14px",background:darkMode?"#3a2a2a":"#fff3f3",border:"1px solid #ff3b30",borderRadius:8,fontSize:12,color:"#ff3b30",marginBottom:16 }}>
                {shopifySalesPrices.error}
              </div>
            )}

            {/* Profit Table */}
            <div style={{ background:darkMode?"#1c1c1e":"#fff",borderRadius:12,border:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",overflow:"hidden" }}>
              <div style={{ overflowX:"auto",maxHeight:"70vh",overflowY:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",minWidth:hasShopifyPrices?1600:1100 }}>
                  <thead style={{ position:"sticky",top:0,zIndex:10 }}>
                    <tr>
                      <th style={thStyle}>Product</th>
                      <th style={{ ...thStyle,textAlign:"center",width:80 }}>Trend</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>BOM Cost</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>Labor</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>Shipping</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>Ad Spend</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>All-In Cost</th>
                      <th style={{ ...thStyle,textAlign:"right",...thGroupBorder }}>MSRP</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>Profit</th>
                      <th style={{ ...thStyle,textAlign:"right" }}>Margin</th>
                      {hasShopifyPrices && <>
                        <th style={{ ...thStyle,textAlign:"right",...thGroupBorder }}>Avg Actual</th>
                        <th style={{ ...thStyle,textAlign:"right" }}>Profit</th>
                        <th style={{ ...thStyle,textAlign:"right" }}>Margin</th>
                        <th style={{ ...thStyle,textAlign:"right",...thGroupBorder }}>Min (Dealer)</th>
                        <th style={{ ...thStyle,textAlign:"right" }}>Profit</th>
                        <th style={{ ...thStyle,textAlign:"right" }}>Margin</th>
                        <th style={{ ...thStyle,textAlign:"right",...thGroupBorder }}>Units Sold</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ transition:"background 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.background=darkMode?"#2c2c2e":"#f5f5f7"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={{ ...tdStyle,fontWeight:600 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                            {r.color && <div style={{ width:10,height:10,borderRadius:"50%",background:r.color,flexShrink:0 }} />}
                            {r.name}
                          </div>
                        </td>
                        <td style={{ ...tdStyle,textAlign:"center" }}>
                          {(() => {
                            const pp = parts.filter(p => p.projectId === r.id);
                            const partIds = new Set(pp.map(p => p.id));
                            const phForProd = allPriceHistory.filter(h => partIds.has(h.part_id));
                            if (phForProd.length < 2) return <span style={{ fontSize:10,color:"#aeaeb2" }}>—</span>;
                            // Aggregate by date: sum unit_price per day for this product's parts
                            const byDate = {};
                            for (const h of phForProd) {
                              const day = h.recorded_at.slice(0, 10);
                              if (!byDate[day]) byDate[day] = {};
                              // Keep latest price per part per day
                              if (!byDate[day][h.part_id] || h.recorded_at > byDate[day][h.part_id].recorded_at) {
                                byDate[day][h.part_id] = h;
                              }
                            }
                            const dates = Object.keys(byDate).sort();
                            if (dates.length < 2) return <span style={{ fontSize:10,color:"#aeaeb2" }}>—</span>;
                            const sparkData = dates.slice(-12).map(day => {
                              const total = Object.values(byDate[day]).reduce((s, h) => {
                                const part = pp.find(p => p.id === h.part_id);
                                return s + (parseFloat(h.unit_price) || 0) * (part ? (parseInt(part.quantity) || 1) : 1);
                              }, 0);
                              return { recorded_at: day, unit_price: total };
                            });
                            return <PriceChart data={sparkData} sparkline width={70} height={24} darkMode={darkMode} />;
                          })()}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right" }}>${fmtDollar(r.bomCost)}</td>
                        <td style={{ ...tdStyle,textAlign:"right",color:"#86868b" }}>{r.buildMins ? `${r.buildMins}m / $${fmtDollar(r.laborCost)}` : "—"}</td>
                        <td style={{ ...tdStyle,textAlign:"right",color:"#86868b" }}>{shippingPerUnit > 0 ? `$${fmtDollar(shippingPerUnit)}` : "—"}</td>
                        <td style={{ ...tdStyle,textAlign:"right",color:"#ff9500" }}>{r.salesPrice && adSpendPct > 0 ? `${adSpendPct}% / $${fmtDollar(r.adCostMSRP)}` : adSpendPct > 0 ? `${adSpendPct}%` : "—"}</td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:700 }}>${fmtDollar(r.allInCostMSRP || r.totalCost)}</td>
                        {/* MSRP group */}
                        <td style={{ ...tdStyle,textAlign:"right",...tdGroupBorder }}>
                          <div style={{ display:"flex",alignItems:"center",justifyContent:"flex-end",gap:2 }}>
                            <span style={{ fontSize:12,color:"#86868b" }}>$</span>
                            <input type="number" step="0.01" min="0"
                              defaultValue={r.salesPrice || ""}
                              placeholder="—"
                              onChange={(e) => {
                                const val = e.target.value ? parseFloat(e.target.value) : null;
                                setProducts(prev => prev.map(p => p.id === r.id ? { ...p, salesPrice: val } : p));
                                saveSalesPrice(r.id, val);
                              }}
                              style={{ width:85,padding:"4px 6px",borderRadius:5,border:darkMode?"1px solid #3a3a3e":"1px solid #d2d2d7",
                                fontSize:13,textAlign:"right",background:darkMode?"#2c2c2e":"#fff",color:darkMode?"#f5f5f7":"#1d1d1f" }} />
                          </div>
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,color:r.profit!=null?(r.profit>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                          {r.profit != null ? `$${fmtDollar(r.profit)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,color:marginColor(r.marginPct) }}>
                          {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                        </td>
                        {/* Avg Actual group */}
                        {hasShopifyPrices && <>
                          <td style={{ ...tdStyle,textAlign:"right",...tdGroupBorder,color:r.avgActual!=null?(darkMode?"#f5f5f7":"#1d1d1f"):"#86868b" }}>
                            {r.avgActual != null ? `$${fmtDollar(r.avgActual)}` : "—"}
                          </td>
                          <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,color:r.profitAvg!=null?(r.profitAvg>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                            {r.profitAvg != null ? `$${fmtDollar(r.profitAvg)}` : "—"}
                          </td>
                          <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,color:marginColor(r.marginAvg) }}>
                            {r.marginAvg != null ? `${r.marginAvg.toFixed(1)}%` : "—"}
                          </td>
                          {/* Min (Dealer) group */}
                          <td style={{ ...tdStyle,textAlign:"right",...tdGroupBorder,color:r.minActual!=null?(darkMode?"#f5f5f7":"#1d1d1f"):"#86868b" }}>
                            {r.minActual != null ? `$${fmtDollar(r.minActual)}` : "—"}
                          </td>
                          <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,color:r.profitMin!=null?(r.profitMin>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                            {r.profitMin != null ? `$${fmtDollar(r.profitMin)}` : "—"}
                          </td>
                          <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,color:marginColor(r.marginMin) }}>
                            {r.marginMin != null ? `${r.marginMin.toFixed(1)}%` : "—"}
                          </td>
                          {/* Units sold */}
                          <td style={{ ...tdStyle,textAlign:"right",...tdGroupBorder,color:r.unitsSold!=null?(darkMode?"#f5f5f7":"#1d1d1f"):"#86868b" }}>
                            {r.unitsSold != null ? r.unitsSold.toLocaleString() : "—"}
                          </td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                  {rows.length > 0 && <tfoot>
                    <tr style={{ background:darkMode?"#2c2c2e":"#fafafa" }}>
                      <td style={{ ...tdStyle,fontWeight:700,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none" }}>
                        Averages / Totals
                      </td>
                      <td style={{ ...tdStyle,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none" }} />
                      <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none" }}>
                        ${fmtDollar(rows.reduce((s,r)=>s+r.bomCost,0)/rows.length)}
                      </td>
                      <td style={{ ...tdStyle,textAlign:"right",color:"#86868b",borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none" }}>
                        {rows.filter(r=>r.buildMins).length > 0 ? `${(rows.reduce((s,r)=>s+r.buildMins,0)/rows.filter(r=>r.buildMins).length).toFixed(0)} min` : "—"}
                      </td>
                      <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none" }}>
                        ${fmtDollar(rows.reduce((s,r)=>s+r.totalCost,0)/rows.length)}
                      </td>
                      {/* MSRP avg */}
                      <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",...tdGroupBorder }}>
                        {withMargin.length > 0 ? `$${fmtDollar(withMargin.reduce((s,r)=>s+r.salesPrice,0)/withMargin.length)}` : "—"}
                      </td>
                      <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                        color:withMargin.length>0?(withMargin.reduce((s,r)=>s+r.profit,0)/withMargin.length>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                        {withMargin.length > 0 ? `$${fmtDollar(withMargin.reduce((s,r)=>s+r.profit,0)/withMargin.length)}` : "—"}
                      </td>
                      <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                        color:marginColor(avgMargin) }}>
                        {withMargin.length > 0 ? `${avgMargin.toFixed(1)}%` : "—"}
                      </td>
                      {hasShopifyPrices && <>
                        {/* Avg actual averages */}
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",...tdGroupBorder }}>
                          {withAvgMargin.length > 0 ? `$${fmtDollar(withAvgMargin.reduce((s,r)=>s+r.avgActual,0)/withAvgMargin.length)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                          color:withAvgMargin.length>0?(withAvgMargin.reduce((s,r)=>s+r.profitAvg,0)/withAvgMargin.length>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                          {withAvgMargin.length > 0 ? `$${fmtDollar(withAvgMargin.reduce((s,r)=>s+r.profitAvg,0)/withAvgMargin.length)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                          color:marginColor(blendedMargin) }}>
                          {blendedMargin != null ? `${blendedMargin.toFixed(1)}%` : "—"}
                        </td>
                        {/* Min (dealer) averages */}
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",...tdGroupBorder }}>
                          {withMinMargin.length > 0 ? `$${fmtDollar(withMinMargin.reduce((s,r)=>s+r.minActual,0)/withMinMargin.length)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                          color:withMinMargin.length>0?(withMinMargin.reduce((s,r)=>s+r.profitMin,0)/withMinMargin.length>=0?"#34c759":"#ff3b30"):"#86868b" }}>
                          {withMinMargin.length > 0 ? `$${fmtDollar(withMinMargin.reduce((s,r)=>s+r.profitMin,0)/withMinMargin.length)}` : "—"}
                        </td>
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:700,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",
                          color:marginColor(dealerMargin) }}>
                          {dealerMargin != null ? `${dealerMargin.toFixed(1)}%` : "—"}
                        </td>
                        {/* Total units */}
                        <td style={{ ...tdStyle,textAlign:"right",fontWeight:600,borderTop:darkMode?"2px solid #3a3a3e":"2px solid #e5e5ea",borderBottom:"none",...tdGroupBorder }}>
                          {rows.filter(r=>r.unitsSold!=null).reduce((s,r)=>s+(r.unitsSold||0),0).toLocaleString()}
                        </td>
                      </>}
                    </tr>
                  </tfoot>}
                </table>
              </div>
            </div>
          </div>
          );
        })()}
      </main>

      {/* QR Label Modal */}
      {qrModalParts && qrModalParts.length > 0 && (
        <QRLabelModal parts={qrModalParts} products={products} onClose={() => setQrModalParts(null)} />
      )}

      <footer style={{ borderTop:darkMode?"1px solid #3a3a3e":"1px solid #e5e5ea",padding:"10px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,color:"#aeaeb2",
        background:darkMode?"#1c1c1e":"transparent" }}>
        <span style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',sans-serif" }}>Jackson Audio BOM Manager v5.49 — built 2026-03-20 10:55pm</span>
        <span>{new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span>
      </footer>
    </div>
  );
}
