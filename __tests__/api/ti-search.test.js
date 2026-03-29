// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapProduct } from "../../api/ti-search.js";

describe("mapProduct", () => {
  const baseProduct = {
    tiPartNumber: "OPA2134UA/2K5",
    description: "Dual Audio Op-Amp",
    quantity: 1500,
    minimumOrderQuantity: 1,
    buyNowURL: "https://www.ti.com/orderNow/OPA2134UA2K5",
    pricing: [
      {
        currency: "USD",
        priceBreaks: [
          { priceBreakQuantity: 1,    price: 4.99 },
          { priceBreakQuantity: 10,   price: 4.20 },
          { priceBreakQuantity: 100,  price: 3.85 },
        ],
      },
    ],
  };

  it("maps tiPartNumber to mpn", () => {
    expect(mapProduct(baseProduct).mpn).toBe("OPA2134UA/2K5");
  });

  it("falls back to genericPartNumber when tiPartNumber missing", () => {
    expect(mapProduct({ genericPartNumber: "GPN123" }).mpn).toBe("GPN123");
  });

  it("maps description", () => {
    expect(mapProduct(baseProduct).description).toBe("Dual Audio Op-Amp");
  });

  it("maps stock from quantity field", () => {
    expect(mapProduct(baseProduct).stock).toBe(1500);
  });

  it("maps moq from minimumOrderQuantity", () => {
    expect(mapProduct(baseProduct).moq).toBe(1);
  });

  it("sets price from first USD price break", () => {
    expect(mapProduct(baseProduct).price).toBe(4.99);
  });

  it("maps all price breaks correctly", () => {
    const { priceBreaks } = mapProduct(baseProduct);
    expect(priceBreaks).toHaveLength(3);
    expect(priceBreaks[0]).toEqual({ qty: 1,   price: 4.99 });
    expect(priceBreaks[1]).toEqual({ qty: 10,  price: 4.20 });
    expect(priceBreaks[2]).toEqual({ qty: 100, price: 3.85 });
  });

  it("filters out zero-price breaks", () => {
    const p = {
      ...baseProduct,
      pricing: [{ currency: "USD", priceBreaks: [{ priceBreakQuantity: 1, price: 0 }, { priceBreakQuantity: 10, price: 3.50 }] }],
    };
    const { priceBreaks } = mapProduct(p);
    expect(priceBreaks).toHaveLength(1);
    expect(priceBreaks[0].price).toBe(3.50);
  });

  it("uses buyNowURL for url", () => {
    expect(mapProduct(baseProduct).url).toBe("https://www.ti.com/orderNow/OPA2134UA2K5");
  });

  it("builds fallback URL from tiPartNumber when buyNowURL missing", () => {
    const p = { tiPartNumber: "LM358", description: "", quantity: 0 };
    expect(mapProduct(p).url).toContain("ti.com/product/LM358");
  });

  it("falls back to buyNowPrice when no price breaks", () => {
    const p = { tiPartNumber: "X", buyNowPrice: 2.50 };
    expect(mapProduct(p).price).toBe(2.50);
  });

  it("handles missing pricing array gracefully", () => {
    const p = { tiPartNumber: "X" };
    expect(mapProduct(p).priceBreaks).toHaveLength(0);
    expect(mapProduct(p).price).toBe(0);
  });

  it("uses first pricing entry when no USD entry found", () => {
    const p = {
      tiPartNumber: "X",
      pricing: [{ currency: "EUR", priceBreaks: [{ priceBreakQuantity: 1, price: 4.00 }] }],
    };
    expect(mapProduct(p).price).toBe(4.00);
  });

  it("handles alternative quantity field names", () => {
    const p = { tiPartNumber: "X", inventoryQuantity: 999 };
    expect(mapProduct(p).stock).toBe(999);
  });
});
