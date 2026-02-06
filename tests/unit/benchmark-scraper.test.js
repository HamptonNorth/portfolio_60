import { describe, test, expect } from "bun:test";
import { parseBenchmarkValue, extractDomain, calculateDelay, getDelayProfile } from "../../src/server/scrapers/benchmark-scraper.js";
import { SCRAPE_DELAY_PROFILES } from "../../src/shared/constants.js";

// --- parseBenchmarkValue: basic values ---

describe("parseBenchmarkValue - basic values", () => {
  test("parses a simple decimal number", () => {
    const result = parseBenchmarkValue("7890.1234");
    expect(result.value).toBe(7890.1234);
  });

  test("parses an integer", () => {
    const result = parseBenchmarkValue("7890");
    expect(result.value).toBe(7890);
  });

  test("parses a number with thousands comma", () => {
    const result = parseBenchmarkValue("7,890.12");
    expect(result.value).toBe(7890.12);
  });

  test("parses a number with multiple thousands commas", () => {
    const result = parseBenchmarkValue("1,234,567.89");
    expect(result.value).toBe(1234567.89);
  });
});

// --- parseBenchmarkValue: currency symbols ---

describe("parseBenchmarkValue - currency symbols", () => {
  test("strips pound sign", () => {
    const result = parseBenchmarkValue("£1,234.56");
    expect(result.value).toBe(1234.56);
  });

  test("strips dollar sign", () => {
    const result = parseBenchmarkValue("$1,234.56");
    expect(result.value).toBe(1234.56);
  });

  test("strips euro sign", () => {
    const result = parseBenchmarkValue("€99.99");
    expect(result.value).toBe(99.99);
  });

  test("strips yen sign", () => {
    const result = parseBenchmarkValue("¥15000");
    expect(result.value).toBe(15000);
  });
});

// --- parseBenchmarkValue: currency abbreviations ---

describe("parseBenchmarkValue - currency abbreviations", () => {
  test("strips leading GBP abbreviation", () => {
    const result = parseBenchmarkValue("GBP123.45");
    expect(result.value).toBe(123.45);
  });

  test("strips leading USD abbreviation with space", () => {
    const result = parseBenchmarkValue("USD 1,234.56");
    expect(result.value).toBe(1234.56);
  });

  test("strips trailing currency abbreviation", () => {
    const result = parseBenchmarkValue("123.45 EUR");
    expect(result.value).toBe(123.45);
  });

  test("strips lowercase p suffix", () => {
    const result = parseBenchmarkValue("123.45p");
    expect(result.value).toBe(123.45);
  });

  test("strips GBX suffix", () => {
    const result = parseBenchmarkValue("123.45GBX");
    expect(result.value).toBe(123.45);
  });
});

// --- parseBenchmarkValue: whitespace handling ---

describe("parseBenchmarkValue - whitespace handling", () => {
  test("trims leading and trailing whitespace", () => {
    const result = parseBenchmarkValue("  7890.12  ");
    expect(result.value).toBe(7890.12);
  });

  test("strips non-breaking spaces", () => {
    const result = parseBenchmarkValue("£\u00a07,890.12");
    expect(result.value).toBe(7890.12);
  });

  test("strips internal spaces", () => {
    const result = parseBenchmarkValue("7 890.12");
    expect(result.value).toBe(7890.12);
  });
});

// --- parseBenchmarkValue: negative values ---

describe("parseBenchmarkValue - negative values", () => {
  test("parses negative with minus sign", () => {
    const result = parseBenchmarkValue("-5.67");
    expect(result.value).toBe(-5.67);
  });

  test("parses negative with parentheses", () => {
    const result = parseBenchmarkValue("(123.45)");
    expect(result.value).toBe(-123.45);
  });
});

// --- parseBenchmarkValue: edge cases ---

describe("parseBenchmarkValue - edge cases", () => {
  test("returns null for empty string", () => {
    const result = parseBenchmarkValue("");
    expect(result.value).toBeNull();
  });

  test("returns null for null input", () => {
    const result = parseBenchmarkValue(null);
    expect(result.value).toBeNull();
  });

  test("returns null for undefined input", () => {
    const result = parseBenchmarkValue(undefined);
    expect(result.value).toBeNull();
  });

  test("returns null for non-numeric text", () => {
    const result = parseBenchmarkValue("N/A");
    expect(result.value).toBeNull();
  });

  test("returns null for purely alphabetic text", () => {
    const result = parseBenchmarkValue("Value unavailable");
    expect(result.value).toBeNull();
  });

  test("preserves raw text in output", () => {
    const result = parseBenchmarkValue("7,890.12");
    expect(result.raw).toBe("7,890.12");
  });

  test("preserves raw text even on failure", () => {
    const result = parseBenchmarkValue("N/A");
    expect(result.raw).toBe("N/A");
  });

  test("handles zero", () => {
    const result = parseBenchmarkValue("0.00");
    expect(result.value).toBe(0);
  });
});

// --- parseBenchmarkValue: real-world examples ---

describe("parseBenchmarkValue - real-world benchmark formats", () => {
  test("FTSE 100 index value", () => {
    const result = parseBenchmarkValue("7,890.23");
    expect(result.value).toBe(7890.23);
  });

  test("S&P 500 index value", () => {
    const result = parseBenchmarkValue("5,123.45");
    expect(result.value).toBe(5123.45);
  });

  test("Gold spot price in USD", () => {
    const result = parseBenchmarkValue("$2,034.56");
    expect(result.value).toBe(2034.56);
  });

  test("Gold spot price in GBP", () => {
    const result = parseBenchmarkValue("£1,623.78");
    expect(result.value).toBe(1623.78);
  });

  test("Large index value (Nikkei 225)", () => {
    const result = parseBenchmarkValue("38,456.78");
    expect(result.value).toBe(38456.78);
  });

  test("Very large index value (Dow Jones)", () => {
    const result = parseBenchmarkValue("42,123.45");
    expect(result.value).toBe(42123.45);
  });
});

// --- extractDomain ---

describe("extractDomain", () => {
  test("extracts hostname from a full URL", () => {
    expect(extractDomain("https://www.londonstockexchange.com/indices/ftse-100")).toBe("www.londonstockexchange.com");
  });

  test("extracts hostname from URL with path and query", () => {
    expect(extractDomain("https://www.goldprice.org/gold-price.html?currency=GBP")).toBe("www.goldprice.org");
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
    const delay = calculateDelay("www.goldprice.org", "www.goldprice.org");
    expect(delay).toBeGreaterThanOrEqual(profile.sameDomain.min);
    expect(delay).toBeLessThanOrEqual(profile.sameDomain.max);
  });

  test("returns a value within different-domain range for non-matching domains", () => {
    const profile = getDelayProfile();
    const delay = calculateDelay("www.goldprice.org", "www.londonstockexchange.com");
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
