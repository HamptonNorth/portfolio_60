/**
 * @description Compare prices, rates, and benchmark values between the local
 * database and the remote fetch server. Queries the fetch server API for its
 * latest data and compares against the local DB's latest values.
 *
 * Usage:
 *   bun run scripts/compare-fetch-sources.js [--test]
 *
 * Options:
 *   --test   Compare against the test database (default: live database)
 *
 * Requires FETCH_SERVER_API_KEY in .env and fetchServer.url in user-settings.json.
 */

import { resolve, join } from "node:path";

const DATA_DIR = process.env.PORTFOLIO60_DATA_DIR || ".";
const useTestDb = process.argv.includes("--test");

// Set DB_PATH before importing connection.js
if (useTestDb) {
  process.env.DB_PATH = resolve(join(DATA_DIR, "data", "test_reference", "portfolio60_test.db"));
}

const { getDatabase } = await import("../src/server/db/connection.js");
const { getFetchServerConfig } = await import("../src/server/config.js");
const { loadEnvValue } = await import("../src/server/auth.js");

const dbLabel = useTestDb ? "TEST" : "LIVE";
console.log("Comparing " + dbLabel + " database against fetch server\n");

// Get fetch server URL and API key
const fetchServerConfig = getFetchServerConfig();
if (!fetchServerConfig.enabled || !fetchServerConfig.url) {
  console.error("Fetch server not configured in user-settings.json");
  process.exit(1);
}

const apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
if (!apiKey) {
  console.error("No FETCH_SERVER_API_KEY in .env");
  process.exit(1);
}

// Fetch latest data from the server
const url = fetchServerConfig.url.replace(/\/$/, "") + "/api/latest";
let serverData;
try {
  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    console.error("Fetch server returned HTTP " + response.status);
    process.exit(1);
  }
  serverData = await response.json();
} catch (err) {
  console.error("Could not reach fetch server: " + err.message);
  process.exit(1);
}

console.log("Fetch server last fetched: " + (serverData.fetchedAt || "never") + "\n");

const db = getDatabase();

// ============================================================================
// Currency Rates
// ============================================================================

console.log("=== CURRENCY RATES ===");
console.log(
  "Currency".padEnd(6) +
  "Local Date".padEnd(14) +
  "Local Rate".padEnd(14) +
  "Server Date".padEnd(14) +
  "Server Rate".padEnd(14) +
  "Result"
);
console.log("-".repeat(76));

const serverRateMap = {};
for (const r of serverData.currencies || []) {
  serverRateMap[r.code] = r;
}

const localCurrencies = db.query(`
  SELECT c.code, cr.rate_date, cr.rate
  FROM currencies c
  LEFT JOIN currency_rates cr ON cr.currencies_id = c.id
    AND cr.rate_date = (SELECT MAX(cr2.rate_date) FROM currency_rates cr2 WHERE cr2.currencies_id = c.id)
  WHERE c.code != 'GBP'
  ORDER BY c.code
`).all();

for (const local of localCurrencies) {
  const server = serverRateMap[local.code];
  const localRate = local.rate != null ? (local.rate / 10000).toFixed(4) : "-";
  const localDate = local.rate_date || "-";
  const serverRate = server ? (server.rate / 10000).toFixed(4) : "-";
  const serverDate = server ? server.rateDate : "-";

  let result;
  if (!local.rate && !server) {
    result = "BOTH EMPTY";
  } else if (!local.rate) {
    result = "NO LOCAL";
  } else if (!server) {
    result = "NO SERVER";
  } else if (local.rate === server.rate && local.rate_date === server.rateDate) {
    result = "MATCH";
  } else if (local.rate === server.rate) {
    result = "RATE MATCH (date differs)";
  } else {
    const diff = ((server.rate - local.rate) / 10000).toFixed(4);
    result = "DIFF: " + diff;
  }

  console.log(
    local.code.padEnd(6) +
    localDate.padEnd(14) +
    localRate.padEnd(14) +
    serverDate.padEnd(14) +
    serverRate.padEnd(14) +
    result
  );
}

// ============================================================================
// Investment Prices
// ============================================================================

console.log("\n=== INVESTMENT PRICES ===");
console.log(
  "Investment".padEnd(42) +
  "Local Date".padEnd(14) +
  "Local Price".padEnd(14) +
  "Server Date".padEnd(14) +
  "Server Price".padEnd(14) +
  "Result"
);
console.log("-".repeat(112));

const serverPriceMap = {};
for (const p of serverData.prices || []) {
  serverPriceMap[p.morningstarId] = p;
}

