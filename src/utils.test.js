import { describe, it, expect } from "vitest";
import {
  toUSD,
  fmtCountry,
  fmtPrice,
  fmtDollar,
  getTariffRate,
  splitCSVLine,
  parseBOM,
  isLockedSupplier,
  getSupplierWebsite,
  getReelQty,
  bestPriceSupplier,
  buildDigiKeyCartUrl,
  buildPurchaseOrders,
  buildPOEmailDraft,
  buildLowStockEmailBody,
} from "./utils.js";

// ─────────────────────────────────────────────
// toUSD
// ─────────────────────────────────────────────
describe("toUSD", () => {
  const rates = { EUR: 0.92, GBP: 0.79, CNY: 7.24 };

  it("returns price unchanged when currency is USD", () => {
    expect(toUSD(10, "USD", rates)).toBe(10);
  });

  it("returns price unchanged when no currency provided", () => {
    expect(toUSD(10, null, rates)).toBe(10);
    expect(toUSD(10, "", rates)).toBe(10);
  });

  it("returns price unchanged when no rates provided", () => {
    expect(toUSD(10, "EUR", null)).toBe(10);
  });

  it("converts EUR to USD correctly", () => {
    // EUR rate = 0.92 means 1 USD = 0.92 EUR, so 0.92 EUR = 1 USD
    expect(toUSD(0.92, "EUR", rates)).toBeCloseTo(1.0, 5);
  });

  it("converts GBP to USD correctly", () => {
    expect(toUSD(0.79, "GBP", rates)).toBeCloseTo(1.0, 5);
  });

  it("returns price unchanged for unknown currency", () => {
    expect(toUSD(5, "XYZ", rates)).toBe(5);
  });
});

// ─────────────────────────────────────────────
// fmtCountry
// ─────────────────────────────────────────────
describe("fmtCountry", () => {
  it("returns full name for known country codes", () => {
    expect(fmtCountry("US")).toBe("United States");
    expect(fmtCountry("CN")).toBe("China");
    expect(fmtCountry("DE")).toBe("Germany");
    expect(fmtCountry("GB")).toBe("United Kingdom");
  });

  it("is case-insensitive", () => {
    expect(fmtCountry("us")).toBe("United States");
    expect(fmtCountry("cn")).toBe("China");
  });

  it("returns the code itself for unknown codes", () => {
    expect(fmtCountry("ZZ")).toBe("ZZ");
  });

  it("returns empty string for falsy input", () => {
    expect(fmtCountry("")).toBe("");
    expect(fmtCountry(null)).toBe("");
    expect(fmtCountry(undefined)).toBe("");
  });
});

// ─────────────────────────────────────────────
// fmtPrice
// ─────────────────────────────────────────────
describe("fmtPrice", () => {
  it("strips trailing zeroes beyond 2 decimals", () => {
    expect(fmtPrice(1.5)).toBe("1.50");
    expect(fmtPrice(1.50)).toBe("1.50");
    expect(fmtPrice(1.500)).toBe("1.50");
  });

  it("keeps up to 4 significant decimal places", () => {
    expect(fmtPrice(0.1234)).toBe("0.1234");
    expect(fmtPrice(0.12345)).toBe("0.1235"); // rounds at 4th decimal
  });

  it("strips trailing zeroes but keeps minimum 2", () => {
    expect(fmtPrice(1.1200)).toBe("1.12");
    expect(fmtPrice(1.1230)).toBe("1.123");
    expect(fmtPrice(1.1234)).toBe("1.1234");
  });
});

// ─────────────────────────────────────────────
// fmtDollar
// ─────────────────────────────────────────────
describe("fmtDollar", () => {
  it("formats to 2 decimal places", () => {
    expect(fmtDollar(1)).toBe("1.00");
    expect(fmtDollar(1.5)).toBe("1.50");
    expect(fmtDollar(1234.567)).toBe("1,234.57");
  });

  it("adds thousands separator", () => {
    expect(fmtDollar(10000)).toBe("10,000.00");
  });
});

// ─────────────────────────────────────────────
// getTariffRate
// ─────────────────────────────────────────────
describe("getTariffRate", () => {
  const tariffs = { CN: 145, TW: 32, DE: 20, UK: 10 };

  it("returns 0 for US", () => {
    expect(getTariffRate("US", tariffs)).toBe(0);
  });

  it("returns 0 when no country code", () => {
    expect(getTariffRate("", tariffs)).toBe(0);
    expect(getTariffRate(null, tariffs)).toBe(0);
  });

  it("returns correct tariff for known countries", () => {
    expect(getTariffRate("CN", tariffs)).toBe(145);
    expect(getTariffRate("TW", tariffs)).toBe(32);
    expect(getTariffRate("DE", tariffs)).toBe(20);
  });

  it("normalizes GB to UK", () => {
    expect(getTariffRate("GB", tariffs)).toBe(10);
  });

  it("is case-insensitive", () => {
    expect(getTariffRate("cn", tariffs)).toBe(145);
  });

  it("returns 0 for unknown countries", () => {
    expect(getTariffRate("ZZ", tariffs)).toBe(0);
  });
});

