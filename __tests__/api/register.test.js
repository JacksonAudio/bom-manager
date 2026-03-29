// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isValidEmail, splitName } from "../../api/register.js";

// ─────────────────────────────────────────────
// isValidEmail
// ─────────────────────────────────────────────
describe("isValidEmail", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("brad@jacksonaudio.com")).toBe(true);
    expect(isValidEmail("user@example.org")).toBe(true);
    expect(isValidEmail("first.last@sub.domain.com")).toBe(true);
    expect(isValidEmail("user+tag@gmail.com")).toBe(true);
  });

  it("rejects emails with no @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("noatsign.com")).toBe(false);
  });

  it("rejects emails with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail(" user@example.com")).toBe(false);
  });

  it("rejects emails with no domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("rejects emails with no TLD", () => {
    expect(isValidEmail("user@domain")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });
});

// ─────────────────────────────────────────────
// splitName
// ─────────────────────────────────────────────
describe("splitName", () => {
  it("splits a two-word name", () => {
    expect(splitName("Brad Smith")).toEqual({ firstName: "Brad", lastName: "Smith" });
  });

  it("splits a multi-word last name", () => {
    expect(splitName("Juan de la Cruz")).toEqual({ firstName: "Juan", lastName: "de la Cruz" });
  });

  it("handles a single name (no last name)", () => {
    expect(splitName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });

  it("handles empty string", () => {
    expect(splitName("")).toEqual({ firstName: "", lastName: "" });
  });

  it("handles null/undefined gracefully", () => {
    expect(splitName(null)).toEqual({ firstName: "", lastName: "" });
    expect(splitName(undefined)).toEqual({ firstName: "", lastName: "" });
  });

  it("trims leading/trailing whitespace", () => {
    expect(splitName("  Brad Smith  ")).toEqual({ firstName: "Brad", lastName: "Smith" });
  });

  it("handles extra internal spaces", () => {
    // Multiple spaces between words should still work
    const result = splitName("Brad  Smith");
    expect(result.firstName).toBe("Brad");
    expect(result.lastName).toBe("Smith");
  });
});
