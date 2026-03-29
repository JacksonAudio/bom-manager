// ============================================================
// src/utils.js — Pure utility functions (no React, no Supabase)
// Extracted from App.jsx so they can be unit-tested independently.
// ============================================================

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

export const COUNTRY_NAMES = {
  US:"United States",CA:"Canada",CN:"China",HK:"Hong Kong",TW:"Taiwan",SG:"Singapore",JP:"Japan",
  KR:"South Korea",UK:"United Kingdom",GB:"United Kingdom",DE:"Germany",FR:"France",IT:"Italy",
  NL:"Netherlands",PL:"Poland",AU:"Australia",IN:"India",TH:"Thailand",MY:"Malaysia",PH:"Philippines",
  VN:"Vietnam",MX:"Mexico",BR:"Brazil",IL:"Israel",SE:"Sweden",CH:"Switzerland",AT:"Austria",
  CZ:"Czech Republic",HU:"Hungary",IE:"Ireland",DK:"Denmark",FI:"Finland",NO:"Norway",ES:"Spain",
  PT:"Portugal",BE:"Belgium",RO:"Romania",SK:"Slovakia",SI:"Slovenia",BG:"Bulgaria",HR:"Croatia",
};

export const COUNTRY_ALIAS = { "GB":"UK", "UK":"UK" };

export const LOCKED_SUPPLIERS = new Set([
  "ce dist","cedist","ce-dist","bolt depot","boltdepot",
]);

// ─────────────────────────────────────────────
// CURRENCY
// ─────────────────────────────────────────────

// Convert a price from source currency to USD
export function toUSD(price, currency, rates) {
  if (!currency || currency === "USD" || !rates) return price;
  const rate = rates[currency];
  if (!rate) return price; // Unknown currency, assume USD
  return price / rate;
}

// ─────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────

// Format country code → full name (falls back to the code itself)
export const fmtCountry = (code) => { if (!code) return ""; return COUNTRY_NAMES[code.toUpperCase()] || code; };

// Format price: up to 4 decimals, strip trailing zeroes, keep min 2
export const fmtPrice = (v) => { const s = parseFloat(v).toFixed(4); return s.replace(/0{1,2}$/, ""); };
export const fmtDollar = (v) => parseFloat(v).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });

// ─────────────────────────────────────────────
// TARIFFS
// ─────────────────────────────────────────────

// Get tariff % for a country code given current tariff settings
export const getTariffRate = (countryCode, tariffs) => {
  if (!countryCode || countryCode === "US") return 0;
  const code = COUNTRY_ALIAS[countryCode.toUpperCase()] || countryCode.toUpperCase();
  return tariffs[code] || 0;
};

// ─────────────────────────────────────────────
// SUPPLIER HELPERS
// ─────────────────────────────────────────────

export const isLockedSupplier = (supplier) => supplier && LOCKED_SUPPLIERS.has(supplier.toLowerCase().trim());

// Build direct search/product URLs for manual (locked) suppliers
export const getSupplierWebsite = (supplier, mpn) => {
  if (!supplier) return null;
  const s = supplier.toLowerCase().trim();
  const q = mpn ? encodeURIComponent(mpn) : "";
  if (s === "bolt depot" || s === "boltdepot") {
    return q ? `https://www.boltdepot.com/Search.aspx?kw=${q}` : "https://www.boltdepot.com";
  }
  if (s === "mcmaster" || s === "mcmaster-carr") {
    return q ? `https://www.mcmaster.com/search/?query=${q}` : "https://www.mcmaster.com";
  }
  if (s === "ce dist" || s === "cedist" || s === "ce-dist") {
    return q ? `https://www.cedist.com/search?q=${q}` : "https://www.cedist.com";
  }
  return null;
};

// Get full reel quantity — uses part's reel_qty field, falls back to pricing data
export function getReelQty(part) {
  if (part.reelQty && parseInt(part.reelQty) > 0) return parseInt(part.reelQty);
  return null;
}

// ─────────────────────────────────────────────
// BOM PARSER
// ─────────────────────────────────────────────

// RFC 4180-compliant CSV splitter: handles quoted fields containing commas and escaped quotes ("")
export function splitCSVLine(line, delim) {
  if (delim === "\t") return line.split("\t").map(c => c.replace(/^"|"$/g, "").trim());
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === delim) { cells.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseBOM(raw) {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 1) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const firstLine = splitCSVLine(lines[0], delim).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
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
    preferredSupplier: ["preferredsupplier", "preferred_supplier", "supplier", "vendor"],
    unitCost:     ["unitcost", "unit_cost", "price", "cost"],
    stockQty:     ["stockqty", "stock_qty", "stock", "in stock"],
    addedDate:    ["addeddate", "added_date", "added", "created_at", "date"],
    notes:        ["notes", "purchaseurl", "purchase_url", "sourceurl", "source_url", "reorderurl", "reorder_url"],
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
    const cells = splitCSVLine(lines[i], delim).map((c) => c.replace(/^"|"$/g, "").trim());
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
      unitCost: get("unitCost") || "", projectId: null, reorderQty: "",
      stockQty: get("stockQty") || "",
      preferredSupplier: get("preferredSupplier") || "mouser",
      addedDate: get("addedDate") || "",
      notes: get("notes") || "",
      orderQty: "", flaggedForOrder: false,
      pricing: null,
      pricingStatus: "idle",
      pricingError: "",
      bestSupplier: null,
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// PRICING
// ─────────────────────────────────────────────

export function bestPriceSupplier(pricing, prefId, prefMargin) {
  if (!pricing) return null;
  let best = null, bestPrice = Infinity, bestStock = 0;
  for (const [key, data] of Object.entries(pricing)) {
    if (key.startsWith("_")) continue;
    if (data.unitPrice > 0 && data.stock > 0) {
      if (data.unitPrice < bestPrice || (data.unitPrice === bestPrice && (data.stock||0) > bestStock)) {
        bestPrice = data.unitPrice; bestStock = data.stock||0; best = key;
      }
    }
  }
  // If preferred supplier is in stock and within margin%, pick them instead
  if (prefId && best !== prefId && pricing[prefId]) {
    const pref = pricing[prefId];
    const margin = parseFloat(prefMargin) || 0;
    if (pref.unitPrice > 0 && pref.stock > 0 && pref.unitPrice <= bestPrice * (1 + margin / 100)) {
      return prefId;
    }
  }
  return best;
}

// ─────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────

export function buildDigiKeyCartUrl(items) {
  // items: [{ partNumber, quantity }]
  const parts = items.map(i => `${encodeURIComponent(i.partNumber)}|${i.quantity}`).join(",");
  return `https://www.digikey.com/ordering/shoppingcart?newproducts=${parts}`;
}

export function buildPurchaseOrders(parts) {
  const orderParts = parts.filter((p) => {
    if (p.isInternal) return false;
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

export function buildPOEmailDraft(supplierName, lines, poNumber, companyInfo, contactName) {
  const coName = companyInfo?.name || "Jackson Audio";
  const coAddr = companyInfo?.address || "";
  const subject = `Purchase Order ${poNumber} — ${coName}`;
  const greeting = contactName ? `Hi ${contactName},` : `Hi ${supplierName} Team,`;
  const body = [
    greeting,
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

export function buildLowStockEmailBody(lowParts) {
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
