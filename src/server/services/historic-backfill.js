/**
 * @description Historic data backfill service for Portfolio 60.
 * Fetches ~3 years of weekly historic prices, currency rates, and benchmark
 * values from free public data sources and inserts them into the database.
 *
 * Data sources:
 * - Currency rates: Bank of England Statistical Interactive Database (CSV)
 * - Investment prices: Morningstar UK API (JSON) — added in Phase 2
 * - Benchmark values: Yahoo Finance via yahoo-finance2 (JSON) — added in Phase 3
 */

import { getDatabase } from "../db/connection.js";
import { upsertRate, scaleRate } from "../db/currency-rates-db.js";
import { upsertPrice } from "../db/prices-db.js";
import { upsertBenchmarkData } from "../db/benchmark-data-db.js";
import { detectPublicIdType, extractTickerFromPublicId } from "../../shared/public-id-utils.js";
import { getTestInvestmentById } from "../db/test-investments-db.js";
import YahooFinance from "yahoo-finance2";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * @description Mapping of currency codes to Bank of England series codes.
 * These are the BoE IADB series for spot exchange rates against Sterling.
 * Rates represent "how many units of foreign currency per 1 GBP".
 * @type {Object.<string, string>}
 */
const BOE_SERIES_CODES = {
  USD: "XUDLUSS",
  EUR: "XUDLERS",
  AUD: "XUDLADS",
  CAD: "XUDLCDS",
};

/**
 * @description Month name abbreviations used in BoE CSV date parsing.
 * BoE dates are formatted as "DD Mon YYYY" (e.g. "02 Jan 2026").
 * @type {Object.<string, string>}
 */
const MONTH_MAP = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

// ---------------------------------------------------------------------------
// Bank of England currency rate backfill
// ---------------------------------------------------------------------------

/**
 * @description Parse a BoE date string ("DD Mon YYYY") into ISO-8601 format.
 * @param {string} boeDateStr - Date string from BoE CSV (e.g. "02 Jan 2026")
 * @returns {string|null} ISO-8601 date string (e.g. "2026-01-02"), or null if unparseable
 */
function parseBoeDate(boeDateStr) {
  const trimmed = boeDateStr.trim();
  // Format: "DD Mon YYYY" — day may or may not be zero-padded
  const parts = trimmed.split(" ");
  if (parts.length !== 3) return null;

  const day = parts[0].padStart(2, "0");
  const monthNum = MONTH_MAP[parts[1]];
  const year = parts[2];

  if (!monthNum || !year || year.length !== 4) return null;

  return year + "-" + monthNum + "-" + day;
}

/**
 * @description Build the BoE IADB CSV download URL for a date range.
 * The BoE limits daily series requests to ~1 year per request.
 * @param {string} fromDate - Start date in "DD/Mon/YYYY" format (e.g. "07/Feb/2023")
 * @param {string} toDate - End date in "DD/Mon/YYYY" format (e.g. "06/Feb/2024")
 * @param {string} seriesCodes - Comma-separated BoE series codes
 * @returns {string} Full URL for CSV download
 */
function buildBoeUrl(fromDate, toDate, seriesCodes) {
  return "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" + "?csv.x=yes" + "&Datefrom=" + encodeURIComponent(fromDate) + "&Dateto=" + encodeURIComponent(toDate) + "&SeriesCodes=" + encodeURIComponent(seriesCodes) + "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";
}

/**
 * @description Format a Date object as "DD/Mon/YYYY" for BoE API requests.
 * @param {Date} date - The date to format
 * @returns {string} Formatted date (e.g. "07/Feb/2023")
 */
function formatBoeRequestDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return day + "/" + month + "/" + year;
}

/**
 * @description Parse BoE CSV response text into an array of rate objects.
 * Each row becomes one object with a date and rate values per currency.
 * Rows with missing rates (bank holidays) are skipped.
 * @param {string} csvText - Raw CSV text from BoE
 * @returns {{ date: string, rates: Object.<string, number> }[]} Parsed rate rows
 */
function parseBoeCsv(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  // First line is headers: DATE, XUDLUSS, XUDLERS, ...
  const headers = lines[0].split(",").map(function (h) {
    return h.trim();
  });

  // Build a reverse map: series code → currency code
  const seriesToCurrency = {};
  for (const [currency, series] of Object.entries(BOE_SERIES_CODES)) {
    seriesToCurrency[series] = currency;
  }

  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(",");
    const isoDate = parseBoeDate(values[0]);
    if (!isoDate) continue;

    const rates = {};
    let hasAnyRate = false;

    for (let j = 1; j < headers.length; j++) {
      const seriesCode = headers[j].trim();
      const currencyCode = seriesToCurrency[seriesCode];
      if (!currencyCode) continue;

      const rateStr = values[j] ? values[j].trim() : "";
      if (!rateStr) continue;

      const rate = parseFloat(rateStr);
      if (isNaN(rate)) continue;

      rates[currencyCode] = rate;
      hasAnyRate = true;
    }

    if (hasAnyRate) {
      results.push({ date: isoDate, rates: rates });
    }
  }

  return results;
}

/**
 * @description Fetch historic currency rates from the Bank of England.
 * Makes multiple requests in 1-year chunks to work within the BoE's
 * date range limit for daily series.
 * @param {string} startDate - ISO-8601 start date (YYYY-MM-DD)
 * @param {string} endDate - ISO-8601 end date (YYYY-MM-DD)
 * @returns {Promise<{ date: string, rates: Object.<string, number> }[]>} All rate rows, sorted by date
 */
