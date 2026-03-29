// @vitest-environment node
import { describe, it, expect } from "vitest";
import { calcLeadTimeDays } from "../../api/shipstation.js";

describe("calcLeadTimeDays", () => {
  it("returns 0 for same timestamp order and ship", () => {
    expect(calcLeadTimeDays("2026-01-01T12:00:00.000Z", "2026-01-01T12:00:00.000Z")).toBe(0);
  });

  it("returns 1 for ship within ~24h of order", () => {
    // Ordered midnight, shipped 23:59 same day — rounds to 1 day
    expect(calcLeadTimeDays("2026-01-01T00:00:00.000Z", "2026-01-01T23:59:59.000Z")).toBe(1);
  });

  it("calculates lead time over multiple days", () => {
    expect(calcLeadTimeDays("2026-01-01", "2026-01-04")).toBe(3);
  });

  it("calculates lead time across month boundary", () => {
    expect(calcLeadTimeDays("2026-01-28", "2026-02-02")).toBe(5);
  });

  it("calculates lead time across year boundary", () => {
    expect(calcLeadTimeDays("2025-12-30", "2026-01-02")).toBe(3);
  });

  it("returns 0 when ship date is before order date (data error safety)", () => {
    // Should never happen in practice, but Math.max(0, ...) prevents negatives
    expect(calcLeadTimeDays("2026-01-10", "2026-01-08")).toBe(0);
  });

  it("returns null when orderDate is missing", () => {
    expect(calcLeadTimeDays(null, "2026-01-04")).toBeNull();
    expect(calcLeadTimeDays("", "2026-01-04")).toBeNull();
  });

  it("returns null when shipDate is missing", () => {
    expect(calcLeadTimeDays("2026-01-01", null)).toBeNull();
    expect(calcLeadTimeDays("2026-01-01", "")).toBeNull();
  });

  it("returns null when both dates are missing", () => {
    expect(calcLeadTimeDays(null, null)).toBeNull();
  });

  it("handles ISO datetime strings with time components", () => {
    // Orders placed at end of day, shipped at start of next day = 1 day
    expect(calcLeadTimeDays("2026-03-01T23:55:00Z", "2026-03-02T08:00:00Z")).toBe(0);
    // Orders placed Monday, shipped Wednesday = 2 days
    expect(calcLeadTimeDays("2026-03-02T08:00:00Z", "2026-03-04T08:00:00Z")).toBe(2);
  });
});
