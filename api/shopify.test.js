// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseNextLink, isNonProduct, calcEffectiveLinePrice } from "./shopify.js";

// ─────────────────────────────────────────────
// parseNextLink
// ─────────────────────────────────────────────
describe("parseNextLink", () => {
  it("extracts next URL from a Shopify Link header", () => {
    const header = `<https://shop.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250>; rel="next"`;
    expect(parseNextLink(header)).toBe(
      "https://shop.myshopify.com/admin/api/2024-01/orders.json?page_info=abc123&limit=250"
    );
  });

  it("returns null when no next link present", () => {
    const header = `<https://shop.myshopify.com/admin/api/prev>; rel="previous"`;
    expect(parseNextLink(header)).toBeNull();
  });

  it("handles a header with both previous and next links", () => {
    const header = `<https://shop.myshopify.com/prev>; rel="previous", <https://shop.myshopify.com/next>; rel="next"`;
    expect(parseNextLink(header)).toBe("https://shop.myshopify.com/next");
  });

  it("returns null for empty string", () => {
    expect(parseNextLink("")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────
// isNonProduct
// ─────────────────────────────────────────────
describe("isNonProduct", () => {
  it("identifies shipping line items", () => {
    expect(isNonProduct("Standard Shipping")).toBe(true);
    expect(isNonProduct("Express Shipping")).toBe(true);
    expect(isNonProduct("Free Shipping")).toBe(true);
  });

  it("identifies gift cards", () => {
    expect(isNonProduct("Gift Card $50")).toBe(true);
    expect(isNonProduct("$100 Gift Card")).toBe(true);
  });

  it("identifies tips and gratuities", () => {
    expect(isNonProduct("Tip")).toBe(true);
    expect(isNonProduct("Gratuity")).toBe(true);
  });

  it("identifies other non-products", () => {
    expect(isNonProduct("Donation")).toBe(true);
    expect(isNonProduct("Insurance")).toBe(true);
    expect(isNonProduct("Handling Fee")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isNonProduct("SHIPPING")).toBe(true);
    expect(isNonProduct("Gift Card")).toBe(true);
  });

  it("does not filter real products", () => {
    expect(isNonProduct("Bloom Overdrive")).toBe(false);
    expect(isNonProduct("Broken Arrow")).toBe(false);
    expect(isNonProduct("Golden Boy Deluxe")).toBe(false);
  });

  it("handles empty/null titles", () => {
    expect(isNonProduct("")).toBe(false);
    expect(isNonProduct(null)).toBe(false);
    expect(isNonProduct(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────
// calcEffectiveLinePrice
// ─────────────────────────────────────────────
describe("calcEffectiveLinePrice", () => {
  it("returns original price when no discounts", () => {
    expect(calcEffectiveLinePrice(199.99, [], 1)).toBe(199.99);
    expect(calcEffectiveLinePrice(199.99, null, 1)).toBe(199.99);
  });

  it("deducts total discount split across quantity", () => {
    // $20 discount on 2 units = $10 per unit → $100 - $10 = $90
    const discounts = [{ amount: "20.00" }];
    expect(calcEffectiveLinePrice(100, discounts, 2)).toBe(90);
  });

  it("handles multiple discount allocations", () => {
    // $10 + $5 = $15 discount on 1 unit
    const discounts = [{ amount: "10.00" }, { amount: "5.00" }];
    expect(calcEffectiveLinePrice(100, discounts, 1)).toBe(85);
  });

  it("handles string amounts in discount_allocations", () => {
    const discounts = [{ amount: "25.50" }];
    expect(calcEffectiveLinePrice(100, discounts, 1)).toBeCloseTo(74.5);
  });

  it("handles zero quantity without dividing by zero", () => {
    const discounts = [{ amount: "10.00" }];
    // quantity=0 → perItemDiscount=0, so price unchanged
    expect(calcEffectiveLinePrice(50, discounts, 0)).toBe(50);
  });

  it("handles fractional per-item discounts correctly", () => {
    // $10 discount on 3 units = $3.33... per unit → $50 - $3.33 = $46.67
    const discounts = [{ amount: "10.00" }];
    expect(calcEffectiveLinePrice(50, discounts, 3)).toBeCloseTo(46.67, 1);
  });
});