export async function fetchBoeRateHistory(startDate, endDate) {
  const seriesCodes = Object.values(BOE_SERIES_CODES).join(",");

  // Split into ~1-year chunks (BoE limits daily series to ~1 year per request)
  const start = new Date(startDate);
  const end = new Date(endDate);
  const allResults = [];

  let chunkStart = new Date(start);

  while (chunkStart < end) {
    // Chunk end is 364 days later or the overall end date, whichever is sooner
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 364);
    if (chunkEnd > end) {
      chunkEnd.setTime(end.getTime());
    }

    const fromStr = formatBoeRequestDate(chunkStart);
    const toStr = formatBoeRequestDate(chunkEnd);
    const url = buildBoeUrl(fromStr, toStr, seriesCodes);

    const response = await fetch(url, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error("BoE request failed: HTTP " + response.status + " for " + fromStr + " to " + toStr);
    }

    const csvText = await response.text();
    const parsed = parseBoeCsv(csvText);
    allResults.push(...parsed);

    // Move to next chunk (day after current chunk end)
    chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);
  }

  // Sort by date ascending
  allResults.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });

  return allResults;
}

/**
 * @description Filter daily rate rows to weekly (Fridays only).
 * For each Friday in the date range, picks the rate from that Friday.
 * If a Friday has no data (bank holiday), falls back to the nearest
 * preceding weekday (Thursday, then Wednesday, etc.).
 * @param {{ date: string, rates: Object.<string, number> }[]} dailyRows - Daily rate rows sorted by date ascending
 * @returns {{ date: string, rates: Object.<string, number> }[]} Weekly rate rows (one per week)
 */
function filterToWeeklyFridays(dailyRows) {
  if (dailyRows.length === 0) return [];

  // Build a lookup: date string → row
  const dateMap = {};
  for (const row of dailyRows) {
    dateMap[row.date] = row;
  }

  // Find all Fridays in the date range
  const firstDate = new Date(dailyRows[0].date + "T12:00:00Z");
  const lastDate = new Date(dailyRows[dailyRows.length - 1].date + "T12:00:00Z");
  const weeklyRows = [];

  // Advance to the first Friday on or after the start date
  const current = new Date(firstDate);
  const dayOfWeek = current.getUTCDay(); // 0=Sun, 5=Fri
  const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 5 + 7 - dayOfWeek;
  current.setUTCDate(current.getUTCDate() + daysUntilFriday);

  while (current <= lastDate) {
    const fridayStr = current.toISOString().split("T")[0];

    // Try Friday first, then fall back to preceding weekdays
    let found = false;
    for (let offset = 0; offset < 5; offset++) {
      const tryDate = new Date(current);
      tryDate.setUTCDate(tryDate.getUTCDate() - offset);
      const tryStr = tryDate.toISOString().split("T")[0];

      if (dateMap[tryStr]) {
        weeklyRows.push(dateMap[tryStr]);
        found = true;
        break;
      }
    }

    // Move to next Friday
    current.setUTCDate(current.getUTCDate() + 7);
  }

  return weeklyRows;
}

/**
 * @description Run the currency rate backfill. Fetches ~3 years of daily rates
 * from the Bank of England, filters to weekly (Fridays), and inserts into
 * the currency_rates table.
 * @param {Function} progressCallback - Called with {type, message, count} updates
 * @returns {Promise<{totalRates: number, currenciesUpdated: string[]}>} Summary of what was inserted
 */
export async function backfillCurrencyRates(progressCallback) {
  const db = getDatabase();

  // Look up currency IDs for each non-GBP currency that has a BoE series
  const currencies = db.query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code").all();

  // Filter to only currencies we have BoE series for
  const supportedCurrencies = currencies.filter(function (c) {
    return BOE_SERIES_CODES[c.code];
  });

  if (supportedCurrencies.length === 0) {
    progressCallback({ type: "info", message: "No non-GBP currencies with BoE series codes found" });
    return { totalRates: 0, currenciesUpdated: [] };
  }

  // Calculate date range: ~3 years back from today
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  progressCallback({
    type: "progress",
    message: "Fetching currency rates from Bank of England (" + startStr + " to " + endStr + ")...",
  });

  // Fetch all daily rates from BoE, then filter to weekly (Fridays)
  const dailyRows = await fetchBoeRateHistory(startStr, endStr);
  const rateRows = filterToWeeklyFridays(dailyRows);

  progressCallback({
    type: "progress",
    message: "Received " + dailyRows.length + " daily rates, filtered to " + rateRows.length + " weekly (Fridays). Inserting...",
  });

  // Insert weekly rates
  let totalRates = 0;
  const currenciesUpdated = [];

  for (const c of supportedCurrencies) {
    let countForCurrency = 0;

    for (const row of rateRows) {
      const rate = row.rates[c.code];
      if (rate === undefined) continue;

      const scaledRate = scaleRate(rate);
      upsertRate(c.id, row.date, "00:00:00", scaledRate);
      countForCurrency++;
    }

    totalRates += countForCurrency;
    if (countForCurrency > 0) {
      currenciesUpdated.push(c.code);
    }

    progressCallback({
      type: "progress",
      message: c.code + ": " + countForCurrency + " weekly rates inserted",
    });
  }

  progressCallback({
    type: "complete",
    message: "Currency rates complete: " + totalRates + " weekly rates for " + currenciesUpdated.join(", "),
  });

  return { totalRates: totalRates, currenciesUpdated: currenciesUpdated };
}

// ---------------------------------------------------------------------------
// Morningstar investment price backfill (Phase 2)
// ---------------------------------------------------------------------------

/**
 * @description Base URL for the Morningstar UK screener API.
 * Used to look up a Morningstar SecId from an ISIN.
 * @type {string}
 */
const MORNINGSTAR_SCREENER_URL = "https://tools.morningstar.co.uk/api/rest.svc/9vehuxllxs/security/screener";

/**
 * @description Base URL for the Morningstar UK timeseries price API.
 * Used to fetch weekly historic prices for a given Morningstar SecId.
 * @type {string}
 */
const MORNINGSTAR_TIMESERIES_URL = "https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c";

/**
 * @description Base URL for the Morningstar UK security search API.
 * A lightweight search endpoint that covers securities (including investment trusts)
 * not indexed by the screener API. Returns pipe-delimited text, not JSON.
 * @type {string}
 */
const MORNINGSTAR_SEARCH_URL = "https://www.morningstar.co.uk/uk/util/SecuritySearch.ashx";

/** @type {number} Timeout in ms for Morningstar API requests (15 seconds). */
const MORNINGSTAR_FETCH_TIMEOUT_MS = 15000;

