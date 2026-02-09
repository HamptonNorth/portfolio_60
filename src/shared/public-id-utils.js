/**
 * @description Utility functions for working with investment public identifiers.
 * A public_id is either an ISIN code (mutual funds) or an exchange:ticker code
 * (shares and investment trusts). These identifiers enable automatic price URL
 * generation via FT Markets without requiring manual URL and CSS selector entry.
 *
 * ISIN format: 2-letter country code + 10 alphanumeric characters (e.g. GB00B4PQW151)
 * Ticker format: EXCHANGE:SYMBOL (e.g. LSE:AZN, NYSE:AAPL)
 */

/**
 * @description Regex pattern for ISIN codes.
 * Exactly 12 characters: 2 uppercase letters (country) + 10 alphanumeric (NSIN + check digit).
 * @type {RegExp}
 */
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{10}$/;

/**
 * @description Regex pattern for exchange:ticker codes.
 * Exchange: 1-10 uppercase letters. Ticker: 1-10 uppercase letters, digits, or dots.
 * @type {RegExp}
 */
const TICKER_PATTERN = /^[A-Z]{1,10}:[A-Z0-9.]{1,10}$/;

/**
 * @description CSS selector used on FT Markets fund and equity tearsheet pages
 * to extract the current price/NAV value.
 * @type {string}
 */
const FT_MARKETS_SELECTOR = "span.mod-ui-data-list__value";

/**
 * @description Detect whether a public_id is an ISIN or an exchange:ticker.
 * @param {string} publicId - The public identifier to check
 * @returns {'isin'|'ticker'|null} The detected type, or null if empty/invalid
 */
export function detectPublicIdType(publicId) {
  if (!publicId || typeof publicId !== "string") {
    return null;
  }

  const trimmed = publicId.trim().toUpperCase();

  if (trimmed === "") {
    return null;
  }

  if (ISIN_PATTERN.test(trimmed)) {
    return "isin";
  }

  if (TICKER_PATTERN.test(trimmed)) {
    return "ticker";
  }

  return null;
}

/**
 * @description Validate a public_id string. Checks format and length.
 * @param {string} publicId - The public identifier to validate
 * @returns {{ valid: boolean, type: 'isin'|'ticker'|null, error?: string }}
 */
export function validatePublicId(publicId) {
  if (!publicId || typeof publicId !== "string" || publicId.trim() === "") {
    return { valid: true, type: null };
  }

  const trimmed = publicId.trim().toUpperCase();

  if (trimmed.length > 20) {
    return { valid: false, type: null, error: "Public ID must be 20 characters or fewer" };
  }

  const type = detectPublicIdType(trimmed);

  if (type === null) {
    return {
      valid: false,
      type: null,
      error: "Public ID must be an ISIN (e.g. GB00B4PQW151) or Exchange:Ticker (e.g. LSE:AZN)",
    };
  }

  return { valid: true, type: type };
}

/**
 * @description Build an FT Markets URL for a given public_id and currency code.
 * ISIN codes produce a funds tearsheet URL; ticker codes produce an equities
 * tearsheet URL.
 *
 * FT Markets URL formats:
 * - Funds:    https://markets.ft.com/data/funds/tearsheet/summary?s={ISIN}:{CURRENCY}
 * - Equities: https://markets.ft.com/data/equities/tearsheet/summary?s={TICKER}:{EXCHANGE}
 *
 * Note: FT uses TICKER:EXCHANGE order (e.g. AZN:LSE), which is the reverse of
 * our storage format EXCHANGE:TICKER (e.g. LSE:AZN).
 *
 * @param {string} publicId - The ISIN or exchange:ticker code
 * @param {string} currencyCode - The 3-letter currency code (e.g. "GBP", "USD")
 * @returns {string|null} The FT Markets URL, or null if publicId is invalid
 */
export function buildFtMarketsUrl(publicId, currencyCode) {
  if (!publicId || !currencyCode) {
    return null;
  }

  const trimmed = publicId.trim().toUpperCase();
  const currency = currencyCode.trim().toUpperCase();
  const type = detectPublicIdType(trimmed);

  if (type === "isin") {
    return "https://markets.ft.com/data/funds/tearsheet/summary?s=" + trimmed + ":" + currency;
  }

  if (type === "ticker") {
    // Our format: EXCHANGE:TICKER (e.g. LSE:AZN)
    // FT format: TICKER:EXCHANGE (e.g. AZN:LSE)
    const parts = trimmed.split(":");
    const exchange = parts[0];
    const ticker = parts[1];
    return "https://markets.ft.com/data/equities/tearsheet/summary?s=" + ticker + ":" + exchange;
  }

  return null;
}

/**
 * @description Build an alternate FT Markets URL for ISIN funds, swapping GBP↔GBX.
 * FT Markets lists some UK funds under GBP and others under GBX (pence sterling).
 * When the primary URL fails, the alternate currency suffix can be tried.
 *
 * Only applies to ISIN-based lookups with GBP or GBX currency. Returns null for
 * tickers, non-GBP/GBX currencies, or invalid input.
 *
 * @param {string} publicId - The ISIN code
 * @param {string} currencyCode - The 3-letter currency code (e.g. "GBP")
 * @returns {string|null} The alternate FT Markets URL, or null if not applicable
 */
export function buildFtMarketsAlternateUrl(publicId, currencyCode) {
  if (!publicId || !currencyCode) {
    return null;
  }

  const trimmed = publicId.trim().toUpperCase();
  const currency = currencyCode.trim().toUpperCase();
  const type = detectPublicIdType(trimmed);

  if (type !== "isin") {
    return null;
  }

  if (currency === "GBP") {
    return "https://markets.ft.com/data/funds/tearsheet/summary?s=" + trimmed + ":GBX";
  }

  if (currency === "GBX") {
    return "https://markets.ft.com/data/funds/tearsheet/summary?s=" + trimmed + ":GBP";
  }

  return null;
}

/**
 * @description Get the CSS selector for FT Markets tearsheet pages.
 * Works for both fund and equity pages.
 * @returns {string} The CSS selector string
 */
export function getFtMarketsSelector() {
  return FT_MARKETS_SELECTOR;
}

/**
 * @description Build a Fidelity UK search URL for a given ISIN code.
 * Used as the first step in the Fidelity fallback: search by ISIN to discover
 * the factsheet URL, then scrape the price from the factsheet page.
 *
 * Only works for ISIN-based public IDs (mutual funds). Returns null for
 * ticker-based IDs (equities) or invalid input.
 *
 * @param {string} isin - The ISIN code (e.g. "GB00BJS8SH10")
 * @returns {string|null} The Fidelity search URL, or null if not a valid ISIN
 */
export function buildFidelitySearchUrl(isin) {
  if (!isin || typeof isin !== "string") {
    return null;
  }

  const trimmed = isin.trim().toUpperCase();
  const type = detectPublicIdType(trimmed);

  if (type !== "isin") {
    return null;
  }

  return "https://www.fidelity.co.uk/search/?query=" + trimmed + "&host=www.fidelity.co.uk&referrerPageUrl=";
}