// ─────────────────────────────────────────────
// splitCSVLine
// ─────────────────────────────────────────────
describe("splitCSVLine", () => {
  it("splits a simple comma-delimited line", () => {
    expect(splitCSVLine("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields containing commas", () => {
    expect(splitCSVLine('"a,b",c,d', ",")).toEqual(["a,b", "c", "d"]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(splitCSVLine('"say ""hello""",world', ",")).toEqual(['say "hello"', "world"]);
  });

  it("splits tab-delimited lines", () => {
    expect(splitCSVLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });

  it("strips surrounding whitespace", () => {
    expect(splitCSVLine(" a , b , c ", ",")).toEqual(["a", "b", "c"]);
  });
});

// ─────────────────────────────────────────────
// parseBOM
// ─────────────────────────────────────────────
describe("parseBOM", () => {
  it("parses a CSV BOM with headers", () => {
    const csv = "MPN,Quantity,Description\nRC0402,10,Resistor\nCC0402,5,Capacitor";
    const parts = parseBOM(csv);
    expect(parts).toHaveLength(2);
    expect(parts[0].mpn).toBe("RC0402");
    expect(parts[0].quantity).toBe(10);
    expect(parts[0].description).toBe("Resistor");
    expect(parts[1].mpn).toBe("CC0402");
    expect(parts[1].quantity).toBe(5);
  });

  it("defaults preferredSupplier to mouser", () => {
    const csv = "MPN,Quantity\nRC0402,10";
    const [part] = parseBOM(csv);
    expect(part.preferredSupplier).toBe("mouser");
  });

  it("uses explicit preferredSupplier when provided", () => {
    const csv = "MPN,Quantity,Supplier\nRC0402,10,digikey";
    const [part] = parseBOM(csv);
    expect(part.preferredSupplier).toBe("digikey");
  });

  it("parses headerless 2-column format", () => {
    const csv = "RC0402,10";
    const parts = parseBOM(csv);
    expect(parts).toHaveLength(1);
    expect(parts[0].mpn).toBe("RC0402");
    expect(parts[0].quantity).toBe(10);
  });

  it("returns empty array for blank input", () => {
    expect(parseBOM("")).toEqual([]);
    expect(parseBOM("   ")).toEqual([]);
  });

  it("sets initial pricing state", () => {
    const csv = "MPN,Quantity\nRC0402,1";
    const [part] = parseBOM(csv);
    expect(part.pricing).toBeNull();
    expect(part.pricingStatus).toBe("idle");
    expect(part.flaggedForOrder).toBe(false);
  });

  it("parses tab-separated BOM", () => {
    const tsv = "MPN\tQuantity\tDescription\nRC0402\t10\tResistor";
    const parts = parseBOM(tsv);
    expect(parts).toHaveLength(1);
    expect(parts[0].mpn).toBe("RC0402");
    expect(parts[0].quantity).toBe(10);
  });
});

// ─────────────────────────────────────────────
// isLockedSupplier
// ─────────────────────────────────────────────
describe("isLockedSupplier", () => {
  it("returns true for locked suppliers", () => {
    expect(isLockedSupplier("bolt depot")).toBe(true);
    expect(isLockedSupplier("boltdepot")).toBe(true);
    expect(isLockedSupplier("ce dist")).toBe(true);
    expect(isLockedSupplier("cedist")).toBe(true);
    expect(isLockedSupplier("ce-dist")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isLockedSupplier("Bolt Depot")).toBe(true);
    expect(isLockedSupplier("CE DIST")).toBe(true);
  });

  it("returns falsy for unlocked suppliers", () => {
    expect(isLockedSupplier("mouser")).toBeFalsy();
    expect(isLockedSupplier("digikey")).toBeFalsy();
    expect(isLockedSupplier("arrow")).toBeFalsy();
  });

  it("returns falsy for null/undefined", () => {
    expect(isLockedSupplier(null)).toBeFalsy();
    expect(isLockedSupplier(undefined)).toBeFalsy();
  });
});

// ─────────────────────────────────────────────
// getSupplierWebsite
// ─────────────────────────────────────────────
describe("getSupplierWebsite", () => {
  it("returns bolt depot search URL with MPN", () => {
    const url = getSupplierWebsite("bolt depot", "1/4-20");
    expect(url).toContain("boltdepot.com");
    expect(url).toContain(encodeURIComponent("1/4-20"));
  });

  it("returns bolt depot base URL without MPN", () => {
    expect(getSupplierWebsite("bolt depot", null)).toBe("https://www.boltdepot.com");
  });

  it("returns mcmaster URL with MPN", () => {
    const url = getSupplierWebsite("mcmaster", "91251A193");
    expect(url).toContain("mcmaster.com");
    expect(url).toContain(encodeURIComponent("91251A193"));
  });

  it("handles mcmaster-carr alias", () => {
    expect(getSupplierWebsite("mcmaster-carr", null)).toBe("https://www.mcmaster.com");
  });

  it("returns cedist URL", () => {
    const url = getSupplierWebsite("ce dist", "some-part");
    expect(url).toContain("cedist.com");
  });

  it("returns null for unknown supplier", () => {
    expect(getSupplierWebsite("amazon", "ASIN")).toBeNull();
    expect(getSupplierWebsite(null, "part")).toBeNull();
  });
});

// ─────────────────────────────────────────────
// getReelQty
// ─────────────────────────────────────────────
describe("getReelQty", () => {
  it("returns reelQty when set", () => {
    expect(getReelQty({ reelQty: "1000" })).toBe(1000);
    expect(getReelQty({ reelQty: 500 })).toBe(500);
  });

  it("returns null when reelQty is missing or zero", () => {
    expect(getReelQty({})).toBeNull();
    expect(getReelQty({ reelQty: "0" })).toBeNull();
    expect(getReelQty({ reelQty: "" })).toBeNull();
  });
});

// ─────────────────────────────────────────────
// bestPriceSupplier
// ─────────────────────────────────────────────
describe("bestPriceSupplier", () => {
  it("returns null for null pricing", () => {
    expect(bestPriceSupplier(null)).toBeNull();
  });

  it("returns the cheapest supplier in stock", () => {
    const pricing = {
      mouser:  { unitPrice: 1.50, stock: 100 },
      digikey: { unitPrice: 1.20, stock: 50  },
      arrow:   { unitPrice: 1.80, stock: 200 },
    };
    expect(bestPriceSupplier(pricing)).toBe("digikey");
  });

  it("skips out-of-stock suppliers", () => {
    const pricing = {
      mouser:  { unitPrice: 0.50, stock: 0   },  // cheapest but no stock
      digikey: { unitPrice: 1.20, stock: 50  },
    };
    expect(bestPriceSupplier(pricing)).toBe("digikey");
  });

  it("ignores keys starting with underscore", () => {
    const pricing = {
      _countryOfOrigin: "CN",
      mouser: { unitPrice: 1.00, stock: 100 },
    };
    expect(bestPriceSupplier(pricing)).toBe("mouser");
  });

  it("prefers preferred supplier when within margin", () => {
    const pricing = {
      mouser:  { unitPrice: 1.00, stock: 100 },  // cheapest
      digikey: { unitPrice: 1.04, stock: 100 },  // 4% more
    };
    // 5% margin → digikey is within margin, so prefer digikey
    expect(bestPriceSupplier(pricing, "digikey", "5")).toBe("digikey");
  });

  it("does not prefer preferred supplier when outside margin", () => {
    const pricing = {
      mouser:  { unitPrice: 1.00, stock: 100 },
      digikey: { unitPrice: 1.10, stock: 100 },  // 10% more
    };
    // 5% margin → digikey is outside margin, mouser wins
    expect(bestPriceSupplier(pricing, "digikey", "5")).toBe("mouser");
  });

  it("does not prefer out-of-stock preferred supplier", () => {
    const pricing = {
      mouser:  { unitPrice: 1.00, stock: 100 },
      digikey: { unitPrice: 1.00, stock: 0   },
    };
    expect(bestPriceSupplier(pricing, "digikey", "5")).toBe("mouser");
  });
});

// ─────────────────────────────────────────────
// buildDigiKeyCartUrl
// ─────────────────────────────────────────────
describe("buildDigiKeyCartUrl", () => {
  it("builds a valid DigiKey cart URL", () => {
    const url = buildDigiKeyCartUrl([
      { partNumber: "RC0402-10KGRCT-ND", quantity: 100 },
      { partNumber: "CC0402-100NFR-ND",  quantity: 50  },
    ]);
    expect(url).toMatch(/^https:\/\/www\.digikey\.com\/ordering\/shoppingcart/);
    expect(url).toContain("RC0402");
    expect(url).toContain("|100");
    expect(url).toContain("|50");
  });

  it("handles empty items list", () => {
    const url = buildDigiKeyCartUrl([]);
    expect(url).toBe("https://www.digikey.com/ordering/shoppingcart?newproducts=");
  });
});

// ─────────────────────────────────────────────
// buildPurchaseOrders
// ─────────────────────────────────────────────
describe("buildPurchaseOrders", () => {
  it("groups parts by preferred supplier", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "mouser",  stockQty: "5", reorderQty: "10", flaggedForOrder: false },
      { mpn: "B", preferredSupplier: "digikey", stockQty: "2", reorderQty: "20", flaggedForOrder: false },
      { mpn: "C", preferredSupplier: "mouser",  stockQty: "0", reorderQty: "15", flaggedForOrder: false },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(Object.keys(pos)).toContain("mouser");
    expect(Object.keys(pos)).toContain("digikey");
    expect(pos.mouser).toHaveLength(2);
    expect(pos.digikey).toHaveLength(1);
  });

  it("calculates neededQty as reorderQty - stockQty", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "mouser", stockQty: "3", reorderQty: "10", flaggedForOrder: false },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(pos.mouser[0].neededQty).toBe(7); // 10 - 3 = 7
  });

  it("excludes parts above reorder point", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "mouser", stockQty: "15", reorderQty: "10", flaggedForOrder: false },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(Object.keys(pos)).toHaveLength(0);
  });

  it("includes flagged parts regardless of stock", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "mouser", stockQty: "100", reorderQty: "10", flaggedForOrder: true, quantity: 5 },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(pos.mouser).toHaveLength(1);
  });

  it("excludes internal parts", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "mouser", stockQty: "0", reorderQty: "10", flaggedForOrder: false, isInternal: true },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(Object.keys(pos)).toHaveLength(0);
  });

  it("defaults to mouser when no preferred supplier set", () => {
    const parts = [
      { mpn: "A", preferredSupplier: "", stockQty: "0", reorderQty: "10", flaggedForOrder: false },
    ];
    const pos = buildPurchaseOrders(parts);
    expect(pos.mouser).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────
// buildPOEmailDraft
// ─────────────────────────────────────────────
describe("buildPOEmailDraft", () => {
  const lines = [
    { mpn: "RC0402", neededQty: 100, description: "10k Resistor" },
    { mpn: "CC0402", neededQty: 50,  description: "100nF Cap" },
  ];

  it("generates a subject with PO number and company name", () => {
    const { subject } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", { name: "Jackson Audio" });
    expect(subject).toContain("JA-PO-001");
    expect(subject).toContain("Jackson Audio");
  });

  it("uses company name from companyInfo", () => {
    const { body } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", { name: "Acme Corp" });
    expect(body).toContain("Acme Corp");
  });

  it("uses default company name when none provided", () => {
    const { body } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", null);
    expect(body).toContain("Jackson Audio");
  });

  it("uses contact name in greeting when provided", () => {
    const { body } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", {}, "John");
    expect(body).toContain("Hi John,");
  });

  it("uses generic greeting when no contact name", () => {
    const { body } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", {});
    expect(body).toContain("Hi Mouser Team,");
  });

  it("includes all part numbers and quantities", () => {
    const { body } = buildPOEmailDraft("Mouser", lines, "JA-PO-001", {});
    expect(body).toContain("RC0402");
    expect(body).toContain("CC0402");
    expect(body).toContain("100");
    expect(body).toContain("50");
  });
});

// ─────────────────────────────────────────────
// buildLowStockEmailBody
// ─────────────────────────────────────────────
describe("buildLowStockEmailBody", () => {
  it("returns null for empty list", () => {
    expect(buildLowStockEmailBody([])).toBeNull();
  });

  it("includes part info in the email body", () => {
    const parts = [
      { mpn: "RC0402", stockQty: "5", reorderQty: "20" },
    ];
    const body = buildLowStockEmailBody(parts);
    expect(body).toContain("RC0402");
    expect(body).toContain("Stock: 5");
    expect(body).toContain("Reorder point: 20");
    expect(body).toContain("Need: 15");
  });

  it("uses correct singular/plural based on count", () => {
    const one = [{ mpn: "A", stockQty: "1", reorderQty: "5" }];
    const two = [
      { mpn: "A", stockQty: "1", reorderQty: "5" },
      { mpn: "B", stockQty: "2", reorderQty: "8" },
    ];
    expect(buildLowStockEmailBody(one)).toContain("1 part is");
    expect(buildLowStockEmailBody(two)).toContain("2 parts are");
  });

  it("includes the BOM manager URL", () => {
    const parts = [{ mpn: "A", stockQty: "1", reorderQty: "5" }];
    expect(buildLowStockEmailBody(parts)).toContain("jackson-bom.vercel.app");
  });
});
