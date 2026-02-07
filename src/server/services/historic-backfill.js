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
  return (
    "https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp" +
    "?csv.x=yes" +
    "&Datefrom=" + encodeURIComponent(fromDate) +
    "&Dateto=" + encodeURIComponent(toDate) +
    "&SeriesCodes=" + encodeURIComponent(seriesCodes) +
    "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N"
  );
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
  const currencies = db
    .query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code")
    .all();

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
