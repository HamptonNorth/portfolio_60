import { describe, test, expect } from "bun:test";
import { parsePrice, normaliseToMinorUnit, extractDomain, calculateDelay, getDelayProfile } from "../../src/server/scrapers/price-scraper.js";
import { SCRAPE_DELAY_PROFILES } from "../../src/shared/constants.js";

// --- parsePrice: basic values (no unit indicator = assume minor units) ---

describe("parsePrice - basic values", () => {
  test("parses a simple decimal number as minor units", () => {
    const result = parsePrice("123.45");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });

  test("parses an integer as minor units", () => {
    const result = parsePrice("1500");
    expect(result.value).toBe(1500);
    expect(result.isMinorUnit).toBe(true);
  });

  test("parses a number with thousands comma as minor units", () => {
    const result = parsePrice("1,234.56");
    expect(result.value).toBe(1234.56);
    expect(result.isMinorUnit).toBe(true);
  });

  test("parses a number with multiple thousands commas as minor units", () => {
    const result = parsePrice("1,234,567.89");
    expect(result.value).toBe(1234567.89);
    expect(result.isMinorUnit).toBe(true);
  });
});

// --- parsePrice: currency symbols (major-unit indicators) ---

describe("parsePrice - currency symbols (major units)", () => {
  test("pound sign indicates major units", () => {
    const result = parsePrice("£123.45");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(false);
  });

  test("dollar sign indicates major units", () => {
    const result = parsePrice("$1,234.56");
    expect(result.value).toBe(1234.56);
    expect(result.isMinorUnit).toBe(false);
  });

  test("euro sign indicates major units", () => {
    const result = parsePrice("€99.99");
    expect(result.value).toBe(99.99);
    expect(result.isMinorUnit).toBe(false);
  });

  test("yen sign indicates major units", () => {
    const result = parsePrice("¥15000");
    expect(result.value).toBe(15000);
    expect(result.isMinorUnit).toBe(false);
  });

  test("leading GBP abbreviation indicates major units", () => {
    const result = parsePrice("GBP123.45");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(false);
  });

  test("leading USD abbreviation with space indicates major units", () => {
    const result = parsePrice("USD 1,234.56");
    expect(result.value).toBe(1234.56);
    expect(result.isMinorUnit).toBe(false);
  });

  test("trailing currency abbreviation indicates major units", () => {
    const result = parsePrice("123.45 EUR");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(false);
  });
});

// --- parsePrice: minor-unit notation ---

describe("parsePrice - minor-unit notation", () => {
  test("lowercase p suffix confirms minor units", () => {
    const result = parsePrice("123.45p");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });

  test("uppercase P suffix confirms minor units", () => {
    const result = parsePrice("123.45P");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });

  test("GBX suffix confirms minor units (case-insensitive)", () => {
    const result = parsePrice("123.45GBX");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });

  test("gbx suffix confirms minor units (lowercase)", () => {
    const result = parsePrice("123.45gbx");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });

  test("handles pence with comma thousands", () => {
    const result = parsePrice("1,234.56p");
    expect(result.value).toBe(1234.56);
    expect(result.isMinorUnit).toBe(true);
  });
});

// --- parsePrice: whitespace and non-breaking spaces ---

describe("parsePrice - whitespace handling", () => {
  test("trims leading and trailing whitespace", () => {
    const result = parsePrice("  123.45  ");
    expect(result.value).toBe(123.45);
  });

  test("strips non-breaking spaces", () => {
    const result = parsePrice("£\u00a0123.45");
    expect(result.value).toBe(123.45);
  });

  test("strips internal spaces", () => {
    const result = parsePrice("£ 1 234.56");
    expect(result.value).toBe(1234.56);
  });

  test("handles pence with trailing space before p", () => {
    const result = parsePrice("123.45 p");
    expect(result.value).toBe(123.45);
    expect(result.isMinorUnit).toBe(true);
  });
});

