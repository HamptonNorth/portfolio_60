#!/usr/bin/env bun
/**
 * @description One-off script to export historical prices, currency rates,
 * and benchmark values from the portfolio_60 test reference database and
 * POST them to fetch-server-60's /api/history endpoint.
 *
 * This populates the fetch server with 3+ years of history so that new
 * test databases can be seeded from the fetch server (seconds) instead
 * of fetching from public APIs (minutes). Uses the test database, not
 * the live database, so no private financial data leaves the workstation.
 *
 * Prerequisites:
 *   - The test reference database must exist (enter test passphrase once first)
 *   - fetch-server-60 must be running and reachable
 *   - FETCH_SERVER_API_KEY must be set in .env
 *   - fetchServer.url must be configured in user-settings.json
 *
 * Usage:
 *   PORTFOLIO60_DATA_DIR=$HOME/.config/portfolio_60 bun scripts/seed-fetch-server-history.js
 */

import { getDatabase, resetDatabasePath } from "../src/server/db/connection.js";
import { getFetchServerConfig } from "../src/server/config.js";
import { loadEnvValue } from "../src/server/auth.js";
import { DATA_DIR } from "../src/shared/server-constants.js";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

// Open the test reference database (not the live database — that stays private)
const testDbPath = resolve(join(DATA_DIR, "data", "test_reference", "portfolio60.db"));
if (!existsSync(testDbPath)) {
  console.error("Test reference database not found at: " + testDbPath);
  console.error("Enter the test passphrase at least once to create it.");
  process.exit(1);
}

process.env.DB_PATH = testDbPath;
resetDatabasePath();
const db = getDatabase();

// Read fetch server config
const fetchServerConfig = getFetchServerConfig();
if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
  console.error("Fetch server is not enabled or has no URL configured.");
  console.error("Check fetchServer settings in user-settings.json.");
  process.exit(1);
}

const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
if (!apiKey) {
  console.error("No FETCH_SERVER_API_KEY found in .env file.");
  process.exit(1);
}

console.log("Exporting history from test reference database...");

// Query prices — map investment_id to morningstar_id
const priceRows = db.query(
  `SELECT i.morningstar_id, p.price_date, p.price
   FROM prices p
   JOIN investments i ON p.investment_id = i.id
   WHERE i.morningstar_id IS NOT NULL AND i.morningstar_id != ''
   ORDER BY i.morningstar_id, p.price_date`,
).all();

var prices = [];
for (var i = 0; i < priceRows.length; i++) {
  prices.push({
    morningstarId: priceRows[i].morningstar_id,
    priceDate: priceRows[i].price_date,
    price: priceRows[i].price,
  });
}
console.log("  Prices: " + prices.length + " rows");

// Query currency rates — map currencies_id to code
const rateRows = db.query(
  `SELECT c.code, cr.rate_date, cr.rate
   FROM currency_rates cr
   JOIN currencies c ON cr.currencies_id = c.id
   WHERE c.code != 'GBP'
   ORDER BY c.code, cr.rate_date`,
).all();

var currencies = [];
for (var j = 0; j < rateRows.length; j++) {
  currencies.push({
    code: rateRows[j].code,
    rateDate: rateRows[j].rate_date,
    rate: rateRows[j].rate,
  });
}
console.log("  Currency rates: " + currencies.length + " rows");

// Query benchmark values — map benchmark_id to yahoo_ticker
const bmRows = db.query(
  `SELECT b.yahoo_ticker, bd.benchmark_date, bd.value
   FROM benchmark_data bd
   JOIN benchmarks b ON bd.benchmark_id = b.id
   WHERE b.yahoo_ticker IS NOT NULL AND b.yahoo_ticker != ''
   ORDER BY b.yahoo_ticker, bd.benchmark_date`,
).all();

var benchmarks = [];
for (var k = 0; k < bmRows.length; k++) {
  benchmarks.push({
    yahooTicker: bmRows[k].yahoo_ticker,
    valueDate: bmRows[k].benchmark_date,
    value: bmRows[k].value,
  });
}
console.log("  Benchmark values: " + benchmarks.length + " rows");

var totalRows = prices.length + currencies.length + benchmarks.length;
console.log("  Total: " + totalRows + " rows");

if (totalRows === 0) {
  console.error("No data to export — is the live database populated?");
  process.exit(1);
}

// POST to fetch server
var url = fetchServerConfig.url.replace(/\/$/, "") + "/api/history";
console.log("\nPosting to " + url + "...");

try {
  var response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      currencies: currencies,
      prices: prices,
      benchmarks: benchmarks,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    var errorBody = await response.text();
    console.error("Server returned HTTP " + response.status + ": " + errorBody);
    process.exit(1);
  }

  var result = await response.json();
  console.log("Done — server accepted " + result.prices + " prices, " +
    result.rates + " rates, " + result.benchmarks + " benchmarks");
} catch (err) {
  console.error("Failed to post history: " + err.message);
  process.exit(1);
}
