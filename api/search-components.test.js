// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapMcMasterProduct } from "./search-components.js";

describe("mapMcMasterProduct", () => {
  const baseInfo = {
    PartNumber: "91251A193",
    DetailDescription: "18-8 Stainless Steel Socket Head Screw, M3 x 0.5 mm Thread",
    FamilyDescription: "Socket Head Screws",
    Links: [
      { Key: "Datasheet", Value: "https://www.mcmaster.com/datasheet/91251a193.pdf" },
    ],
  };

  const basePrices = [
    { MinimumQuantity: 1,   Amount: 0.26 },
    { MinimumQuantity: 10,  Amount: 0.21 },
    { MinimumQuantity: 50,  Amount: 0.17 },
  ];

  it("maps part number from info", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.mpn).toBe("91251A193");
  });

  it("falls back to requestedMpn when PartNumber missing", () => {
    const result = mapMcMasterProduct({}, [], "fallback-pn");
    expect(result.mpn).toBe("fallback-pn");
  });

  it("maps description from DetailDescription", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.description).toContain("Socket Head Screw");
  });

  it("falls back to FamilyDescription when DetailDescription missing", () => {
    const info = { ...baseInfo, DetailDescription: "" };
    const result = mapMcMasterProduct(info, basePrices, "91251A193");
    expect(result.description).toBe("Socket Head Screws");
  });

  it("uses the lowest-quantity price as unitPrice", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.unitPrice).toBe(0.26);
  });

  it("uses MOQ from lowest price break", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.moq).toBe(1);
  });

  it("maps all price breaks correctly", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.priceBreaks).toHaveLength(3);
    expect(result.priceBreaks[0]).toEqual({ qty: 1, price: 0.26 });
    expect(result.priceBreaks[1]).toEqual({ qty: 10, price: 0.21 });
    expect(result.priceBreaks[2]).toEqual({ qty: 50, price: 0.17 });
  });

  it("handles empty price array", () => {
    const result = mapMcMasterProduct(baseInfo, [], "91251A193");
    expect(result.unitPrice).toBe(0);
    expect(result.priceBreaks).toHaveLength(0);
    expect(result.moq).toBe(1);
  });

  it("filters out price breaks with zero price", () => {
    const prices = [
      { MinimumQuantity: 1,  Amount: 0 },
      { MinimumQuantity: 10, Amount: 0.21 },
    ];
    const result = mapMcMasterProduct(baseInfo, prices, "91251A193");
    expect(result.priceBreaks).toHaveLength(1);
    expect(result.priceBreaks[0].price).toBe(0.21);
  });

  it("builds correct product URL", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.url).toBe("https://www.mcmaster.com/91251A193/");
  });

  it("extracts datasheet link from Links array", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.datasheet).toContain("91251a193.pdf");
  });

  it("sets datasheet to null when no Links", () => {
    const info = { ...baseInfo, Links: [] };
    const result = mapMcMasterProduct(info, basePrices, "91251A193");
    expect(result.datasheet).toBeNull();
  });

  it("always sets countryOfOrigin to US", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.countryOfOrigin).toBe("US");
  });

  it("sets stock to null (McMaster does not expose stock count)", () => {
    const result = mapMcMasterProduct(baseInfo, basePrices, "91251A193");
    expect(result.stock).toBeNull();
  });
});
