/**
 * @description Pulls latest prices, rates, and benchmark values from the
 * remote fetch server and upserts them into the local database(s).
 * Updates both the live DB and the test DB (if it exists).
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDatabase, closeDatabase, resetDatabasePath } from "../db/connection.js";
import { getFetchServerConfig } from "../config.js";
import { loadEnvValue } from "../auth.js";
import { DATA_DIR, TEST_DB_FILENAME } from "../../shared/server-constants.js";

/**
 * @description Path to the test reference database.
 * @type {string}
 */
const TEST_DB_PATH = resolve(join(DATA_DIR, "data", "test_reference", TEST_DB_FILENAME));

/**
 * @description Fetch the latest data from the remote fetch server.
 * @returns {Promise<Object|null>} The latest data, or null on failure
 */
async function fetchLatestFromServer() {
  const fetchServerConfig = getFetchServerConfig();

  if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
    return null;
  }

  const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
  if (!apiKey) {
    console.warn("[FetchServerSync] No FETCH_SERVER_API_KEY in .env — cannot sync");
    return null;
  }

  const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/latest";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn("[FetchServerSync] Fetch failed (HTTP " + response.status + "): " + body);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn("[FetchServerSync] Fetch failed: " + err.message);
    return null;
  }
}

/**
 * @description Fetch the status from the remote fetch server.
 * @returns {Promise<Object|null>} The status data, or null on failure
 */
export async function fetchServerStatus() {
  const fetchServerConfig = getFetchServerConfig();

  if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
    return null;
  }

  const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
  if (!apiKey) return null;

  const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/status";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * @description Fetch the log entries from the remote fetch server.
 * Returns the most recent 80 fetch log rows, or null on failure.
 * @returns {Promise<Array|null>} Array of log row objects, or null on failure
 */
