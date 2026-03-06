/**
 * @description Morningstar API-based price scraper.
 * An alternative to the Playwright web scraper that fetches the latest price
 * for each investment via Morningstar's timeseries API (the same API used by
 * the "Load History" backfill feature). Much more reliable than browser-based
 * scraping — no Playwright, no CSS selectors, no anti-bot detection.
 *
 * Investments without a resolvable Morningstar ID (no ISIN, no ticker, no
 * cached morningstar_id) are flagged as "manually priced" and skipped.
 */

import { getDatabase } from "../db/connection.js";
import { getAllInvestments } from "../db/investments-db.js";
import { upsertPrice } from "../db/prices-db.js";
import { detectPublicIdType, extractTickerFromPublicId } from "../../shared/public-id-utils.js";
import {
  fetchMorningstarHistory,
  lookupMorningstarIdByIsin,
  lookupMorningstarIdByTicker,
  extractIsinFromUrl,
  extractLseTickerFromUrl,
} from "../services/historic-backfill.js";

// ---------------------------------------------------------------------------
// Morningstar ID resolution
// ---------------------------------------------------------------------------

/**
 * @description Resolve an investment to its Morningstar SecId and universe.
 * Checks the cached morningstar_id column first, then tries ISIN and ticker
 * lookups. Caches the result in the database on successful resolution.
 *
 * Resolution priority (mirrors loadBackfillInvestment):
 * 1. Cached morningstar_id column (format "secId|universe")
 * 2. ISIN from public_id
 * 3. ISIN extracted from URL (mutual funds only)
 * 4. Ticker from public_id (ticker or ETF format)
 * 5. Ticker extracted from LSE URL
 *
 * @param {Object} investment - Investment object from getAllInvestments()
 * @param {number} investment.id - Investment ID
 * @param {string} investment.public_id - Public identifier (ISIN, ticker, ETF)
 * @param {string} investment.investment_url - Investment URL
 * @param {string} investment.type_short - Investment type abbreviation
 * @param {string} [investment.morningstar_id] - Cached Morningstar ID
 * @returns {Promise<{secId: string, universe: string}|null>} Resolved ID or null
 */
async function resolveMorningstarId(investment) {
  // Step 1: Check cached morningstar_id
  if (investment.morningstar_id) {
    const parts = investment.morningstar_id.split("|");
    return {
      secId: parts[0],
      universe: parts[1] || "FOGBR$$ALL",
    };
  }

  let lookupResult = null;

  // Step 2: Check public_id for ISIN
  const publicIdType = detectPublicIdType(investment.public_id);
  let isin = null;

  if (publicIdType === "isin") {
    isin = investment.public_id.trim().toUpperCase();
  } else if (investment.type_short === "MUTUAL") {
    // Step 3: Extract ISIN from URL (mutual funds only — shares/trusts may
    // resolve to wrong exchange listing on Morningstar)
    isin = extractIsinFromUrl(investment.investment_url);
  }

  if (isin) {
    try {
      lookupResult = await lookupMorningstarIdByIsin(isin);
    } catch {
      // Lookup failed — continue to next method
    }
  }

  // Step 4: Ticker from public_id
  if (!lookupResult && (publicIdType === "ticker" || publicIdType === "etf")) {
    const tickerSymbol = extractTickerFromPublicId(investment.public_id);
    if (tickerSymbol) {
      try {
        lookupResult = await lookupMorningstarIdByTicker(tickerSymbol);
      } catch {
        // Lookup failed — continue to next method
      }
    }
  }

  // Step 5: Ticker extracted from LSE URL
  if (!lookupResult) {
    const ticker = extractLseTickerFromUrl(investment.investment_url);
    if (ticker) {
      try {
        lookupResult = await lookupMorningstarIdByTicker(ticker);
      } catch {
        // Lookup failed — all methods exhausted
      }
    }
  }

  if (!lookupResult) {
    return null;
  }

  // Cache the resolved ID in the database for future use
  const cachedValue = lookupResult.secId + "|" + lookupResult.universe;
  const db = getDatabase();
  db.run("UPDATE investments SET morningstar_id = ? WHERE id = ?", [cachedValue, investment.id]);

  return {
    secId: lookupResult.secId,
    universe: lookupResult.universe,
  };
}

// ---------------------------------------------------------------------------
// Latest price fetching
// ---------------------------------------------------------------------------

/**
 * @description Fetch the latest price for a single investment via the Morningstar
 * timeseries API. Uses daily frequency over the last 7 days to capture the most
 * recent trading day.
 *
 * Returns a result object in the same shape as scrapeSingleInvestmentPrice() so
 * the SSE handler and UI can process it identically.
 *
 * @param {Object} investment - Investment object (must include morningstar_id,
 *   public_id, type_short, investment_url, currency_code, id, description)
 * @returns {Promise<Object>} Price result with success, investmentId, rawPrice, etc.
 */