// --- parsePrice: negative values ---

describe("parsePrice - negative values", () => {
  test("parses negative with minus sign as minor units", () => {
    const result = parsePrice("-5.67");
    expect(result.value).toBe(-5.67);
    expect(result.isMinorUnit).toBe(true);
  });

  test("parses negative with parentheses as minor units", () => {
    const result = parsePrice("(123.45)");
    expect(result.value).toBe(-123.45);
    expect(result.isMinorUnit).toBe(true);
  });
});

// --- parsePrice: edge cases ---

describe("parsePrice - edge cases", () => {
  test("returns null for empty string", () => {
    const result = parsePrice("");
    expect(result.value).toBeNull();
    expect(result.isMinorUnit).toBe(false);
  });

  test("returns null for null input", () => {
    const result = parsePrice(null);
    expect(result.value).toBeNull();
  });

  test("returns null for undefined input", () => {
    const result = parsePrice(undefined);
    expect(result.value).toBeNull();
  });

  test("returns null for non-numeric text", () => {
    const result = parsePrice("N/A");
    expect(result.value).toBeNull();
  });

  test("returns null for purely alphabetic text", () => {
    const result = parsePrice("Price unavailable");
    expect(result.value).toBeNull();
  });

  test("preserves raw text in output", () => {
    const result = parsePrice("£1,234.56");
    expect(result.raw).toBe("£1,234.56");
  });

  test("preserves raw text even on failure", () => {
    const result = parsePrice("N/A");
    expect(result.raw).toBe("N/A");
  });

  test("handles very small decimal values as minor units", () => {
    const result = parsePrice("0.0045");
    expect(result.value).toBe(0.0045);
    expect(result.isMinorUnit).toBe(true);
  });

  test("handles zero", () => {
    const result = parsePrice("0.00");
    expect(result.value).toBe(0);
  });
});

// --- parsePrice: real-world LSE examples ---

describe("parsePrice - real-world price formats", () => {
  test("LSE share price in pence with suffix", () => {
    const result = parsePrice("2,345.50p");
    expect(result.value).toBe(2345.5);
    expect(result.isMinorUnit).toBe(true);
  });

  test("LSE share price in GBX", () => {
    const result = parsePrice("2345.50 GBX");
    expect(result.value).toBe(2345.5);
    expect(result.isMinorUnit).toBe(true);
  });

  test("LSE share price with no unit (assumes pence)", () => {
    const result = parsePrice("2345.50");
    expect(result.value).toBe(2345.5);
    expect(result.isMinorUnit).toBe(true);
  });

  test("GBP fund price in pounds", () => {
    const result = parsePrice("£12.3456");
    expect(result.value).toBe(12.3456);
    expect(result.isMinorUnit).toBe(false);
  });

  test("USD share price with dollar sign", () => {
    const result = parsePrice("$1,567.89");
    expect(result.value).toBe(1567.89);
    expect(result.isMinorUnit).toBe(false);
  });
});

// --- normaliseToMinorUnit ---

describe("normaliseToMinorUnit", () => {
  test("converts pounds to pence (major to minor)", () => {
    expect(normaliseToMinorUnit(7.0533, false)).toBe(705.33);
  });

  test("keeps pence as-is (already minor)", () => {
    expect(normaliseToMinorUnit(705.33, true)).toBe(705.33);
  });

  test("converts dollars to cents", () => {
    expect(normaliseToMinorUnit(156.78, false)).toBe(15678);
  });

  test("converts a whole number in major units", () => {
    expect(normaliseToMinorUnit(10, false)).toBe(1000);
  });

  test("handles zero", () => {
    expect(normaliseToMinorUnit(0, false)).toBe(0);
  });

  test("handles very small major-unit value", () => {
    expect(normaliseToMinorUnit(0.01, false)).toBe(1);
  });

  test("preserves 4 decimal places on minor-unit value", () => {
    expect(normaliseToMinorUnit(123.4567, true)).toBe(123.4567);
  });

  test("rounds to 4 decimal places", () => {
    expect(normaliseToMinorUnit(123.45678, true)).toBe(123.4568);
  });

  test("handles the £7.0533 example from LSE", () => {
    // £7.0533 is in major units -> 705.33 pence
    expect(normaliseToMinorUnit(7.0533, false)).toBe(705.33);
  });

  test("handles pence value with many decimals", () => {
    expect(normaliseToMinorUnit(2345.5678, true)).toBe(2345.5678);
  });

  test("LSE price with no unit: 2345.50 stays as 2345.50 pence", () => {
    // No unit indicator -> isMinorUnit=true -> no conversion
    expect(normaliseToMinorUnit(2345.5, true)).toBe(2345.5);
  });
});

