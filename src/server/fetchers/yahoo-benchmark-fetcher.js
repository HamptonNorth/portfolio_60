/**
 * @description Yahoo Finance API-based benchmark fetcher.
 * Fetches the latest value for each benchmark via Yahoo Finance's chart API
 * (the same API used by the "Load History" backfill feature).
 *
 * Benchmarks without a resolvable Yahoo ticker (e.g. MSCI indexes) are
 * flagged as "no API source" and skipped.
 */

import { getDatabase } from "../db/connection.js";
import { getAllBenchmarks } from "../db/benchmarks-db.js";
import { upsertBenchmarkData } from "../db/benchmark-data-db.js";
import {
  matchYahooTicker,
  fetchYahooBenchmarkHistory,
} from "../services/historic-backfill.js";

// ---------------------------------------------------------------------------
// Yahoo ticker resolution
// ---------------------------------------------------------------------------

/**
 * @description Resolve a benchmark to its Yahoo Finance ticker symbol.
 * Checks the cached yahoo_ticker column first, then tries matching the
 * benchmark description against the known ticker map. Caches the result
 * in the database on successful resolution.
 *
 * @param {Object} benchmark - Benchmark object from getAllBenchmarks()
 * @param {number} benchmark.id - Benchmark ID
 * @param {string} benchmark.description - Benchmark description
 * @param {string} [benchmark.yahoo_ticker] - Cached Yahoo ticker
 * @returns {string|null} Yahoo Finance ticker or null if unresolvable
 */
function resolveBenchmarkTicker(benchmark) {
  // Step 1: Check cached yahoo_ticker
  if (benchmark.yahoo_ticker) {
    return benchmark.yahoo_ticker;
  }

  // Step 2: Match description against known ticker map
  const ticker = matchYahooTicker(benchmark.description);

  if (!ticker) {
    return null;
  }

  // Cache the resolved ticker in the database for future use
  const db = getDatabase();
  db.run("UPDATE benchmarks SET yahoo_ticker = ? WHERE id = ?", [ticker, benchmark.id]);

  return ticker;
}

// ---------------------------------------------------------------------------
// Latest value fetching
// ---------------------------------------------------------------------------

/**
 * @description Fetch the latest value for a single benchmark via the Yahoo
 * Finance chart API. Uses weekly frequency over the last 14 days to capture
 * the most recent trading day.
 *
 * Returns a result object compatible with the SSE handler and UI.
 *
 * @param {Object} benchmark - Benchmark object (must include yahoo_ticker,
 *   id, description, benchmark_type, currency_code)
 * @returns {Promise<Object>} Benchmark result with success, benchmarkId, etc.
 */
export async function fetchLatestYahooBenchmarkValue(benchmark) {
  // Resolve Yahoo ticker (uses cache or performs lookup)
  const ticker = resolveBenchmarkTicker(benchmark);

  if (!ticker) {
    return {
      success: false,
      benchmarkId: benchmark.id,
      description: benchmark.description,
      benchmarkType: benchmark.benchmark_type,
      rawValue: "",
      parsedValue: null,
      currency: benchmark.currency_code || "",
      error: "No Yahoo Finance ticker",
      errorCode: "NO_YAHOO_TICKER",
      valueDate: null,
    };
  }

  // Use daily interval over 14 days to get the most recent trading day's
  // closing value. Daily interval is more reliable than weekly when US
  // markets are open — weekly interval can return no data for short date
  // ranges on live-market tickers like ^DJI, ^GSPC, ^IXIC.
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  let history;
  try {
    history = await fetchYahooBenchmarkHistory(ticker, startStr, endStr, "1d");
  } catch (err) {
    return {
      success: false,
      benchmarkId: benchmark.id,
      description: benchmark.description,
      benchmarkType: benchmark.benchmark_type,
      rawValue: "",
      parsedValue: null,
      currency: benchmark.currency_code || "",
      error: "Yahoo Finance API error: " + err.message,
      errorCode: "API_ERROR",
      valueDate: null,
    };
  }

  if (!history || history.length === 0) {
    return {
      success: false,
      benchmarkId: benchmark.id,
      description: benchmark.description,
      benchmarkType: benchmark.benchmark_type,
      rawValue: "",
      parsedValue: null,
      currency: benchmark.currency_code || "",
      error: "Yahoo Finance returned no data",
      errorCode: "API_NO_DATA",
      valueDate: null,
    };
  }

  // Take the most recent entry (last in the array, sorted by date)
  const latest = history[history.length - 1];
  const value = latest.value;
  const valueDate = latest.date;
  const fetchTime = new Date().toTimeString().slice(0, 8);

  // Write value to database
  try {
    upsertBenchmarkData(benchmark.id, valueDate, fetchTime, value);
  } catch (err) {
    return {
      success: false,
      benchmarkId: benchmark.id,
      description: benchmark.description,
      benchmarkType: benchmark.benchmark_type,
      rawValue: String(value),
      parsedValue: value,
      currency: benchmark.currency_code || "",
      error: "DB write error: " + err.message,
      errorCode: "DB_WRITE_ERROR",
      valueDate: valueDate,
    };
  }

  return {
    success: true,
    benchmarkId: benchmark.id,
    description: benchmark.description,
    benchmarkType: benchmark.benchmark_type,
    rawValue: String(value),
    parsedValue: value,
    currency: benchmark.currency_code || "",
    error: "",
    errorCode: null,
    valueDate: valueDate,
  };
}

// ---------------------------------------------------------------------------
// Benchmark list for Yahoo Finance method
// ---------------------------------------------------------------------------

/**
 * @description Get all benchmarks eligible for Yahoo Finance API value fetching.
 * Returns all benchmarks. Each benchmark is tagged with
 * yahooResolvable: true/false based on whether it has a cached yahoo_ticker
 * or a description that matches the known ticker map.
 *
 * @returns {Object[]} Array of benchmark objects with yahooResolvable flag
 */
export function getYahooFetchableBenchmarks() {
  const db = getDatabase();
  const benchmarks = db
    .query(
      `SELECT
        b.id,
        b.currencies_id,
        b.benchmark_type,
        b.description,
        b.benchmark_url,
        b.selector,
        b.yahoo_ticker,
        c.code AS currency_code,
        c.description AS currency_description
      FROM benchmarks b
      JOIN currencies c ON b.currencies_id = c.id
      ORDER BY b.description`,
    )
    .all();

  return benchmarks.map(function (bm) {
    // A benchmark is Yahoo-resolvable if it has a cached ticker or a
    // description that matches the known ticker map
    const hasCache = Boolean(bm.yahoo_ticker);
    const hasMatch = Boolean(matchYahooTicker(bm.description));

    bm.yahooResolvable = hasCache || hasMatch;
    return bm;
  });
}