export async function fetchServerLog() {
  const fetchServerConfig = getFetchServerConfig();

  if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
    return null;
  }

  const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
  if (!apiKey) return null;

  const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/fetch-log";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * @description Trigger a manual Fetch All on the remote fetch server.
 * The fetch runs asynchronously on the server; poll /api/status or /api/fetch-log for results.
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function triggerServerFetchAll() {
  const fetchServerConfig = getFetchServerConfig();

  if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
    return { success: false, error: "Fetch server is not configured" };
  }

  const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
  if (!apiKey) {
    return { success: false, error: "No API key configured" };
  }

  const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/fetch";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();
    if (response.ok) {
      return { success: true, message: data.message || "Fetch started" };
    }
    return { success: false, error: data.error || "Request failed" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * @description Upsert the fetched data into a database.
 * Maps natural keys (morningstar_id, currency code, yahoo_ticker) to local
 * integer IDs and writes prices, rates, and benchmark values.
 *
 * Values from the fetch server are already scaled x 10000, so we write
 * them directly (no additional scaling).
 *
 * @param {Object} data - The data from GET /api/latest
 * @returns {{ prices: number, rates: number, benchmarks: number }} Count of items upserted
 */
export function upsertIntoDatabase(data) {
  const db = getDatabase();
  const counts = { prices: 0, rates: 0, benchmarks: 0 };

  // Build lookup maps: natural key → local integer ID
  const currencyMap = {};
  const currencyRows = db.query("SELECT id, code FROM currencies WHERE code != 'GBP'").all();
  for (const row of currencyRows) {
    currencyMap[row.code] = row.id;
  }

  const investmentMap = {};
  const investmentRows = db.query("SELECT id, morningstar_id FROM investments WHERE morningstar_id IS NOT NULL AND morningstar_id != ''").all();
  for (const row of investmentRows) {
    investmentMap[row.morningstar_id] = row.id;
  }

  const benchmarkMap = {};
  const benchmarkRows = db.query("SELECT id, yahoo_ticker FROM benchmarks WHERE yahoo_ticker IS NOT NULL AND yahoo_ticker != ''").all();
  for (const row of benchmarkRows) {
    benchmarkMap[row.yahoo_ticker] = row.id;
  }

  // Upsert currency rates (values are already scaled x 10000)
  if (data.currencies && data.currencies.length > 0) {
    const rateStmt = db.prepare(
      "INSERT OR REPLACE INTO currency_rates (currencies_id, rate_date, rate_time, rate) VALUES (?, ?, ?, ?)",
    );

    for (const rate of data.currencies) {
      const currencyId = currencyMap[rate.code];
      if (!currencyId) continue;
      rateStmt.run(currencyId, rate.rateDate, "00:00:00", rate.rate);
      counts.rates++;
    }
  }

  // Upsert investment prices (values are already scaled x 10000)
  if (data.prices && data.prices.length > 0) {
    const priceStmt = db.prepare(
      "INSERT OR REPLACE INTO prices (investment_id, price_date, price_time, price) VALUES (?, ?, ?, ?)",
    );

    for (const price of data.prices) {
      const investmentId = investmentMap[price.morningstarId];
      if (!investmentId) continue;
      priceStmt.run(investmentId, price.priceDate, "00:00:00", price.price);
      counts.prices++;
    }
  }

  // Upsert benchmark values (values are already scaled x 10000)
  if (data.benchmarks && data.benchmarks.length > 0) {
    const bmStmt = db.prepare(
      "INSERT OR REPLACE INTO benchmark_data (benchmark_id, benchmark_date, benchmark_time, value) VALUES (?, ?, ?, ?)",
    );

    for (const bm of data.benchmarks) {
      const benchmarkId = benchmarkMap[bm.yahooTicker];
      if (!benchmarkId) continue;
      bmStmt.run(benchmarkId, bm.valueDate, "00:00:00", bm.value);
      counts.benchmarks++;
    }
  }

  return counts;
}

/**
 * @description Sync latest data from the fetch server into local database(s).
 * Updates the live DB first, then the test DB if it exists.
 * @returns {Promise<{ success: boolean, live: Object|null, test: Object|null, error: string|null }>}
 */
export async function syncFromFetchServer() {
  const data = await fetchLatestFromServer();

  if (!data) {
    return { success: false, live: null, test: null, error: "Could not fetch data from server" };
  }

  if (!data.fetchedAt) {
    return { success: false, live: null, test: null, error: "Server has no fetched data yet" };
  }

  // 1. Upsert into live DB
  let liveCounts = null;
  try {
    liveCounts = upsertIntoDatabase(data);
    console.log(
      "[FetchServerSync] Live DB updated — prices: " + liveCounts.prices +
      ", rates: " + liveCounts.rates +
      ", benchmarks: " + liveCounts.benchmarks,
    );
  } catch (err) {
    console.error("[FetchServerSync] Live DB sync failed:", err.message);
    return { success: false, live: null, test: null, error: "Live DB sync failed: " + err.message };
  }

  // 2. Upsert into test DB (if it exists)
  let testCounts = null;
  if (existsSync(TEST_DB_PATH)) {
    const savedDbPath = process.env.DB_PATH;

    try {
      closeDatabase();
      process.env.DB_PATH = TEST_DB_PATH;
      resetDatabasePath();

      testCounts = upsertIntoDatabase(data);
      console.log(
        "[FetchServerSync] Test DB updated — prices: " + testCounts.prices +
        ", rates: " + testCounts.rates +
        ", benchmarks: " + testCounts.benchmarks,
      );
    } catch (err) {
      console.warn("[FetchServerSync] Test DB sync failed:", err.message);
    } finally {
      // Switch back to live DB
      closeDatabase();
      if (savedDbPath) {
        process.env.DB_PATH = savedDbPath;
      } else {
        delete process.env.DB_PATH;
      }
      resetDatabasePath();
    }
  }

  return {
    success: true,
    live: liveCounts,
    test: testCounts,
    error: null,
    fetchedAt: data.fetchedAt,
  };
}