/**
 * @description Extract an ISIN from a Fidelity-style investment URL.
 * Handles two Fidelity URL formats:
 *   - /factsheet/GB00B41YBW71/...   (funds — ISIN after /factsheet/)
 *   - /factsheet-data/factsheet/IE00B1TXK627-ishares/...  (ETFs — ISIN before hyphen)
 * @param {string} url - The investment URL
 * @returns {string|null} The extracted ISIN, or null if not found
 */
export function extractIsinFromUrl(url) {
  if (!url) return null;
  // Fidelity URL formats after /factsheet/:
  //   GB00B41YBW71-fundsmith...        (GBP fund — ISIN then hyphen)
  //   US67066G1040USD-nvidia-corp      (USD share — ISIN then currency code then hyphen)
  //   IE0005042456-ishares             (ETF — ISIN then hyphen)
  // ISINs are exactly 12 characters: 2-letter country + 9 alphanumeric + 1 check digit.
  // For USD-priced shares, Fidelity appends the currency code (e.g. "USD") after the ISIN.
  // Match exactly 12 chars after /factsheet/, followed by either a hyphen, a 3-letter
  // currency code + hyphen, a slash, or end of string.
  const match = url.match(/factsheet\/([A-Z]{2}[A-Z0-9]{10})(?=[A-Z]{3}-|[-/]|$)/);
  return match ? match[1] : null;
}

/**
 * @description Extract a stock ticker from an LSE-style URL.
 * Looks for a short uppercase code after "/stock/" in the URL.
 * Example: "https://www.londonstockexchange.com/stock/PCT/..." → "PCT"
 * @param {string} url - The investment URL
 * @returns {string|null} The extracted ticker, or null if not found
 */
export function extractLseTickerFromUrl(url) {
  if (!url) return null;
  const match = url.match(/stock\/([A-Z]{2,5})\//);
  return match ? match[1] : null;
}

/**
 * @description Look up a Morningstar SecId by ISIN using the screener API.
 * Searches without a universe filter so it finds funds, equities, ETFs,
 * and investment trusts across all Morningstar universes.
 * @param {string} isin - The ISIN to look up
 * @returns {Promise<{secId: string, universe: string, name: string}|null>}
 *   The Morningstar SecId, universe, and name, or null if not found
 */
export async function lookupMorningstarIdByIsin(isin) {
  const params = new URLSearchParams({
    outputType: "json",
    version: "1",
    languageId: "en-GB",
    currencyId: "GBP",
    securityDataPoints: "SecId,Name,ISIN,Universe",
    filters: "ISIN:IN:" + isin,
    rows: "1",
  });

  const url = MORNINGSTAR_SCREENER_URL + "?" + params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error("Morningstar screener returned HTTP " + response.status);
  }

  const data = await response.json();
  const rows = data && data.rows;

  if (!rows || rows.length === 0) return null;

  const row = rows[0];

  return {
    secId: row.SecId,
    universe: row.Universe || "",
    name: row.Name,
  };
}

/**
 * @description Look up a Morningstar SecId by investment name using the screener API.
 * Used for LSE stocks/trusts where we have a ticker but no ISIN in the URL.
 * Searches without a universe filter to find across all security types.
 * @param {string} description - The investment description to search for
 * @returns {Promise<{secId: string, universe: string, name: string}|null>}
 *   The Morningstar SecId, universe, and name, or null if not found
 */
export async function lookupMorningstarIdByName(description) {
  const params = new URLSearchParams({
    outputType: "json",
    version: "1",
    languageId: "en-GB",
    currencyId: "GBP",
    securityDataPoints: "SecId,Name,ISIN,Universe",
    term: description,
    rows: "1",
  });

  const url = MORNINGSTAR_SCREENER_URL + "?" + params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error("Morningstar screener returned HTTP " + response.status);
  }

  const data = await response.json();
  const rows = data && data.rows;

  if (!rows || rows.length === 0) return null;

  const row = rows[0];

  return {
    secId: row.SecId,
    universe: row.Universe || "",
    name: row.Name,
  };
}

/**
 * @description Look up a Morningstar SecId by stock ticker symbol.
 * Tries three approaches in order:
 *   1. Screener API with Ticker filter (exact match, covers most equities/ETFs)
 *   2. SecuritySearch API (covers investment trusts and other securities not in the screener)
 *   3. Screener API with text-based term search (last resort)
 * @param {string} ticker - The ticker symbol (e.g. "BARC", "LLOY", "SSON")
 * @returns {Promise<{secId: string, universe: string, name: string}|null>}
 *   The Morningstar SecId, universe, and name, or null if not found
 */
export async function lookupMorningstarIdByTicker(ticker) {
  // Priority 1: screener API with exact ticker filter
  const filterParams = new URLSearchParams({
    outputType: "json",
    version: "1",
    languageId: "en-GB",
    currencyId: "GBP",
    securityDataPoints: "SecId,Name,ISIN,Universe,Ticker,ExchangeId",
    filters: "Ticker:IN:" + ticker,
    rows: "1",
  });

  const filterUrl = MORNINGSTAR_SCREENER_URL + "?" + filterParams.toString();
  const filterResponse = await fetch(filterUrl, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });

  if (!filterResponse.ok) {
    throw new Error("Morningstar screener returned HTTP " + filterResponse.status);
  }

  const filterData = await filterResponse.json();
  const filterRows = filterData && filterData.rows;

  if (filterRows && filterRows.length > 0) {
    const row = filterRows[0];
    return {
      secId: row.SecId,
      universe: row.Universe || "",
      name: row.Name,
    };
  }

  // Priority 2: SecuritySearch API (covers investment trusts not in the screener)
  const searchResult = await lookupMorningstarIdBySecuritySearch(ticker);
  if (searchResult) {
    return searchResult;
  }

  // Priority 3: fall back to text-based term search
  return lookupMorningstarIdByName(ticker);
}

