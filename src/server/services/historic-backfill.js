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

    const response = await fetch(url);
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
 * @description Run the currency rate backfill. Fetches ~3 years of daily rates
 * from the Bank of England and inserts them into the currency_rates table.
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

  // Fetch all rates from BoE
  const rateRows = await fetchBoeRateHistory(startStr, endStr);

  progressCallback({
    type: "progress",
    message: "Received " + rateRows.length + " days of rate data. Inserting into database...",
  });

  // Build a lookup: currency code → database ID
  const currencyIdMap = {};
  for (const c of supportedCurrencies) {
    currencyIdMap[c.code] = c.id;
  }

  // Insert all rates
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
      message: c.code + ": " + countForCurrency + " rates inserted",
    });
  }

  progressCallback({
    type: "complete",
    message: "Currency rates complete: " + totalRates + " rates for " + currenciesUpdated.join(", "),
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
  const response = await fetch(url);

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
  const response = await fetch(url);

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
  const response = await fetch(url);

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

  // Fetch all investments with their currency code and morningstar_id
  const investments = db
    .query(
      `SELECT i.id, i.description, i.investment_url, i.morningstar_id,
              c.code AS currency_code
       FROM investments i
       JOIN currencies c ON i.currencies_id = c.id
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

      // Try ISIN extraction first (Fidelity URLs)
      const isin = extractIsinFromUrl(inv.investment_url);

      if (isin) {
        progressCallback({
          type: "progress",
          message: inv.description + ": looking up ISIN " + isin + "...",
        });
        lookupResult = await lookupMorningstarIdByIsin(isin);
      } else {
        // Try LSE ticker extraction
        const ticker = extractLseTickerFromUrl(inv.investment_url);

        if (ticker) {
          progressCallback({
            type: "progress",
            message: inv.description + ": looking up LSE ticker " + ticker + "...",
          });
          // Search by the investment description since Morningstar doesn't search by ticker directly
          lookupResult = await lookupMorningstarIdByName(inv.description);
        } else {
          progressCallback({
            type: "progress",
            message: inv.description + ": no ISIN or ticker found in URL, skipping",
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
