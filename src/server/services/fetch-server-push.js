/**
 * @description Builds the fetch config JSON from a union of the live and
 * test databases (deduplicated by natural key) and pushes it to the remote
 * fetch server. Called on startup and whenever investments, currencies,
 * or benchmarks are modified.
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { Database } from "bun:sqlite";
import { getDatabase } from "../db/connection.js";
import { getFetchServerConfig } from "../config.js";
import { loadEnvValue } from "../auth.js";
import { DATA_DIR } from "../../shared/server-constants.js";

/**
 * @description Path to the test reference database.
 * @type {string}
 */
const TEST_DB_PATH = resolve(join(DATA_DIR, "data", "test_reference", "portfolio60.db"));

/**
 * @description Query currencies, investments, and benchmarks from a database.
 * @param {Database} db - An open SQLite database connection
 * @returns {{ currencies: Object[], investments: Object[], benchmarks: Object[] }}
 */
function queryFetchItems(db) {
  const currencies = db.query(
    "SELECT code, description FROM currencies WHERE code != 'GBP' ORDER BY code",
  ).all();

  const investments = db.query(
    `SELECT
      i.description,
      i.public_id,
      i.morningstar_id,
      i.auto_fetch,
      c.code AS currency_code
    FROM investments i
    JOIN currencies c ON i.currencies_id = c.id
    WHERE i.auto_fetch = 1
    ORDER BY i.description`,
  ).all().map(function (row) {
    return {
      description: row.description,
      publicId: row.public_id || "",
      morningstarId: row.morningstar_id || "",
      currencyCode: row.currency_code,
      autoFetch: true,
    };
  });

  const benchmarks = db.query(
    `SELECT
      b.description,
      b.benchmark_type,
      b.yahoo_ticker,
      c.code AS currency_code
    FROM benchmarks b
    JOIN currencies c ON b.currencies_id = c.id
    ORDER BY b.description`,
  ).all().map(function (row) {
    return {
      description: row.description,
      benchmarkType: row.benchmark_type,
      yahooTicker: row.yahoo_ticker || "",
      currencyCode: row.currency_code,
    };
  });

  return { currencies: currencies, investments: investments, benchmarks: benchmarks };
}

/**
 * @description Build the fetch config JSON from the union of live and test
 * databases. Deduplicates by natural key (currency code, morningstar_id,
 * yahoo_ticker) so the fetch server fetches prices for all investments
 * across both databases.
 * @returns {Object} The fetch config JSON
 */
export function buildFetchConfig() {
  // Query the live (or current active) database
  const liveDb = getDatabase();
  const liveItems = queryFetchItems(liveDb);

  // Merge with test database if it exists
  let testItems = { currencies: [], investments: [], benchmarks: [] };
  if (existsSync(TEST_DB_PATH)) {
    let testDb = null;
    try {
      testDb = new Database(TEST_DB_PATH, { readonly: true });
      testDb.exec("PRAGMA busy_timeout = 5000");
      testItems = queryFetchItems(testDb);
    } catch (err) {
      console.warn("[FetchServerPush] Could not read test database:", err.message);
    } finally {
      if (testDb) testDb.close();
    }
  }

  // Deduplicate currencies by code
  const currencyMap = new Map();
  for (const c of liveItems.currencies) {
    currencyMap.set(c.code, c);
  }
  for (const c of testItems.currencies) {
    if (!currencyMap.has(c.code)) {
      currencyMap.set(c.code, c);
    }
  }

  // Deduplicate investments by morningstar_id
  const investmentMap = new Map();
  for (const inv of liveItems.investments) {
    if (inv.morningstarId) {
      investmentMap.set(inv.morningstarId, inv);
    }
  }
  for (const inv of testItems.investments) {
    if (inv.morningstarId && !investmentMap.has(inv.morningstarId)) {
      investmentMap.set(inv.morningstarId, inv);
    }
  }

  // Deduplicate benchmarks by yahoo_ticker
  const benchmarkMap = new Map();
  for (const bm of liveItems.benchmarks) {
    if (bm.yahooTicker) {
      benchmarkMap.set(bm.yahooTicker, bm);
    }
  }
  for (const bm of testItems.benchmarks) {
    if (bm.yahooTicker && !benchmarkMap.has(bm.yahooTicker)) {
      benchmarkMap.set(bm.yahooTicker, bm);
    }
  }

  return {
    pushedAt: new Date().toISOString(),
    currencies: Array.from(currencyMap.values()),
    investments: Array.from(investmentMap.values()),
    benchmarks: Array.from(benchmarkMap.values()),
  };
}

/**
 * @description Push the fetch config to the remote fetch server.
 * Logs a warning if the push fails (does not throw).
 * @param {Object} [config] - Optional pre-built config. If not provided, builds from DB.
 * @returns {Promise<boolean>} True if the push succeeded
 */
export async function pushConfigToFetchServer(config) {
  const fetchServerConfig = getFetchServerConfig();

  if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
    return false;
  }

  const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
  if (!apiKey) {
    console.warn("[FetchServerPush] No FETCH_SERVER_API_KEY in .env — cannot push config");
    return false;
  }

  const configData = config || buildFetchConfig();
  const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/config";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(configData),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.text();
      console.warn("[FetchServerPush] Push failed (HTTP " + response.status + "): " + body);
      return false;
    }

    const result = await response.json();
    console.log("[FetchServerPush] " + result.message);
    return true;
  } catch (err) {
    console.warn("[FetchServerPush] Push failed: " + err.message);
    return false;
  }
}