/**
 * @description Look up a Morningstar SecId via the SecuritySearch.ashx endpoint.
 * This endpoint covers securities (especially closed-end investment trusts) that
 * are not indexed by the screener API. The response is pipe-delimited text, not JSON.
 * Matches are filtered to results where the ticker column exactly matches the query.
 * @param {string} ticker - The ticker symbol to search for
 * @returns {Promise<{secId: string, universe: string, name: string}|null>}
 */
async function lookupMorningstarIdBySecuritySearch(ticker) {
  const params = new URLSearchParams({
    q: ticker,
    limit: "10",
    preferedList: "",
    source: "nav",
  });

  const url = MORNINGSTAR_SEARCH_URL + "?" + params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  const lines = text.split("\n");

  // Each result line is pipe-delimited:
  // Name|{JSON metadata}|Type|Ticker|Exchange|Category
  // The JSON metadata contains: i=SecId, n=Name, s=Ticker, e=Exchange, t=type
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 5) continue;

    const resultTicker = (parts[3] || "").trim().toUpperCase();
    if (resultTicker !== ticker.toUpperCase()) continue;

    // Parse the JSON metadata to extract SecId
    try {
      const meta = JSON.parse(parts[1]);
      if (meta && meta.i) {
        // Determine universe from the type field and exchange
        // t=21 is closed-end fund, e=LSE exchange
        const exchange = (meta.e || "").toUpperCase();
        let universe = "";
        if (meta.t === 21 || meta.t === "21") {
          universe = "CEEXG$X" + (exchange === "LSE" ? "LON" : exchange) + "_3519";
        } else {
          universe = "E0EXG$X" + (exchange === "LSE" ? "LON" : exchange) + "_3520";
        }

        return {
          secId: meta.i,
          universe: universe,
          name: meta.n || parts[0] || "",
        };
      }
    } catch {
      // Skip malformed JSON metadata
    }
  }

  return null;
}

/**
 * @description Fetch weekly historic prices from Morningstar's timeseries API.
 * Requests prices in the investment's own currency (not GBP-converted) so the
 * app can apply its own currency conversion at valuation time.
 * @param {string} morningstarId - The Morningstar SecId
 * @param {string} universe - The Morningstar universe (e.g. "FOGBR$$ALL")
 * @param {string} currencyCode - The investment's currency (e.g. "GBP", "USD")
 * @param {string} startDate - ISO-8601 start date (YYYY-MM-DD)
 * @param {string} endDate - ISO-8601 end date (YYYY-MM-DD)
 * @returns {Promise<{date: string, price: number}[]>} Array of {date, price} where
 *   price is in major units (pounds, dollars) of the investment's currency
 */
export async function fetchMorningstarHistory(morningstarId, universe, currencyCode, startDate, endDate) {
  // Morningstar API uses a specific ID format that includes universe info
  // Format: {secId}]2]0]{universe} (with | replaced by ] in the id param)
  const idParam = morningstarId + "]2]0]" + universe;

  const params = new URLSearchParams({
    currencyId: currencyCode,
    idtype: "Morningstar",
    frequency: "weekly",
    outputType: "JSON",
    startDate: startDate,
    endDate: endDate,
    id: idParam,
  });

  const url = MORNINGSTAR_TIMESERIES_URL + "?" + params.toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(MORNINGSTAR_FETCH_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error("Morningstar timeseries returned HTTP " + response.status);
  }

  const data = await response.json();

  // Response structure: {TimeSeries: {Security: [{HistoryDetail: [{EndDate, Value}], Id}]}}
  // The Security array usually has one element per requested security.
  // Each HistoryDetail entry has EndDate (YYYY-MM-DD) and Value (string number).
  if (!data || !data.TimeSeries) return [];

  const security = data.TimeSeries.Security;
  if (!Array.isArray(security) || security.length === 0) return [];

  const historyDetail = security[0].HistoryDetail;
  if (!Array.isArray(historyDetail)) return [];

  const results = [];

  for (const entry of historyDetail) {
    const dateStr = entry.EndDate;
    const value = parseFloat(entry.Value);

    if (!dateStr || isNaN(value)) continue;

    results.push({
      date: dateStr.substring(0, 10),
      price: value,
    });
  }

  return results;
}

/**
 * @description Run the investment price backfill. For each investment:
 * 1. Extract ISIN from URL (or LSE ticker)
 * 2. Look up Morningstar SecId (caching in investments.morningstar_id)
 * 3. Fetch ~3 years of weekly prices
 * 4. Insert into the prices table
 * @param {Function} progressCallback - Called with {type, message, count} updates
 * @returns {Promise<{totalPrices: number, investmentsUpdated: number, skipped: string[]}>}
 */
