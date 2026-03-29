// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildSignature, formatProduct } from "./lcsc-search.js";

// ─────────────────────────────────────────────
// buildSignature
// ─────────────────────────────────────────────
describe("buildSignature", () => {
  it("returns a 40-char hex SHA1 string", () => {
    const sig = buildSignature("mykey", "mysecret", "abc123", "1700000000");
    expect(sig).toMatch(/^[0-9a-f]{40}$/);
  });

  it("produces a deterministic output for the same inputs", () => {
    const a = buildSignature("k", "s", "n", "t");
    const b = buildSignature("k", "s", "n", "t");
    expect(a).toBe(b);
  });

  it("produces different output when any input changes", () => {
    const base = buildSignature("key", "secret", "nonce", "1700000000");
    expect(buildSignature("KEY",    "secret", "nonce", "1700000000")).not.toBe(base);
    expect(buildSignature("key",    "SECRET", "nonce", "1700000000")).not.toBe(base);
    expect(buildSignature("key",    "secret", "NONCE", "1700000000")).not.toBe(base);
    expect(buildSignature("key",    "secret", "nonce", "9999999999")).not.toBe(base);
  });

  it("hashes the canonical string key=...&nonce=...&secret=...&timestamp=...", () => {
    // Verify by computing the expected SHA1 ourselves using the same format
    import("crypto").then(({ default: crypto }) => {
      const str = `key=k&nonce=n&secret=s&timestamp=t`;
      const expected = crypto.createHash("sha1").update(str).digest("hex");
      expect(buildSignature("k", "s", "n", "t")).toBe(expected);
    });
  });
});

// ─────────────────────────────────────────────
// formatProduct
// ─────────────────────────────────────────────
describe("formatProduct", () => {
  const baseProduct = {
    productModel: "GD25Q128CSIG",
    brandName: "GigaDevice",
    productName: "128M-bit SPI Flash Memory",
    stockNumber: "5000",
    productCode: "C97521",
    productPriceList: [
      { ladder: 1,   price: 0.45 },
      { ladder: 10,  price: 0.38 },
      { ladder: 100, price: 0.31 },
    ],
    minImage: "1",
    pdfUrl: "https://www.lcsc.com/product-detail/C97521.pdf",
    rohs: "Yes",
  };

  it("maps mpn from productModel", () => {
    expect(formatProduct(baseProduct).mpn).toBe("GD25Q128CSIG");
  });

  it("falls back to mpn field if productModel missing", () => {
    expect(formatProduct({ mpn: "ALT-MPN" }).mpn).toBe("ALT-MPN");
  });

  it("maps manufacturer from brandName", () => {
    expect(formatProduct(baseProduct).manufacturer).toBe("GigaDevice");
  });

  it("maps description from productName", () => {
    expect(formatProduct(baseProduct).description).toBe("128M-bit SPI Flash Memory");
  });

  it("parses stock from stockNumber", () => {
    expect(formatProduct(baseProduct).stock).toBe(5000);
  });

  it("sets unitPrice from first price break", () => {
    expect(formatProduct(baseProduct).unitPrice).toBe(0.45);
  });

  it("maps all price breaks", () => {
    const { priceBreaks } = formatProduct(baseProduct);
    expect(priceBreaks).toHaveLength(3);
    expect(priceBreaks[0]).toEqual({ breakQty: 1,   unitPrice: 0.45, currency: "USD" });
    expect(priceBreaks[1]).toEqual({ breakQty: 10,  unitPrice: 0.38, currency: "USD" });
    expect(priceBreaks[2]).toEqual({ breakQty: 100, unitPrice: 0.31, currency: "USD" });
  });

  it("filters out zero-price breaks", () => {
    const p = { ...baseProduct, productPriceList: [{ ladder: 1, price: 0 }, { ladder: 10, price: 0.38 }] };
    expect(formatProduct(p).priceBreaks).toHaveLength(1);
    expect(formatProduct(p).unitPrice).toBe(0.38);
  });

  it("handles alternative price field names (priceList / quantity / startQty)", () => {
    const p = {
      mpn: "ALT",
      priceList: [{ quantity: 1, usdPrice: 1.23 }],
    };
    const result = formatProduct(p);
    expect(result.priceBreaks[0].breakQty).toBe(1);
    expect(result.priceBreaks[0].unitPrice).toBe(1.23);
  });

  it("builds product URL from productCode", () => {
    const { productUrl } = formatProduct(baseProduct);
    expect(productUrl).toContain("lcsc.com");
    expect(productUrl).toContain("C97521");
  });

  it("sets productUrl to null when no productCode", () => {
    expect(formatProduct({ mpn: "X" }).productUrl).toBeNull();
  });

  it("maps datasheet from pdfUrl", () => {
    expect(formatProduct(baseProduct).datasheet).toContain(".pdf");
  });

  it("maps lcscCode from productCode", () => {
    expect(formatProduct(baseProduct).lcscCode).toBe("C97521");
  });

  it("returns null unitPrice when no price breaks", () => {
    expect(formatProduct({ mpn: "X" }).unitPrice).toBeNull();
  });
});