export async function fetchLatestMorningstarPrice(investment) {
  // Resolve Morningstar ID (uses cache or performs lookup)
  const resolved = await resolveMorningstarId(investment);

  if (!resolved) {
    return {
      success: false,
      investmentId: investment.id,
      description: investment.description,
      rawPrice: "",
      parsedPrice: null,
      isMinorUnit: false,
      priceMinorUnit: null,
      currency: investment.currency_code,
      error: "No Morningstar ID — manually priced",
      errorCode: "MANUALLY_PRICED",
      fallbackUsed: false,
      priceDate: null,
    };
  }

  // Fetch daily prices for the last 7 days to ensure we capture at least
  // one trading day (accounts for weekends and bank holidays)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  let history;
  try {
    history = await fetchMorningstarHistory(
      resolved.secId,
      resolved.universe,
      investment.currency_code,
      startStr,
      endStr,
      "daily",
    );
  } catch (err) {
    return {
      success: false,
      investmentId: investment.id,
      description: investment.description,
      rawPrice: "",
      parsedPrice: null,
      isMinorUnit: false,
      priceMinorUnit: null,
      currency: investment.currency_code,
      error: "Morningstar API error: " + err.message,
      errorCode: "API_ERROR",
      fallbackUsed: false,
      priceDate: null,
    };
  }

  if (!history || history.length === 0) {
    return {
      success: false,
      investmentId: investment.id,
      description: investment.description,
      rawPrice: "",
      parsedPrice: null,
      isMinorUnit: false,
      priceMinorUnit: null,
      currency: investment.currency_code,
      error: "Morningstar returned no price data",
      errorCode: "API_NO_DATA",
      fallbackUsed: false,
      priceDate: null,
    };
  }

  // Take the most recent entry (last in the array, sorted by date)
  const latest = history[history.length - 1];
  const price = latest.price;
  const priceDate = latest.date;
  const priceMinorUnit = price * 100;
  const scrapeTime = new Date().toTimeString().slice(0, 8);

  // Write price to database
  try {
    upsertPrice(investment.id, priceDate, scrapeTime, priceMinorUnit);
  } catch (err) {
    return {
      success: false,
      investmentId: investment.id,
      description: investment.description,
      rawPrice: String(price),
      parsedPrice: price,
      isMinorUnit: false,
      priceMinorUnit: priceMinorUnit,
      currency: investment.currency_code,
      error: "DB write error: " + err.message,
      errorCode: "DB_WRITE_ERROR",
      fallbackUsed: false,
      priceDate: priceDate,
    };
  }

  return {
    success: true,
    investmentId: investment.id,
    description: investment.description,
    rawPrice: String(price),
    parsedPrice: price,
    isMinorUnit: false,
    priceMinorUnit: priceMinorUnit,
    currency: investment.currency_code,
    error: "",
    errorCode: null,
    fallbackUsed: false,
    priceDate: priceDate,
  };
}

// ---------------------------------------------------------------------------
// Investment list for Morningstar method
// ---------------------------------------------------------------------------

/**
 * @description Get all investments eligible for Morningstar API price fetching.
 * Returns all investments with auto_scrape = 1 (not filtered by URL/selector
 * availability, since Morningstar uses the API not web scraping). Each investment
 * is tagged with morningstarResolvable: true/false based on whether it has a
 * cached morningstar_id or a public_id that can be looked up.
 *
 * @returns {Object[]} Array of investment objects with morningstarResolvable flag
 */
export function getMorningstarScrapeableInvestments() {
  const db = getDatabase();
  const investments = db
    .query(
      `SELECT
        i.id,
        i.currencies_id,
        i.investment_type_id,
        i.description,
        i.public_id,
        i.investment_url,
        i.selector,
        i.auto_scrape,
        i.morningstar_id,
        c.code AS currency_code,
        c.description AS currency_description,
        it.short_description AS type_short,
        it.description AS type_description
      FROM investments i
      JOIN currencies c ON i.currencies_id = c.id
      JOIN investment_types it ON i.investment_type_id = it.id
      WHERE i.auto_scrape = 1
      ORDER BY i.description`,
    )
    .all();

  return investments.map(function (inv) {
    // An investment is Morningstar-resolvable if it has a cached ID or a
    // public_id in a format we can look up (ISIN, ticker, ETF)
    const hasCache = Boolean(inv.morningstar_id);
    const publicIdType = detectPublicIdType(inv.public_id);
    const hasResolvablePublicId = publicIdType === "isin" || publicIdType === "ticker" || publicIdType === "etf";

    // Also check for ISIN extractable from URL (mutual funds) or ticker from LSE URL
    const hasIsinInUrl = inv.type_short === "MUTUAL" && Boolean(extractIsinFromUrl(inv.investment_url));
    const hasTickerInUrl = Boolean(extractLseTickerFromUrl(inv.investment_url));

    inv.morningstarResolvable = hasCache || hasResolvablePublicId || hasIsinInUrl || hasTickerInUrl;
    return inv;
  });
}