export async function backfillInvestmentPrices(progressCallback) {
  const db = getDatabase();

  // Fetch all investments with their currency code, morningstar_id, and public_id
  const investments = db
    .query(
      `SELECT i.id, i.description, i.investment_url, i.morningstar_id,
              i.public_id, i.investment_type_id, c.code AS currency_code,
              it.short_description AS type_short
       FROM investments i
       JOIN currencies c ON i.currencies_id = c.id
       JOIN investment_types it ON i.investment_type_id = it.id
       ORDER BY i.description`,
    )
    .all();

  if (investments.length === 0) {
    progressCallback({ type: "info", message: "No investments found" });
    return { totalPrices: 0, investmentsUpdated: 0, skipped: [] };
  }

  // Calculate date range: ~3 years back from today
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  progressCallback({
    type: "progress",
    message: "Backfilling prices for " + investments.length + " investments (" + startStr + " to " + endStr + ")",
  });

  let totalPrices = 0;
  let investmentsUpdated = 0;
  const skipped = [];

  for (const inv of investments) {
    let morningstarId = inv.morningstar_id;
    let universe = null;

    // Step 1: If we don't have a cached Morningstar ID, look it up
    if (!morningstarId) {
      let lookupResult = null;

      // Priority 1: Check public_id for ISIN
      const publicIdType = detectPublicIdType(inv.public_id);
      let isin = null;

      if (publicIdType === "isin") {
        isin = inv.public_id.trim().toUpperCase();
      } else if (inv.type_short === "MUTUAL") {
        // Priority 2: Try ISIN extraction from URL (Fidelity fund URLs only).
        // Shares and trusts trade on exchanges — their Fidelity URLs embed an
        // ISIN that may resolve to the wrong exchange listing on Morningstar.
        isin = extractIsinFromUrl(inv.investment_url);
      }

      if (isin) {
        progressCallback({
          type: "progress",
          message: inv.description + ": looking up ISIN " + isin + "...",
        });
        lookupResult = await lookupMorningstarIdByIsin(isin);
      } else if (publicIdType === "ticker" || publicIdType === "etf") {
        // Priority 3: public_id is a ticker — search Morningstar by ticker symbol
        const tickerSymbol = extractTickerFromPublicId(inv.public_id);
        progressCallback({
          type: "progress",
          message: inv.description + ": looking up ticker " + tickerSymbol + "...",
        });
        lookupResult = await lookupMorningstarIdByTicker(tickerSymbol);
      } else {
        // Priority 4: Try LSE ticker extraction from URL
        const ticker = extractLseTickerFromUrl(inv.investment_url);

        if (ticker) {
          progressCallback({
            type: "progress",
            message: inv.description + ": looking up LSE ticker " + ticker + "...",
          });
          lookupResult = await lookupMorningstarIdByTicker(ticker);
        } else {
          progressCallback({
            type: "progress",
            message: inv.description + ": no ISIN or ticker found, skipping",
          });
          skipped.push(inv.description);
          continue;
        }
      }

      if (!lookupResult) {
        progressCallback({
          type: "progress",
          message: inv.description + ": Morningstar lookup returned no results, skipping",
        });
        skipped.push(inv.description);
        continue;
      }

      morningstarId = lookupResult.secId;
      universe = lookupResult.universe;

      // Cache the Morningstar ID and universe in the database for future runs
      // Store as "secId|universe" so we can split later
      const cachedValue = morningstarId + "|" + universe;
      db.run("UPDATE investments SET morningstar_id = ? WHERE id = ?", [cachedValue, inv.id]);

      progressCallback({
        type: "progress",
        message: inv.description + ": found Morningstar ID " + morningstarId + " (" + lookupResult.name + ")",
      });
    } else {
      // Parse cached value: "secId|universe"
      const parts = morningstarId.split("|");
      morningstarId = parts[0];
      universe = parts[1] || "FOGBR$$ALL";
    }

    // Step 2: Fetch weekly price history
    progressCallback({
      type: "progress",
      message: inv.description + ": fetching price history...",
    });

    let priceHistory;
    try {
      priceHistory = await fetchMorningstarHistory(morningstarId, universe, inv.currency_code, startStr, endStr);
    } catch (err) {
      progressCallback({
        type: "progress",
        message: inv.description + ": price fetch failed — " + err.message,
      });
      skipped.push(inv.description);
      continue;
    }

    if (priceHistory.length === 0) {
      progressCallback({
        type: "progress",
        message: inv.description + ": no price data returned",
      });
      skipped.push(inv.description);
      continue;
    }

    // Step 3: Insert prices into the database
    // Morningstar returns prices in major units (pounds, dollars).
    // upsertPrice() expects minor units (pence, cents), so multiply by 100.
    let countForInvestment = 0;

    for (const entry of priceHistory) {
      const priceInMinorUnits = entry.price * 100;
      upsertPrice(inv.id, entry.date, "00:00:00", priceInMinorUnits);
      countForInvestment++;
    }

    totalPrices += countForInvestment;
    investmentsUpdated++;

    progressCallback({
      type: "progress",
      message: inv.description + ": " + countForInvestment + " weekly prices inserted",
    });

    // Small delay between investments to be polite to Morningstar's API
    await new Promise(function (resolve) {
      setTimeout(resolve, 500);
    });
  }

  progressCallback({
    type: "complete",
    message: "Investment prices complete: " + totalPrices + " prices for " + investmentsUpdated + " investments" + (skipped.length > 0 ? ". Skipped: " + skipped.join(", ") : ""),
  });

  return { totalPrices: totalPrices, investmentsUpdated: investmentsUpdated, skipped: skipped };
}

// ---------------------------------------------------------------------------
// Yahoo Finance benchmark backfill (Phase 3)
// ---------------------------------------------------------------------------

/**
 * @description Mapping of benchmark descriptions to Yahoo Finance ticker symbols.
 * Keys are matched case-insensitively against the start of the benchmark description.
 * @type {Object.<string, string>}
 */
const YAHOO_TICKER_MAP = {
  "FTSE 100": "^FTSE",
  "FTSE 250": "^FTMC",
  "FTSE All Share": "^FTAS",
  "S&P 500": "^GSPC",
  Nasdaq: "^IXIC",
  "Dow Jones": "^DJI",
  "S&P Composite 1500": "^SP1500",
  "Vanguard FTSE All-World": "VWRL.L",
  "Vanguard Life Strategy 80%": "0P0001824G.L",
};

/**
 * @description Find the Yahoo Finance ticker for a benchmark by matching its
 * description against the known ticker map. Matches case-insensitively from
 * the start of the description.
 * @param {string} description - The benchmark description from the database
 * @returns {string|null} The Yahoo Finance ticker, or null if no match
 */
function matchYahooTicker(description) {
  const descLower = description.toLowerCase();

  for (const [prefix, ticker] of Object.entries(YAHOO_TICKER_MAP)) {
    if (descLower.startsWith(prefix.toLowerCase())) {
      return ticker;
    }
  }

  return null;
}

/**
 * @description Fetch weekly historic values for a benchmark from Yahoo Finance.
 * Uses the chart() API (historical() is deprecated). Handles the GBp vs GBP
 * distinction: when Yahoo returns currency "GBp" (pence), values are divided
 * by 100 to convert to pounds.
 * @param {string} yahooTicker - The Yahoo Finance ticker symbol
 * @param {string} startDate - ISO-8601 start date (YYYY-MM-DD)
 * @param {string} endDate - ISO-8601 end date (YYYY-MM-DD)
 * @returns {Promise<{date: string, value: number}[]>} Array of {date, value}
 *   where value is in the benchmark's natural units (index points or GBP price)
 */
