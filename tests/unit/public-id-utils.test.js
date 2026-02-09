import { describe, test, expect } from "bun:test";
import { detectPublicIdType, validatePublicId, buildFtMarketsUrl, buildFtMarketsAlternateUrl, getFtMarketsSelector, buildFidelitySearchUrl } from "../../src/shared/public-id-utils.js";

// ---------------------------------------------------------------------------
// detectPublicIdType
// ---------------------------------------------------------------------------

describe("detectPublicIdType", function () {
  test("detects GB ISIN", function () {
    expect(detectPublicIdType("GB00B4PQW151")).toBe("isin");
  });

  test("detects IE ISIN", function () {
    expect(detectPublicIdType("IE00B5BMR087")).toBe("isin");
  });

  test("detects LU ISIN", function () {
    expect(detectPublicIdType("LU0078775011")).toBe("isin");
  });

  test("detects US ISIN", function () {
    expect(detectPublicIdType("US0378331005")).toBe("isin");
  });

  test("detects ISIN with lowercase (auto-uppercased)", function () {
    expect(detectPublicIdType("gb00b4pqw151")).toBe("isin");
  });

  test("detects LSE ticker", function () {
    expect(detectPublicIdType("LSE:AZN")).toBe("ticker");
  });

  test("detects NYSE ticker", function () {
    expect(detectPublicIdType("NYSE:AAPL")).toBe("ticker");
  });

  test("detects ticker with dot in symbol", function () {
    expect(detectPublicIdType("LSE:VWRL.L")).toBe("ticker");
  });

  test("detects ticker with lowercase (auto-uppercased)", function () {
    expect(detectPublicIdType("lse:azn")).toBe("ticker");
  });

  test("returns null for empty string", function () {
    expect(detectPublicIdType("")).toBeNull();
  });

  test("returns null for null", function () {
    expect(detectPublicIdType(null)).toBeNull();
  });

  test("returns null for undefined", function () {
    expect(detectPublicIdType(undefined)).toBeNull();
  });

  test("returns null for whitespace-only string", function () {
    expect(detectPublicIdType("   ")).toBeNull();
  });

  test("returns null for too-short ISIN", function () {
    expect(detectPublicIdType("GB00B4PQW15")).toBeNull();
  });

  test("returns null for too-long ISIN", function () {
    expect(detectPublicIdType("GB00B4PQW1512")).toBeNull();
  });

  test("returns null for random text", function () {
    expect(detectPublicIdType("hello world")).toBeNull();
  });

  test("returns null for ticker without exchange", function () {
    expect(detectPublicIdType("AZN")).toBeNull();
  });

  test("returns null for number-only string", function () {
    expect(detectPublicIdType("123456789012")).toBeNull();
  });

  test("detects ETF three-part code", function () {
    expect(detectPublicIdType("ISF:LSE:GBX")).toBe("etf");
  });

  test("detects ETF with longer ticker", function () {
    expect(detectPublicIdType("IH2O:LSE:GBX")).toBe("etf");
  });

  test("detects ETF with GBP currency", function () {
    expect(detectPublicIdType("VUSA:LSE:GBP")).toBe("etf");
  });

  test("detects ETF with lowercase (auto-uppercased)", function () {
    expect(detectPublicIdType("isf:lse:gbx")).toBe("etf");
  });

  test("returns null for ETF with invalid currency length", function () {
    expect(detectPublicIdType("ISF:LSE:GB")).toBeNull();
  });

  test("returns null for four-part code", function () {
    expect(detectPublicIdType("ISF:LSE:GBX:EXTRA")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePublicId
// ---------------------------------------------------------------------------

describe("validatePublicId", function () {
  test("valid ISIN returns valid with type isin", function () {
    const result = validatePublicId("GB00B4PQW151");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("isin");
    expect(result.error).toBeUndefined();
  });

  test("valid ticker returns valid with type ticker", function () {
    const result = validatePublicId("LSE:AZN");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("ticker");
    expect(result.error).toBeUndefined();
  });

  test("empty string returns valid with null type", function () {
    const result = validatePublicId("");
    expect(result.valid).toBe(true);
    expect(result.type).toBeNull();
  });

  test("null returns valid with null type", function () {
    const result = validatePublicId(null);
    expect(result.valid).toBe(true);
    expect(result.type).toBeNull();
  });

  test("undefined returns valid with null type", function () {
    const result = validatePublicId(undefined);
    expect(result.valid).toBe(true);
    expect(result.type).toBeNull();
  });

  test("string over 20 chars returns invalid", function () {
    const result = validatePublicId("ABCDEFGHIJKLMNOPQRSTU");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("20 characters");
  });

  test("invalid format returns invalid with error", function () {
    const result = validatePublicId("not-a-valid-id");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ISIN");
    expect(result.error).toContain("Exchange:Ticker");
  });

  test("partial ISIN returns invalid", function () {
    const result = validatePublicId("GB00B4PQW");
    expect(result.valid).toBe(false);
  });

  test("valid ETF returns valid with type etf", function () {
    const result = validatePublicId("ISF:LSE:GBX");
    expect(result.valid).toBe(true);
    expect(result.type).toBe("etf");
    expect(result.error).toBeUndefined();
  });

  test("invalid format error mentions all three formats", function () {
    const result = validatePublicId("not-valid");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ISIN");
    expect(result.error).toContain("Exchange:Ticker");
    expect(result.error).toContain("ETF");
  });
});

// ---------------------------------------------------------------------------
// buildFtMarketsUrl
// ---------------------------------------------------------------------------

describe("buildFtMarketsUrl", function () {
  test("ISIN produces funds tearsheet URL", function () {
    const url = buildFtMarketsUrl("GB00B4PQW151", "GBP");
    expect(url).toBe("https://markets.ft.com/data/funds/tearsheet/summary?s=GB00B4PQW151:GBP");
  });

  test("ISIN with different currency", function () {
    const url = buildFtMarketsUrl("IE00B5BMR087", "USD");
    expect(url).toBe("https://markets.ft.com/data/funds/tearsheet/summary?s=IE00B5BMR087:USD");
  });

  test("ticker produces equities tearsheet URL with reversed format", function () {
    const url = buildFtMarketsUrl("LSE:AZN", "GBP");
    // FT uses TICKER:EXCHANGE format (AZN:LSE), reversed from our LSE:AZN
    expect(url).toBe("https://markets.ft.com/data/equities/tearsheet/summary?s=AZN:LSE");
  });

  test("NYSE ticker produces correct URL", function () {
    const url = buildFtMarketsUrl("NYSE:AAPL", "USD");
    expect(url).toBe("https://markets.ft.com/data/equities/tearsheet/summary?s=AAPL:NYSE");
  });

  test("handles lowercase input", function () {
    const url = buildFtMarketsUrl("gb00b4pqw151", "gbp");
    expect(url).toBe("https://markets.ft.com/data/funds/tearsheet/summary?s=GB00B4PQW151:GBP");
  });

  test("returns null for null publicId", function () {
    expect(buildFtMarketsUrl(null, "GBP")).toBeNull();
  });

  test("returns null for empty publicId", function () {
    expect(buildFtMarketsUrl("", "GBP")).toBeNull();
  });

  test("returns null for null currencyCode", function () {
    expect(buildFtMarketsUrl("GB00B4PQW151", null)).toBeNull();
  });

  test("returns null for invalid publicId format", function () {
    expect(buildFtMarketsUrl("invalid", "GBP")).toBeNull();
  });

  test("ETF produces etfs tearsheet URL without reversal", function () {
    const url = buildFtMarketsUrl("ISF:LSE:GBX", "GBP");
    expect(url).toBe("https://markets.ft.com/data/etfs/tearsheet/summary?s=ISF:LSE:GBX");
  });

  test("ETF ignores currencyCode parameter", function () {
    const url = buildFtMarketsUrl("IH2O:LSE:GBX", "USD");
    expect(url).toBe("https://markets.ft.com/data/etfs/tearsheet/summary?s=IH2O:LSE:GBX");
  });

  test("ETF with lowercase input is uppercased", function () {
    const url = buildFtMarketsUrl("isf:lse:gbx", "GBP");
    expect(url).toBe("https://markets.ft.com/data/etfs/tearsheet/summary?s=ISF:LSE:GBX");
  });

  test("ETF works without currencyCode", function () {
    const url = buildFtMarketsUrl("ISF:LSE:GBX", null);
    expect(url).toBe("https://markets.ft.com/data/etfs/tearsheet/summary?s=ISF:LSE:GBX");
  });
});

// ---------------------------------------------------------------------------
// buildFtMarketsAlternateUrl
// ---------------------------------------------------------------------------

describe("buildFtMarketsAlternateUrl", function () {
  test("GBP ISIN returns GBX alternate URL", function () {
    const url = buildFtMarketsAlternateUrl("GB00BLG2W994", "GBP");
    expect(url).toBe("https://markets.ft.com/data/funds/tearsheet/summary?s=GB00BLG2W994:GBX");
  });

  test("GBX ISIN returns GBP alternate URL", function () {
    const url = buildFtMarketsAlternateUrl("GB00BLG2W994", "GBX");
    expect(url).toBe("https://markets.ft.com/data/funds/tearsheet/summary?s=GB00BLG2W994:GBP");
  });

  test("USD ISIN returns null (no alternate)", function () {
    expect(buildFtMarketsAlternateUrl("IE00B5BMR087", "USD")).toBeNull();
  });

  test("EUR ISIN returns null (no alternate)", function () {
    expect(buildFtMarketsAlternateUrl("LU1033663649", "EUR")).toBeNull();
  });

  test("ticker returns null (only applies to ISINs)", function () {
    expect(buildFtMarketsAlternateUrl("LSE:AZN", "GBP")).toBeNull();
  });

  test("null publicId returns null", function () {
    expect(buildFtMarketsAlternateUrl(null, "GBP")).toBeNull();
  });

  test("null currencyCode returns null", function () {
    expect(buildFtMarketsAlternateUrl("GB00BLG2W994", null)).toBeNull();
  });

  test("ETF returns null (no alternate needed)", function () {
    expect(buildFtMarketsAlternateUrl("ISF:LSE:GBX", "GBP")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFtMarketsSelector
// ---------------------------------------------------------------------------

describe("getFtMarketsSelector", function () {
  test("returns the expected CSS selector", function () {
    expect(getFtMarketsSelector()).toBe("span.mod-ui-data-list__value");
  });

  test("returns a non-empty string", function () {
    expect(getFtMarketsSelector().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildFidelitySearchUrl
// ---------------------------------------------------------------------------

describe("buildFidelitySearchUrl", function () {
  test("GB ISIN produces Fidelity search URL", function () {
    const url = buildFidelitySearchUrl("GB00BJS8SH10");
    expect(url).toBe("https://www.fidelity.co.uk/search/?query=GB00BJS8SH10&host=www.fidelity.co.uk&referrerPageUrl=");
  });

  test("IE ISIN produces Fidelity search URL", function () {
    const url = buildFidelitySearchUrl("IE00B42P0H75");
    expect(url).toBe("https://www.fidelity.co.uk/search/?query=IE00B42P0H75&host=www.fidelity.co.uk&referrerPageUrl=");
  });

  test("LU ISIN produces Fidelity search URL", function () {
    const url = buildFidelitySearchUrl("LU1033663649");
    expect(url).toBe("https://www.fidelity.co.uk/search/?query=LU1033663649&host=www.fidelity.co.uk&referrerPageUrl=");
  });

  test("handles lowercase ISIN input", function () {
    const url = buildFidelitySearchUrl("gb00bjs8sh10");
    expect(url).toBe("https://www.fidelity.co.uk/search/?query=GB00BJS8SH10&host=www.fidelity.co.uk&referrerPageUrl=");
  });

  test("returns null for ticker (not ISIN)", function () {
    expect(buildFidelitySearchUrl("LSE:AZN")).toBeNull();
  });

  test("returns null for null", function () {
    expect(buildFidelitySearchUrl(null)).toBeNull();
  });

  test("returns null for empty string", function () {
    expect(buildFidelitySearchUrl("")).toBeNull();
  });

  test("returns null for undefined", function () {
    expect(buildFidelitySearchUrl(undefined)).toBeNull();
  });

  test("returns null for invalid format", function () {
    expect(buildFidelitySearchUrl("not-an-isin")).toBeNull();
  });

  test("returns null for ETF (not ISIN)", function () {
    expect(buildFidelitySearchUrl("ISF:LSE:GBX")).toBeNull();
  });
});