const localInvestments = db.query(`
  SELECT i.description, i.morningstar_id, p.price_date, p.price
  FROM investments i
  LEFT JOIN prices p ON p.investment_id = i.id
    AND p.price_date = (SELECT MAX(p2.price_date) FROM prices p2 WHERE p2.investment_id = i.id)
  WHERE i.auto_fetch = 1
  ORDER BY i.description
`).all();

for (const local of localInvestments) {
  const server = local.morningstar_id ? serverPriceMap[local.morningstar_id] : null;
  const localPrice = local.price != null ? (local.price / 1000000).toFixed(2) : "-";
  const localDate = local.price_date || "-";
  const serverPrice = server ? (server.price / 1000000).toFixed(2) : "-";
  const serverDate = server ? server.priceDate : "-";

  let result;
  if (!local.price && !server) {
    result = "BOTH EMPTY";
  } else if (!local.price) {
    result = "NO LOCAL";
  } else if (!server) {
    result = "NO SERVER";
  } else if (local.price === server.price && local.price_date === server.priceDate) {
    result = "MATCH";
  } else if (local.price === server.price) {
    result = "PRICE MATCH (date differs)";
  } else {
    const diff = ((server.price - local.price) / 1000000).toFixed(4);
    result = "DIFF: " + diff;
  }

  console.log(
    local.description.substring(0, 40).padEnd(42) +
    localDate.padEnd(14) +
    localPrice.padEnd(14) +
    serverDate.padEnd(14) +
    serverPrice.padEnd(14) +
    result
  );
}

// ============================================================================
// Benchmark Values
// ============================================================================

console.log("\n=== BENCHMARK VALUES ===");
console.log(
  "Benchmark".padEnd(42) +
  "Local Date".padEnd(14) +
  "Local Value".padEnd(14) +
  "Server Date".padEnd(14) +
  "Server Value".padEnd(14) +
  "Result"
);
console.log("-".repeat(112));

const serverBmMap = {};
for (const b of serverData.benchmarks || []) {
  serverBmMap[b.yahooTicker] = b;
}

const localBenchmarks = db.query(`
  SELECT b.description, b.yahoo_ticker, bd.benchmark_date, bd.value
  FROM benchmarks b
  LEFT JOIN benchmark_data bd ON bd.benchmark_id = b.id
    AND bd.benchmark_date = (SELECT MAX(bd2.benchmark_date) FROM benchmark_data bd2 WHERE bd2.benchmark_id = b.id)
  ORDER BY b.description
`).all();

for (const local of localBenchmarks) {
  const server = local.yahoo_ticker ? serverBmMap[local.yahoo_ticker] : null;
  const localValue = local.value != null ? (local.value / 10000).toFixed(2) : "-";
  const localDate = local.benchmark_date || "-";
  const serverValue = server ? (server.value / 10000).toFixed(2) : "-";
  const serverDate = server ? server.valueDate : "-";

  let result;
  if (!local.value && !server) {
    result = "BOTH EMPTY";
  } else if (!local.value) {
    result = "NO LOCAL";
  } else if (!server) {
    result = "NO SERVER";
  } else if (local.value === server.value && local.benchmark_date === server.valueDate) {
    result = "MATCH";
  } else if (local.value === server.value) {
    result = "VALUE MATCH (date differs)";
  } else {
    const diff = ((server.value - local.value) / 10000).toFixed(4);
    result = "DIFF: " + diff;
  }

  console.log(
    local.description.substring(0, 40).padEnd(42) +
    localDate.padEnd(14) +
    localValue.padEnd(14) +
    serverDate.padEnd(14) +
    serverValue.padEnd(14) +
    result
  );
}

// Summary
console.log("\n=== SUMMARY ===");
const allResults = [];
for (const local of localCurrencies) {
  const server = serverRateMap[local.code];
  if (local.rate && server && local.rate === server.rate) allResults.push("match");
  else if (local.rate && server) allResults.push("diff");
  else allResults.push("missing");
}
for (const local of localInvestments) {
  const server = local.morningstar_id ? serverPriceMap[local.morningstar_id] : null;
  if (local.price && server && local.price === server.price) allResults.push("match");
  else if (local.price && server) allResults.push("diff");
  else allResults.push("missing");
}
for (const local of localBenchmarks) {
  const server = local.yahoo_ticker ? serverBmMap[local.yahoo_ticker] : null;
  if (local.value && server && local.value === server.value) allResults.push("match");
  else if (local.value && server) allResults.push("diff");
  else allResults.push("missing");
}

const matches = allResults.filter(r => r === "match").length;
const diffs = allResults.filter(r => r === "diff").length;
const missing = allResults.filter(r => r === "missing").length;
console.log("Matches: " + matches + "  Differences: " + diffs + "  Missing one side: " + missing);