export async function fetchYahooBenchmarkHistory(yahooTicker, startDate, endDate) {
  const yf = new YahooFinance({ suppressNotices: ["ripHistorical"] });

  const result = await yf.chart(yahooTicker, {
    period1: startDate,
    period2: endDate,
    interval: "1wk",
  });

  const isGBPence = result.meta && result.meta.currency === "GBp";
  const quotes = result.quotes || [];
  const results = [];

  for (const quote of quotes) {
    if (!quote.date || quote.close == null) continue;

    // Convert Date object to ISO-8601 string
    const dateStr = quote.date.toISOString().split("T")[0];

    // If Yahoo returns values in GBp (pence), divide by 100 to get pounds
    const value = isGBPence ? quote.close / 100 : quote.close;

    results.push({ date: dateStr, value: value });
  }

  return results;
}

/**
 * @description Run the benchmark value backfill. For each benchmark:
 * 1. Match description to Yahoo Finance ticker via YAHOO_TICKER_MAP
 * 2. Cache the ticker in benchmarks.yahoo_ticker
 * 3. Fetch ~3 years of weekly values
 * 4. Insert into the benchmark_data table
 * @param {Function} progressCallback - Called with {type, message} updates
 * @returns {Promise<{totalValues: number, benchmarksUpdated: number, skipped: string[]}>}
 */
export async function backfillBenchmarkValues(progressCallback) {
  const db = getDatabase();

  const benchmarks = db.query("SELECT id, description, yahoo_ticker FROM benchmarks ORDER BY description").all();

  if (benchmarks.length === 0) {
    progressCallback({ type: "info", message: "No benchmarks found" });
    return { totalValues: 0, benchmarksUpdated: 0, skipped: [] };
  }

  // Calculate date range: ~3 years back from today
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  progressCallback({
    type: "progress",
    message: "Backfilling values for " + benchmarks.length + " benchmarks (" + startStr + " to " + endStr + ")",
  });

  let totalValues = 0;
  let benchmarksUpdated = 0;
  const skipped = [];

  for (const bm of benchmarks) {
    // MSCI indexes have no free historic data API — skip them.
    // They are supported for live scraping via benchmark URL + selector only.
    if (bm.description.toLowerCase().includes("msci")) {
      progressCallback({
        type: "progress",
        message: bm.description + ": MSCI index — no free historic data source, skipping (live scraping only)",
      });
      skipped.push(bm.description);
      continue;
    }

    // Step 1: Determine Yahoo ticker
    let yahooTicker = bm.yahoo_ticker;

    if (!yahooTicker) {
      yahooTicker = matchYahooTicker(bm.description);

      if (!yahooTicker) {
        progressCallback({
          type: "progress",
          message: bm.description + ": no Yahoo Finance ticker mapping found, skipping",
        });
        skipped.push(bm.description);
        continue;
      }

      // Cache the ticker in the database
      db.run("UPDATE benchmarks SET yahoo_ticker = ? WHERE id = ?", [yahooTicker, bm.id]);

      progressCallback({
        type: "progress",
        message: bm.description + ": matched to Yahoo ticker " + yahooTicker,
      });
    }

    // Step 2: Fetch weekly history
    progressCallback({
      type: "progress",
      message: bm.description + ": fetching history from Yahoo Finance...",
    });

    let history;
    try {
      history = await fetchYahooBenchmarkHistory(yahooTicker, startStr, endStr);
    } catch (err) {
      progressCallback({
        type: "progress",
        message: bm.description + ": Yahoo Finance fetch failed — " + err.message,
      });
      skipped.push(bm.description);
      continue;
    }

    if (history.length === 0) {
      progressCallback({
        type: "progress",
        message: bm.description + ": no data returned from Yahoo Finance",
      });
      skipped.push(bm.description);
      continue;
    }

    // Step 3: Insert values into the database
    // upsertBenchmarkData() takes the value directly (index points or GBP price)
    // and scales by 10000 internally
    let countForBenchmark = 0;

    for (const entry of history) {
      upsertBenchmarkData(bm.id, entry.date, "00:00:00", entry.value);
      countForBenchmark++;
    }

    totalValues += countForBenchmark;
    benchmarksUpdated++;

    progressCallback({
      type: "progress",
      message: bm.description + ": " + countForBenchmark + " weekly values inserted",
    });

    // Small delay between benchmarks to be polite
    await new Promise(function (resolve) {
      setTimeout(resolve, 500);
    });
  }

  progressCallback({
    type: "complete",
    message: "Benchmark values complete: " + totalValues + " values for " + benchmarksUpdated + " benchmarks" + (skipped.length > 0 ? ". Skipped: " + skipped.join(", ") : ""),
  });

  return { totalValues: totalValues, benchmarksUpdated: benchmarksUpdated, skipped: skipped };
}

// ---------------------------------------------------------------------------
// Single-record test and load functions (Phase 4b)
// ---------------------------------------------------------------------------

/**
 * @description Test historic data availability for a single investment.
 * Fetches the 10 most recent weekly prices from Morningstar without writing to DB.
 * @param {number} investmentId - The investment ID
 * @returns {Promise<{success: boolean, description: string, rows: {date: string, price: number}[], error?: string}>}
 */