// --- extractDomain ---

describe("extractDomain", () => {
  test("extracts hostname from a full URL", () => {
    expect(extractDomain("https://www.londonstockexchange.com/stock/ULVR/unilever-plc/company-page")).toBe("www.londonstockexchange.com");
  });

  test("extracts hostname from URL with path and query", () => {
    expect(extractDomain("https://www.fidelity.co.uk/factsheet-data/prices?id=123")).toBe("www.fidelity.co.uk");
  });

  test("returns empty string for null/undefined", () => {
    expect(extractDomain(null)).toBe("");
    expect(extractDomain(undefined)).toBe("");
    expect(extractDomain("")).toBe("");
  });

  test("returns empty string for invalid URL", () => {
    expect(extractDomain("not-a-url")).toBe("");
  });
});

// --- calculateDelay ---

describe("calculateDelay", () => {
  test("returns 0 for the first request (no previous domain)", () => {
    expect(calculateDelay("", "www.example.com")).toBe(0);
  });

  test("returns a value within same-domain range for matching domains", () => {
    const profile = getDelayProfile();
    const delay = calculateDelay("www.fidelity.co.uk", "www.fidelity.co.uk");
    expect(delay).toBeGreaterThanOrEqual(profile.sameDomain.min);
    expect(delay).toBeLessThanOrEqual(profile.sameDomain.max);
  });

  test("returns a value within different-domain range for non-matching domains", () => {
    const profile = getDelayProfile();
    const delay = calculateDelay("www.fidelity.co.uk", "www.londonstockexchange.com");
    expect(delay).toBeGreaterThanOrEqual(profile.differentDomain.min);
    expect(delay).toBeLessThanOrEqual(profile.differentDomain.max);
  });

  test("respects SCRAPE_DELAY_PROFILE env var", () => {
    const original = process.env.SCRAPE_DELAY_PROFILE;
    try {
      process.env.SCRAPE_DELAY_PROFILE = "cron";
      const delay = calculateDelay("www.example.com", "www.example.com");
      expect(delay).toBeGreaterThanOrEqual(SCRAPE_DELAY_PROFILES.cron.sameDomain.min);
      expect(delay).toBeLessThanOrEqual(SCRAPE_DELAY_PROFILES.cron.sameDomain.max);
    } finally {
      if (original === undefined) {
        delete process.env.SCRAPE_DELAY_PROFILE;
      } else {
        process.env.SCRAPE_DELAY_PROFILE = original;
      }
    }
  });

  test("falls back to default profile for unknown profile name", () => {
    const original = process.env.SCRAPE_DELAY_PROFILE;
    try {
      process.env.SCRAPE_DELAY_PROFILE = "nonexistent";
      const profile = getDelayProfile();
      expect(profile).toEqual(SCRAPE_DELAY_PROFILES.interactive);
    } finally {
      if (original === undefined) {
        delete process.env.SCRAPE_DELAY_PROFILE;
      } else {
        process.env.SCRAPE_DELAY_PROFILE = original;
      }
    }
  });
});