export async function testBackfillInvestment(investmentId) {
  const db = getDatabase();

  const inv = db
    .query(
      `SELECT i.id, i.description, i.investment_url, i.morningstar_id,
              i.public_id, c.code AS currency_code,
              it.short_description AS type_short
       FROM investments i
       JOIN currencies c ON i.currencies_id = c.id
       JOIN investment_types it ON i.investment_type_id = it.id
       WHERE i.id = ?`,
    )
    .get(investmentId);

  if (!inv) return { success: false, description: "Unknown", rows: [], error: "Investment not found" };

  // Resolve Morningstar ID
  let morningstarId = inv.morningstar_id;
  let universe = null;

  if (!morningstarId) {
    const publicIdType = detectPublicIdType(inv.public_id);
    let isin = null;

    if (publicIdType === "isin") {
      isin = inv.public_id.trim().toUpperCase();
    } else if (inv.type_short === "MUTUAL") {
      isin = extractIsinFromUrl(inv.investment_url);
    }

    let lookupResult = null;

    if (isin) {
      lookupResult = await lookupMorningstarIdByIsin(isin);
    } else if (publicIdType === "ticker" || publicIdType === "etf") {
      const tickerSymbol = extractTickerFromPublicId(inv.public_id);
      lookupResult = await lookupMorningstarIdByTicker(tickerSymbol);
    } else {
      const ticker = extractLseTickerFromUrl(inv.investment_url);
      if (ticker) {
        lookupResult = await lookupMorningstarIdByTicker(ticker);
      }
    }

    if (!lookupResult) {
      return { success: false, description: inv.description, rows: [], error: "Could not find on Morningstar" };
    }

    morningstarId = lookupResult.secId;
    universe = lookupResult.universe;
  } else {
    const parts = morningstarId.split("|");
    morningstarId = parts[0];
    universe = parts[1] || "FOGBR$$ALL";
  }

  // Fetch last ~3 months to get 10+ weekly data points
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const history = await fetchMorningstarHistory(morningstarId, universe, inv.currency_code, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  // Return last 10 entries, most recent first
  const rows = history
    .slice(-10)
    .reverse()
    .map(function (entry) {
      return { date: entry.date, price: entry.price };
    });

  return { success: true, description: inv.description, currency: inv.currency_code, rows: rows };
}

/**
 * @description Test historic data availability for a single test investment.
 * Same as testBackfillInvestment but reads from the test_investments table.
 * Fetches the 10 most recent weekly prices from Morningstar without writing to DB.
 * Does not cache the Morningstar ID (test_investments lacks the morningstar_id column).
 * @param {number} testInvestmentId - The test investment ID
 * @returns {Promise<{success: boolean, description: string, currency: string, rows: {date: string, price: number}[], error?: string}>}
 */
export async function testBackfillTestInvestment(testInvestmentId) {
  const inv = getTestInvestmentById(testInvestmentId);

  if (!inv) return { success: false, description: "Unknown", currency: "", rows: [], error: "Test investment not found" };

  // Resolve Morningstar ID (no caching — test_investments has no morningstar_id column)
  const publicIdType = detectPublicIdType(inv.public_id);
  let isin = null;

  if (publicIdType === "isin") {
    isin = inv.public_id.trim().toUpperCase();
  } else if (inv.type_short === "MUTUAL") {
    // Only extract ISINs from URLs for mutual funds. Shares and trusts
    // may have ISINs embedded in Fidelity URLs that resolve to the wrong
    // exchange listing on Morningstar.
    isin = extractIsinFromUrl(inv.investment_url);
  }

  let lookupResult = null;

  if (isin) {
    lookupResult = await lookupMorningstarIdByIsin(isin);
  } else if (publicIdType === "ticker" || publicIdType === "etf") {
    const tickerSymbol = extractTickerFromPublicId(inv.public_id);
    lookupResult = await lookupMorningstarIdByTicker(tickerSymbol);
  } else {
    const ticker = extractLseTickerFromUrl(inv.investment_url);
    if (ticker) {
      lookupResult = await lookupMorningstarIdByTicker(ticker);
    }
  }

  if (!lookupResult) {
    return { success: false, description: inv.description, currency: inv.currency_code, rows: [], error: "Could not find on Morningstar" };
  }

  const morningstarId = lookupResult.secId;
  const universe = lookupResult.universe;

  // Fetch last ~3 months to get 10+ weekly data points
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const history = await fetchMorningstarHistory(morningstarId, universe, inv.currency_code, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  // Return last 10 entries, most recent first
  const rows = history
    .slice(-10)
    .reverse()
    .map(function (entry) {
      return { date: entry.date, price: entry.price };
    });

  return { success: true, description: inv.description, currency: inv.currency_code, rows: rows };
}

/**
 * @description Load historic prices for a single investment (full 3-year backfill).
 * @param {number} investmentId - The investment ID
 * @returns {Promise<{success: boolean, description: string, count: number, error?: string}>}
 */
export async function loadBackfillInvestment(investmentId) {
  const db = getDatabase();

  const inv = db
    .query(
      `SELECT i.id, i.description, i.investment_url, i.morningstar_id,
              i.public_id, c.code AS currency_code,
              it.short_description AS type_short
       FROM investments i
       JOIN currencies c ON i.currencies_id = c.id
       JOIN investment_types it ON i.investment_type_id = it.id
       WHERE i.id = ?`,
    )
    .get(investmentId);

  if (!inv) return { success: false, description: "Unknown", count: 0, error: "Investment not found" };

  let morningstarId = inv.morningstar_id;
  let universe = null;

  if (!morningstarId) {
    const publicIdType = detectPublicIdType(inv.public_id);
    let isin = null;

    if (publicIdType === "isin") {
      isin = inv.public_id.trim().toUpperCase();
    } else if (inv.type_short === "MUTUAL") {
      isin = extractIsinFromUrl(inv.investment_url);
    }

    let lookupResult = null;

    if (isin) {
      lookupResult = await lookupMorningstarIdByIsin(isin);
    } else if (publicIdType === "ticker" || publicIdType === "etf") {
      const tickerSymbol = extractTickerFromPublicId(inv.public_id);
      lookupResult = await lookupMorningstarIdByTicker(tickerSymbol);
    } else {
      const ticker = extractLseTickerFromUrl(inv.investment_url);
      if (ticker) {
        lookupResult = await lookupMorningstarIdByTicker(ticker);
      }
    }

    if (!lookupResult) {
      return { success: false, description: inv.description, count: 0, error: "Could not find on Morningstar" };
    }

    morningstarId = lookupResult.secId;
    universe = lookupResult.universe;

    const cachedValue = morningstarId + "|" + universe;
    db.run("UPDATE investments SET morningstar_id = ? WHERE id = ?", [cachedValue, inv.id]);
  } else {
    const parts = morningstarId.split("|");
    morningstarId = parts[0];
    universe = parts[1] || "FOGBR$$ALL";
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const history = await fetchMorningstarHistory(morningstarId, universe, inv.currency_code, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  let count = 0;
  for (const entry of history) {
    const priceInMinorUnits = entry.price * 100;
    upsertPrice(inv.id, entry.date, "00:00:00", priceInMinorUnits);
    count++;
  }

  return { success: true, description: inv.description, count: count };
}

/**
 * @description Test historic data availability for a single currency.
 * Fetches the 10 most recent weekly rates from BoE without writing to DB.
 * @param {number} currencyId - The currency ID
 * @returns {Promise<{success: boolean, code: string, rows: {date: string, rate: number}[], error?: string}>}
 */
export async function testBackfillCurrency(currencyId) {
  const db = getDatabase();

  const currency = db.query("SELECT id, code FROM currencies WHERE id = ?").get(currencyId);

  if (!currency) return { success: false, code: "Unknown", rows: [], error: "Currency not found" };
  if (currency.code === "GBP") return { success: false, code: "GBP", rows: [], error: "GBP is the base currency — no exchange rate needed" };
  if (!BOE_SERIES_CODES[currency.code]) return { success: false, code: currency.code, rows: [], error: "No Bank of England series code for " + currency.code };

  // Fetch last ~3 months of daily rates, filter to weekly
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const dailyRows = await fetchBoeRateHistory(startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  const weeklyRows = filterToWeeklyFridays(dailyRows);

  // Return last 10, most recent first
  const rows = weeklyRows
    .slice(-10)
    .reverse()
    .filter(function (row) {
      return row.rates[currency.code] !== undefined;
    })
    .map(function (row) {
      return { date: row.date, rate: row.rates[currency.code] };
    });

  return { success: true, code: currency.code, rows: rows };
}

/**
 * @description Load historic rates for a single currency (full 3-year backfill, weekly Fridays).
 * @param {number} currencyId - The currency ID
 * @returns {Promise<{success: boolean, code: string, count: number, error?: string}>}
 */
export async function loadBackfillCurrency(currencyId) {
  const db = getDatabase();

  const currency = db.query("SELECT id, code FROM currencies WHERE id = ?").get(currencyId);

  if (!currency) return { success: false, code: "Unknown", count: 0, error: "Currency not found" };
  if (currency.code === "GBP") return { success: false, code: "GBP", count: 0, error: "GBP is the base currency — no exchange rate needed" };
  if (!BOE_SERIES_CODES[currency.code]) return { success: false, code: currency.code, count: 0, error: "No Bank of England series code for " + currency.code };

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const dailyRows = await fetchBoeRateHistory(startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  const weeklyRows = filterToWeeklyFridays(dailyRows);

  let count = 0;
  for (const row of weeklyRows) {
    const rate = row.rates[currency.code];
    if (rate === undefined) continue;

    const scaledRate = scaleRate(rate);
    upsertRate(currency.id, row.date, "00:00:00", scaledRate);
    count++;
  }

  return { success: true, code: currency.code, count: count };
}

/**
 * @description Test historic data availability for a single benchmark.
 * Fetches the 10 most recent weekly values from Yahoo Finance without writing to DB.
 * @param {number} benchmarkId - The benchmark ID
 * @returns {Promise<{success: boolean, description: string, rows: {date: string, value: number}[], error?: string}>}
 */
export async function testBackfillBenchmark(benchmarkId) {
  const db = getDatabase();

  const bm = db.query("SELECT id, description, yahoo_ticker FROM benchmarks WHERE id = ?").get(benchmarkId);

  if (!bm) return { success: false, description: "Unknown", rows: [], error: "Benchmark not found" };

  if (bm.description.toLowerCase().includes("msci")) {
    return { success: false, description: bm.description, rows: [], error: "MSCI indexes have no free historic data source (live scraping only)" };
  }

  let yahooTicker = bm.yahoo_ticker || matchYahooTicker(bm.description);

  if (!yahooTicker) {
    return { success: false, description: bm.description, rows: [], error: "No Yahoo Finance ticker mapping found" };
  }

  // Fetch last ~3 months
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const history = await fetchYahooBenchmarkHistory(yahooTicker, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  const rows = history
    .slice(-10)
    .reverse()
    .map(function (entry) {
      return { date: entry.date, value: entry.value };
    });

  return { success: true, description: bm.description, yahooTicker: yahooTicker, rows: rows };
}

/**
 * @description Load historic values for a single benchmark (full 3-year backfill).
 * @param {number} benchmarkId - The benchmark ID
 * @returns {Promise<{success: boolean, description: string, count: number, error?: string}>}
 */
export async function loadBackfillBenchmark(benchmarkId) {
  const db = getDatabase();

  const bm = db.query("SELECT id, description, yahoo_ticker FROM benchmarks WHERE id = ?").get(benchmarkId);

  if (!bm) return { success: false, description: "Unknown", count: 0, error: "Benchmark not found" };

  if (bm.description.toLowerCase().includes("msci")) {
    return { success: false, description: bm.description, count: 0, error: "MSCI indexes have no free historic data source (live scraping only)" };
  }

  let yahooTicker = bm.yahoo_ticker || matchYahooTicker(bm.description);

  if (!yahooTicker) {
    return { success: false, description: bm.description, count: 0, error: "No Yahoo Finance ticker mapping found" };
  }

  // Cache the ticker if not already cached
  if (!bm.yahoo_ticker) {
    db.run("UPDATE benchmarks SET yahoo_ticker = ? WHERE id = ?", [yahooTicker, bm.id]);
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);

  const history = await fetchYahooBenchmarkHistory(yahooTicker, startDate.toISOString().split("T")[0], endDate.toISOString().split("T")[0]);

  let count = 0;
  for (const entry of history) {
    upsertBenchmarkData(bm.id, entry.date, "00:00:00", entry.value);
    count++;
  }

  return { success: true, description: bm.description, count: count };
}
