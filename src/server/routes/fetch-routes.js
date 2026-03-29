import { Router } from "../router.js";
import { fetchCurrencyRates } from "../fetchers/currency-fetcher.js";
import { getLatestRates, getTotalRateCount, getRateCount } from "../db/currency-rates-db.js";
import { getAllInvestments, getInvestmentById } from "../db/investments-db.js";
import { getLatestPrice, getTotalPriceCount, getPriceCount } from "../db/prices-db.js";
import { getAllBenchmarks } from "../db/benchmarks-db.js";
import { getLatestBenchmarkData, getTotalBenchmarkDataCount, getBenchmarkDataCount } from "../db/benchmark-data-db.js";
import { fetchLatestMorningstarPrice, getMorningstarFetchableInvestments } from "../fetchers/morningstar-price-fetcher.js";
import { getFetchHistoryWithDescriptions, getFetchHistoryCount, getLastSuccessfulFetchByType, recordFetchAttempt, getLatestFailures } from "../db/fetch-history-db.js";
import { getSchedulerStatus } from "../services/scheduled-fetcher.js";
import { getFetchBatchConfig } from "../config.js";
import { fetchLatestYahooBenchmarkValue, getYahooFetchableBenchmarks } from "../fetchers/yahoo-benchmark-fetcher.js";
import { checkpointDatabase, getDatabase } from "../db/connection.js";
import { backfillInvestmentPrices, backfillBenchmarkValues, backfillCurrencyRates, backfillSingleInvestment, backfillSingleBenchmark, backfillSingleCurrency } from "../services/historic-backfill.js";
import { syncFromFetchServer, fetchServerStatus, fetchServerLog, triggerServerFetchAll } from "../services/fetch-server-sync.js";
import { getFetchServerConfig } from "../config.js";
import { isDemoMode } from "../test-mode.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/server-constants.js";

/**
 * @description Sleep for a given number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * @description Router instance for fetch API routes.
 * These routes are UNPROTECTED (no passphrase required) so that
 * future cron-scheduled fetching can run without user interaction.
 * @type {Router}
 */
const fetchRouter = new Router();

// POST /api/fetch/currency-rates — fetch and store current exchange rates
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
fetchRouter.post("/api/fetch/currency-rates", async function (request) {
  try {
    // Demo mode — return latest rates from DB without fetching or writing
    if (isDemoMode()) {
      var latestRates = getLatestRates();
      var demoRates = latestRates.map(function (r) {
        return { code: r.currency_code, description: r.currency_description, rate: r.rate / CURRENCY_SCALE_FACTOR, date: r.rate_date };
      });
      return new Response(JSON.stringify({
        success: true,
        message: "Currency rates (demo)",
        rates: demoRates,
        date: demoRates.length > 0 ? demoRates[0].date : null,
        demoMode: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    // Auto-backfill: if the currency_rates table is empty,
    // run the BoE historic backfill first (first run only)
    if (!testMode && getTotalRateCount() === 0) {
      try {
        await backfillCurrencyRates(function () {});
        checkpointDatabase();
      } catch (err) {
        console.warn("[FetchService] Currency rate backfill failed: " + err.message);
      }
    }

    // Per-currency backfill: if any non-GBP currency has no rate history,
    // backfill 3 years of weekly rates for that currency (e.g. newly added currency)
    if (!testMode) {
      const db = getDatabase();
      const currencies = db.query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code").all();

      for (const c of currencies) {
        if (getRateCount(c.id) === 0) {
          console.log("[FetchService] No rate history for " + c.code + " — backfilling...");
          try {
            await backfillSingleCurrency(c, function (progress) {
              console.log("[FetchService/Backfill] " + progress.message);
            });
            checkpointDatabase();
          } catch (err) {
            console.warn("[FetchService] Currency rate backfill for " + c.code + " failed: " + err.message);
          }
        }
      }
    }

    const result = await fetchCurrencyRates({ testMode: testMode });

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.message,
          detail: result.error || "",
          testMode: testMode,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ...result, testMode: testMode }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch currency rates", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/currency-rates/latest — get latest stored rates
fetchRouter.get("/api/fetch/currency-rates/latest", function () {
  try {
    const rates = getLatestRates();
    return new Response(JSON.stringify(rates), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get latest rates", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/current-values — get latest stored currency rates, investment prices and benchmark values
// This reads from the database only (no fetching). Used by the "Show Current" button.
fetchRouter.get("/api/fetch/current-values", function () {
  try {
    // 1. Latest currency rates
    const rates = getLatestRates();
    const formattedRates = rates.map(function (r) {
      return {
        code: r.currency_code,
        description: r.currency_description,
        rate: r.rate / 10000,
        rateDate: r.rate_date,
        rateTime: r.rate_time,
      };
    });

    // 2. Latest prices for all investments
    const investments = getAllInvestments();
    const prices = [];
    for (const inv of investments) {
      const latestPrice = getLatestPrice(inv.id);
      prices.push({
        investmentId: inv.id,
        description: inv.description,
        currency: inv.currency_code,
        price: latestPrice ? latestPrice.price : null,
        priceDate: latestPrice ? latestPrice.price_date : null,
        priceTime: latestPrice ? latestPrice.price_time : null,
      });
    }

    // 3. Latest values for all benchmarks
    const benchmarks = getAllBenchmarks();
    const benchmarkValues = [];
    for (const bm of benchmarks) {
      const latestData = getLatestBenchmarkData(bm.id);
      benchmarkValues.push({
        benchmarkId: bm.id,
        description: bm.description,
        benchmarkType: bm.benchmark_type,
        currency: bm.currency_code,
        value: latestData ? latestData.value : null,
        valueDate: latestData ? latestData.benchmark_date : null,
        valueTime: latestData ? latestData.benchmark_time : null,
      });
    }

    return new Response(
      JSON.stringify({
        rates: formattedRates,
        prices: prices,
        benchmarks: benchmarkValues,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get current values", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/prices/list — return the list of fetchable investments (no fetching)
// Used by the client to split investments into batches before opening SSE streams.
// Includes batch config so the client knows how to chunk requests.
fetchRouter.get("/api/fetch/prices/list", async function (request) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const batchConfig = getFetchBatchConfig();

      const investments = getMorningstarFetchableInvestments();
      return new Response(
        JSON.stringify({
          method: "api",
          investments: investments.map(function (inv) {
            return {
              investmentId: inv.id,
              description: inv.description,
              currency: inv.currency_code,
              morningstarResolvable: inv.morningstarResolvable,
            };
          }),
          total: investments.length,
          batchSize: batchConfig.batchSize,
          cooldownSeconds: batchConfig.cooldownSeconds,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn("[FetchService] prices/list attempt " + attempt + " failed: " + err.message + " — retrying in 2s");
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      } else {
        return new Response(JSON.stringify({ error: "Failed to get investment list", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
  }
});

// GET /api/fetch/benchmarks/list — return the list of fetchable benchmarks (no fetching)
fetchRouter.get("/api/fetch/benchmarks/list", async function () {
  // Retry up to 3 times with a short delay — the database WAL file may be
  // temporarily inaccessible after a long price-fetching session.
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const batchConfig = getFetchBatchConfig();

      const benchmarks = getYahooFetchableBenchmarks();
      return new Response(
        JSON.stringify({
          method: "api",
          benchmarks: benchmarks.map(function (bm) {
            return {
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
              yahooResolvable: bm.yahooResolvable,
            };
          }),
          total: benchmarks.length,
          batchSize: batchConfig.batchSize,
          cooldownSeconds: batchConfig.cooldownSeconds,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn("[FetchService] benchmarks/list attempt " + attempt + " failed: " + err.message + " — retrying in 2s");
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      } else {
        return new Response(JSON.stringify({ error: "Failed to get benchmark list", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
  }
});

// GET /api/fetch/prices/stream — SSE stream that fetches prices one-by-one
// Sends events: "init" (investment list + currency rates), "price" (each result), "done" (summary)
// Query parameter: ids=1,2,3 — optional, fetch only these investment IDs (for batched fetching)
// Query parameter: skipCurrencyRates=true — skip the currency rate fetch step
fetchRouter.get("/api/fetch/prices/stream", async function (request) {
  // Demo mode — simulate the stream using existing DB prices
  if (isDemoMode()) {
    return buildDemoPriceStream(request);
  }

  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        /** @type {boolean} Set to true when the connection has been lost */
        let connectionLost = false;

        /** @type {number} Sequential event ID for SSE protocol and debugging */
        let eventId = 0;

        /**
         * @description Send an SSE event to the client.
         * Catches errors from enqueue so the server-side loop continues
         * gracefully even if the client has disconnected.
         * Each event includes a sequential id: field for debugging and
         * standard SSE reconnection support.
         * @param {string} eventName - The event type
         * @param {Object} data - The data payload (will be JSON-stringified)
         */
        function sendEvent(eventName, data) {
          try {
            controller.enqueue(encoder.encode("id: " + (++eventId) + "\n"));
            controller.enqueue(encoder.encode("event: " + eventName + "\n"));
            controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
          } catch {
            connectionLost = true;
          }
        }

        // Send SSE comment every 15s as a keepalive to prevent intermediate
        // infrastructure (OS TCP stack, browser) from closing idle connections.
        const keepaliveId = setInterval(function () {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepaliveId);
            connectionLost = true;
          }
        }, 15000);

        try {
          // Parse query parameters for batched fetching
          const url = new URL(request.url);
          const idsParam = url.searchParams.get("ids");
          const skipCurrencyRates = url.searchParams.get("skipCurrencyRates") === "true";

          // Capture timestamp once for the entire fetch run so all values share it
          const fetchTime = new Date().toTimeString().slice(0, 8);

          // Step 1: Fetch currency rates (skip if caller already fetched them)
          let currencyRatesResult = null;
          if (!skipCurrencyRates) {
            currencyRatesResult = await fetchCurrencyRates({ fetchTime: fetchTime });
          }

          // Auto-backfill: if the prices table is empty, run the full
          // historic backfill before fetching latest prices (first run only)
          if (getTotalPriceCount() === 0) {
            sendEvent("backfill", { type: "prices", message: "Populating historic price data (first run)..." });
            try {
              await backfillInvestmentPrices(function (progress) {
                sendEvent("backfill_progress", progress);
              });
              sendEvent("backfill", { type: "prices", message: "Historic price data populated" });
              checkpointDatabase();
            } catch (err) {
              sendEvent("backfill", { type: "prices", message: "Price backfill failed: " + err.message });
            }
          }

          let investments = getMorningstarFetchableInvestments();

          if (idsParam) {
            const requestedIds = new Set(idsParam.split(",").map(Number));
            investments = investments.filter(function (inv) {
              return requestedIds.has(inv.id);
            });
          }

          sendEvent("init", {
            investments: investments.map(function (inv) {
              return {
                investmentId: inv.id,
                description: inv.description,
                currency: inv.currency_code,
                morningstarResolvable: inv.morningstarResolvable,
              };
            }),
            currencyRatesResult: currencyRatesResult,
            total: investments.length,
            method: "api",
          });

          if (investments.length === 0) {
            sendEvent("done", {
              success: true,
              message: "No investments configured for automatic pricing",
              total: 0,
              successCount: 0,
              failCount: 0,
              failedIds: [],
            });
          } else {
            let successCount = 0;
            const failedIds = [];
            let isFirstItem = true;

            for (const investment of investments) {
              if (connectionLost) {
                console.log("[FetchService/MS] Connection lost — stopping");
                break;
              }

              // Random delay of 5-30 seconds between API calls (skip before first item)
              if (!isFirstItem) {
                const delayMs = Math.floor(Math.random() * 25001) + 5000;
                console.log("[FetchService/MS] Delay " + delayMs + "ms before investment " + investment.id + " (" + investment.description + ")");
                await sleep(delayMs);
              }
              isFirstItem = false;

              // Skip manually priced investments (no Morningstar ID resolvable)
              if (!investment.morningstarResolvable) {
                console.log("[FetchService/MS] Skipping investment " + investment.id + " — manually priced");
                sendEvent("price", {
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
                  attemptNumber: 1,
                  maxAttempts: 1,
                });
                failedIds.push(investment.id);
                continue;
              }

              // Per-item backfill: if this investment has no price history,
              // backfill 3 years of weekly prices before fetching the latest
              if (getPriceCount(investment.id) === 0) {
                console.log("[FetchService/MS] No price history for investment " + investment.id + " — backfilling...");
                sendEvent("backfill", { type: "prices", message: "Backfilling price history for " + investment.description + "..." });
                try {
                  await backfillSingleInvestment(investment, function (progress) {
                    sendEvent("backfill_progress", progress);
                  });
                  sendEvent("backfill", { type: "prices", message: "Price history populated for " + investment.description });
                  checkpointDatabase();
                } catch (err) {
                  sendEvent("backfill", { type: "prices", message: "Price backfill failed for " + investment.description + ": " + err.message });
                }
              }

              console.log("[FetchService/MS] Fetching price for investment " + investment.id + " (" + investment.description + ")");

              let priceResult;
              try {
                priceResult = await fetchLatestMorningstarPrice(investment);
              } catch (err) {
                priceResult = {
                  success: false,
                  investmentId: investment.id,
                  description: investment.description,
                  rawPrice: "",
                  parsedPrice: null,
                  isMinorUnit: false,
                  priceMinorUnit: null,
                  currency: investment.currency_code,
                  error: "Unexpected error: " + err.message,
                  errorCode: "API_ERROR",
                  fallbackUsed: false,
                  priceDate: null,
                };
              }

              priceResult.attemptNumber = 1;
              priceResult.maxAttempts = 1;
              sendEvent("price", priceResult);

              if (priceResult.success) {
                successCount++;
                try {
                  recordFetchAttempt({
                    fetchType: "investment",
                    referenceId: investment.id,
                    attemptNumber: 1,
                    maxAttempts: 1,
                    success: true,
                  });
                } catch (historyErr) {
                  console.warn("[FetchService/MS] Failed to record history for investment " + investment.id + ": " + historyErr.message);
                }
              } else {
                failedIds.push(investment.id);
                // Only record non-manually-priced failures in history
                if (priceResult.errorCode !== "MANUALLY_PRICED") {
                  try {
                    recordFetchAttempt({
                      fetchType: "investment",
                      referenceId: investment.id,
                      attemptNumber: 1,
                      maxAttempts: 1,
                      success: false,
                      errorCode: priceResult.errorCode,
                      errorMessage: priceResult.error,
                    });
                  } catch (historyErr) {
                    console.warn("[FetchService/MS] Failed to record history for investment " + investment.id + ": " + historyErr.message);
                  }
                }
              }
            }

            checkpointDatabase();

            const total = investments.length;
            const failCount = failedIds.length;
            let message = "Fetched " + successCount + " of " + total + " investment price" + (total === 1 ? "" : "s") + " via Morningstar API";
            if (failCount > 0) {
              message += " (" + failCount + " failed or skipped)";
            }

            sendEvent("done", {
              success: true,
              message: message,
              total: total,
              successCount: successCount,
              failCount: failCount,
              failedIds: failedIds,
            });
          }
        } catch (err) {
          sendEvent("error", { error: err.message });
        }

        clearInterval(keepaliveId);
        try { controller.close(); } catch { /* already closed */ }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to start price fetching stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/fetch/prices/retry — retry fetching specific failed investments
// Body: { ids: number[] } - array of investment IDs to retry
// IMPORTANT: This literal route must be registered before the /:id parameterised
// route below, otherwise the router matches "retry" as an :id value.
fetchRouter.post("/api/fetch/prices/retry", async function (request) {
  try {
    const body = await request.json();
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or empty ids array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const fetchTime = new Date().toTimeString().slice(0, 8);
    const results = [];
    let successCount = 0;

    for (const id of ids) {
      try {
        const investment = getInvestmentById(id);
        if (!investment) {
          results.push({ success: false, investmentId: id, error: "Investment not found" });
          continue;
        }
        const result = await fetchLatestMorningstarPrice(investment);
        results.push(result);
        if (result.success) successCount++;
      } catch (err) {
        results.push({ success: false, investmentId: id, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        total: ids.length,
        successCount: successCount,
        failCount: ids.length - successCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to retry price fetching", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/fetch/prices/:id — fetch price for a single investment
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
fetchRouter.post("/api/fetch/prices/:id", async function (request, params) {
  try {
    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    const investment = getInvestmentById(Number(params.id));
    if (!investment) {
      return new Response(
        JSON.stringify({
          error: "Investment not found",
          detail: "",
          price: null,
          testMode: testMode,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await fetchLatestMorningstarPrice(investment, { testMode: testMode });

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.message,
          detail: result.error || "",
          price: result.price,
          testMode: testMode,
        }),
        { status: result.price === null ? 404 : 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ...result, testMode: testMode }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch price", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/benchmarks/stream — SSE stream that fetches benchmark values one-by-one
// Sends events: "init" (benchmark list), "benchmark" (each result), "done" (summary)
// Query parameter: ids=1,2,3 — optional, fetch only these benchmark IDs (for batched fetching)
fetchRouter.get("/api/fetch/benchmarks/stream", async function (request) {
  // Demo mode — simulate the stream using existing DB benchmark values
  if (isDemoMode()) {
    return buildDemoBenchmarkStream(request);
  }

  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        /** @type {boolean} Set to true when the connection has been lost */
        let connectionLost = false;

        /** @type {number} Sequential event ID for SSE protocol and debugging */
        let eventId = 0;

        /**
         * @description Send an SSE event to the client.
         * Catches errors from enqueue so the server-side loop continues
         * gracefully even if the client has disconnected.
         * Each event includes a sequential id: field for debugging and
         * standard SSE reconnection support.
         * @param {string} eventName - The event type
         * @param {Object} data - The data payload (will be JSON-stringified)
         */
        function sendEvent(eventName, data) {
          try {
            controller.enqueue(encoder.encode("id: " + (++eventId) + "\n"));
            controller.enqueue(encoder.encode("event: " + eventName + "\n"));
            controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
          } catch {
            connectionLost = true;
          }
        }

        // Send SSE comment every 15s as a keepalive to prevent intermediate
        // infrastructure (OS TCP stack, browser) from closing idle connections.
        const keepaliveId = setInterval(function () {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepaliveId);
            connectionLost = true;
          }
        }, 15000);

        try {
          // Parse query parameters for batched fetching
          const url = new URL(request.url);
          const idsParam = url.searchParams.get("ids");

          // Capture timestamp once for the entire fetch run so all values share it
          const fetchTime = new Date().toTimeString().slice(0, 8);

          // Auto-backfill: if the benchmark_data table is empty, run the full
          // historic backfill before fetching latest values (first run only)
          if (getTotalBenchmarkDataCount() === 0) {
            sendEvent("backfill", { type: "benchmarks", message: "Populating historic benchmark data (first run)..." });
            try {
              await backfillBenchmarkValues(function (progress) {
                sendEvent("backfill_progress", progress);
              });
              sendEvent("backfill", { type: "benchmarks", message: "Historic benchmark data populated" });
              checkpointDatabase();
            } catch (err) {
              sendEvent("backfill", { type: "benchmarks", message: "Benchmark backfill failed: " + err.message });
            }
          }

          let benchmarks = getYahooFetchableBenchmarks();

          if (idsParam) {
            const requestedIds = new Set(idsParam.split(",").map(Number));
            benchmarks = benchmarks.filter(function (bm) {
              return requestedIds.has(bm.id);
            });
          }

          sendEvent("init", {
            benchmarks: benchmarks.map(function (bm) {
              return {
                benchmarkId: bm.id,
                description: bm.description,
                benchmarkType: bm.benchmark_type,
                currency: bm.currency_code,
                yahooResolvable: bm.yahooResolvable,
              };
            }),
            total: benchmarks.length,
            method: "api",
          });

          if (benchmarks.length === 0) {
            sendEvent("done", {
              success: true,
              message: "No benchmarks configured",
              total: 0,
              successCount: 0,
              failCount: 0,
              failedIds: [],
            });
          } else {
            let successCount = 0;
            const failedIds = [];
            let isFirstItem = true;

            for (const benchmark of benchmarks) {
              if (connectionLost) {
                console.log("[FetchService/YF] Connection lost — stopping");
                break;
              }

              // Random delay of 5-30 seconds between API calls (skip before first item)
              if (!isFirstItem) {
                const delayMs = Math.floor(Math.random() * 25001) + 5000;
                console.log("[FetchService/YF] Delay " + delayMs + "ms before benchmark " + benchmark.id + " (" + benchmark.description + ")");
                await sleep(delayMs);
              }
              isFirstItem = false;

              // Skip benchmarks without Yahoo ticker (e.g. MSCI)
              if (!benchmark.yahooResolvable) {
                console.log("[FetchService/YF] Skipping benchmark " + benchmark.id + " — no API source");
                sendEvent("benchmark", {
                  success: false,
                  benchmarkId: benchmark.id,
                  description: benchmark.description,
                  benchmarkType: benchmark.benchmark_type,
                  rawValue: "",
                  parsedValue: null,
                  currency: benchmark.currency_code || "",
                  error: "No Yahoo Finance ticker — requires web scraping",
                  errorCode: "NO_YAHOO_TICKER",
                  valueDate: null,
                  attemptNumber: 1,
                  maxAttempts: 1,
                });
                failedIds.push(benchmark.id);
                continue;
              }

              // Per-item backfill: if this benchmark has no value history,
              // backfill 3 years of weekly values before fetching the latest
              if (getBenchmarkDataCount(benchmark.id) === 0) {
                console.log("[FetchService/YF] No value history for benchmark " + benchmark.id + " — backfilling...");
                sendEvent("backfill", { type: "benchmarks", message: "Backfilling value history for " + benchmark.description + "..." });
                try {
                  await backfillSingleBenchmark(benchmark, function (progress) {
                    sendEvent("backfill_progress", progress);
                  });
                  sendEvent("backfill", { type: "benchmarks", message: "Value history populated for " + benchmark.description });
                  checkpointDatabase();
                } catch (err) {
                  sendEvent("backfill", { type: "benchmarks", message: "Benchmark backfill failed for " + benchmark.description + ": " + err.message });
                }
              }

              console.log("[FetchService/YF] Fetching value for benchmark " + benchmark.id + " (" + benchmark.description + ")");

              let benchmarkResult;
              try {
                benchmarkResult = await fetchLatestYahooBenchmarkValue(benchmark);
              } catch (err) {
                benchmarkResult = {
                  success: false,
                  benchmarkId: benchmark.id,
                  description: benchmark.description,
                  benchmarkType: benchmark.benchmark_type,
                  rawValue: "",
                  parsedValue: null,
                  currency: benchmark.currency_code || "",
                  error: "Unexpected error: " + err.message,
                  errorCode: "API_ERROR",
                  valueDate: null,
                };
              }

              benchmarkResult.attemptNumber = 1;
              benchmarkResult.maxAttempts = 1;
              sendEvent("benchmark", benchmarkResult);

              if (benchmarkResult.success) {
                successCount++;
                try {
                  recordFetchAttempt({
                    fetchType: "benchmark",
                    referenceId: benchmark.id,
                    attemptNumber: 1,
                    maxAttempts: 1,
                    success: true,
                  });
                } catch (historyErr) {
                  console.warn("[FetchService/YF] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
                }
              } else {
                failedIds.push(benchmark.id);
                // Only record non-ticker-missing failures in history
                if (benchmarkResult.errorCode !== "NO_YAHOO_TICKER") {
                  try {
                    recordFetchAttempt({
                      fetchType: "benchmark",
                      referenceId: benchmark.id,
                      attemptNumber: 1,
                      maxAttempts: 1,
                      success: false,
                      errorCode: benchmarkResult.errorCode,
                      errorMessage: benchmarkResult.error,
                    });
                  } catch (historyErr) {
                    console.warn("[FetchService/YF] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
                  }
                }
              }
            }

            checkpointDatabase();

            const total = benchmarks.length;
            const failCount = failedIds.length;
            let message = "Fetched " + successCount + " of " + total + " benchmark value" + (total === 1 ? "" : "s") + " via Yahoo Finance API";
            if (failCount > 0) {
              message += " (" + failCount + " failed or skipped)";
            }

            sendEvent("done", {
              success: true,
              message: message,
              total: total,
              successCount: successCount,
              failCount: failCount,
              failedIds: failedIds,
            });
          }
        } catch (err) {
          sendEvent("error", { error: err.message });
        }

        clearInterval(keepaliveId);
        try { controller.close(); } catch { /* already closed */ }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to start benchmark fetching stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/fetch/benchmarks/retry — retry fetching specific failed benchmarks
// Body: { ids: number[] } - array of benchmark IDs to retry
// IMPORTANT: This literal route must be registered before the /:id parameterised
// route below, otherwise the router matches "retry" as an :id value.
fetchRouter.post("/api/fetch/benchmarks/retry", async function (request) {
  try {
    const body = await request.json();
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or empty ids array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const fetchTime = new Date().toTimeString().slice(0, 8);
    const results = [];
    let successCount = 0;

    for (const id of ids) {
      try {
        const result = await fetchLatestYahooBenchmarkValue({ id: id });
        results.push(result);
        if (result.success) successCount++;
      } catch (err) {
        results.push({ success: false, benchmarkId: id, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        total: ids.length,
        successCount: successCount,
        failCount: ids.length - successCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to retry benchmark fetching", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/fetch/benchmarks/:id — fetch value for a single benchmark
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
fetchRouter.post("/api/fetch/benchmarks/:id", async function (request, params) {
  try {
    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    const result = await fetchLatestYahooBenchmarkValue({ id: Number(params.id) }, { testMode: testMode });

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.message,
          detail: result.error || "",
          benchmark: result.benchmark,
          testMode: testMode,
        }),
        { status: result.benchmark === null ? 404 : 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ...result, testMode: testMode }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch benchmark", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/history — get fetch history with optional filters
// Query parameters: fetchType, success, startDate, endDate, limit, offset
fetchRouter.get("/api/fetch/history", function (request) {
  try {
    const url = new URL(request.url);
    const filters = {};

    const fetchType = url.searchParams.get("fetchType");
    if (fetchType) {
      filters.fetchType = fetchType;
    }

    const success = url.searchParams.get("success");
    if (success !== null) {
      filters.success = success === "true";
    }

    const startDate = url.searchParams.get("startDate");
    if (startDate) {
      filters.startDate = startDate;
    }

    const endDate = url.searchParams.get("endDate");
    if (endDate) {
      filters.endDate = endDate;
    }

    const limit = url.searchParams.get("limit");
    if (limit) {
      filters.limit = parseInt(limit, 10);
    }

    const offset = url.searchParams.get("offset");
    if (offset) {
      filters.offset = parseInt(offset, 10);
    }

    const autoFetchOnly = url.searchParams.get("autoFetchOnly");
    if (autoFetchOnly !== null) {
      filters.autoFetchOnly = autoFetchOnly === "true";
    }

    const history = getFetchHistoryWithDescriptions(filters);
    const totalCount = getFetchHistoryCount(filters);

    return new Response(
      JSON.stringify({
        history: history,
        totalCount: totalCount,
        limit: filters.limit || 100,
        offset: filters.offset || 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get fetch history", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/last-fetch — get last successful fetch datetime for each type
fetchRouter.get("/api/fetch/last-fetch", function () {
  try {
    const lastCurrency = getLastSuccessfulFetchByType("currency");
    const lastInvestment = getLastSuccessfulFetchByType("investment");
    const lastBenchmark = getLastSuccessfulFetchByType("benchmark");

    return new Response(
      JSON.stringify({
        currency: lastCurrency,
        investment: lastInvestment,
        benchmark: lastBenchmark,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get last fetch times", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/latest-failures — get items whose most recent fetch history record is a failure
// Returns investment and benchmark failures separately for the UI retry buttons
fetchRouter.get("/api/fetch/latest-failures", function () {
  try {
    const failures = getLatestFailures();
    const investmentFailures = failures.filter(function (f) {
      return f.fetch_type === "investment";
    });
    const benchmarkFailures = failures.filter(function (f) {
      return f.fetch_type === "benchmark";
    });

    return new Response(
      JSON.stringify({
        investmentFailures: investmentFailures,
        benchmarkFailures: benchmarkFailures,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get latest failures", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/fetch/scheduler-status — get the current status of the scheduled fetcher
fetchRouter.get("/api/fetch/scheduler-status", function () {
  try {
    const status = getSchedulerStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get scheduler status", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/fetch/sync — manually trigger sync from fetch server
fetchRouter.post("/api/fetch/sync", async function () {
  const config = getFetchServerConfig();
  if (!config.enabled || !config.url) {
    return Response.json({ error: "Fetch server is not configured" }, { status: 400 });
  }

  const result = await syncFromFetchServer();
  return Response.json(result, { status: result.success ? 200 : 502 });
});

// GET /api/fetch/server-status — get remote fetch server status
fetchRouter.get("/api/fetch/server-status", async function () {
  const config = getFetchServerConfig();
  if (!config.enabled || !config.url) {
    return Response.json({ enabled: false }, { status: 200 });
  }

  const status = await fetchServerStatus();
  if (!status) {
    return Response.json({ enabled: true, reachable: false }, { status: 200 });
  }

  return Response.json({ enabled: true, reachable: true, ...status }, { status: 200 });
});

// GET /api/fetch/server-log — proxy fetch log from remote fetch server
fetchRouter.get("/api/fetch/server-log", async function () {
  const config = getFetchServerConfig();
  if (!config.enabled || !config.url) {
    return Response.json({ enabled: false }, { status: 200 });
  }

  const log = await fetchServerLog();
  if (!log) {
    return Response.json({ enabled: true, reachable: false }, { status: 200 });
  }

  return Response.json({ enabled: true, reachable: true, entries: log }, { status: 200 });
});

// POST /api/fetch/server-rerun — trigger a Fetch All on the remote fetch server
fetchRouter.post("/api/fetch/server-rerun", async function () {
  const config = getFetchServerConfig();
  if (!config.enabled || !config.url) {
    return Response.json({ error: "Fetch server is not configured" }, { status: 400 });
  }

  const result = await triggerServerFetchAll();
  return Response.json(result, { status: result.success ? 202 : 502 });
});

/**
 * @description Handle a fetch API request. Delegates to the fetch router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
// ─── Demo mode simulated streams ─────────────────────────────────

/**
 * @description Build a simulated SSE price stream for demo mode.
 * Reads existing prices from the database and emits them with short delays
 * to make the UI look realistic. No external API calls or DB writes.
 * @param {Request} request - The incoming HTTP request
 * @returns {Response} SSE stream response
 */
function buildDemoPriceStream(request) {
  var stream = new ReadableStream({
    async start(controller) {
      var encoder = new TextEncoder();
      var eventId = 0;

      function sendEvent(eventName, data) {
        try {
          controller.enqueue(encoder.encode("id: " + (++eventId) + "\n"));
          controller.enqueue(encoder.encode("event: " + eventName + "\n"));
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        } catch { /* connection lost */ }
      }

      try {
        var url = new URL(request.url);
        var idsParam = url.searchParams.get("ids");
        var skipCurrencyRates = url.searchParams.get("skipCurrencyRates") === "true";

        // Get currency rates result for init event
        var currencyRatesResult = null;
        if (!skipCurrencyRates) {
          var latestRates = getLatestRates();
          currencyRatesResult = {
            success: true,
            message: "Currency rates (demo)",
            rates: latestRates.map(function (r) {
              return { code: r.currency_code, description: r.currency_description, rate: r.rate / CURRENCY_SCALE_FACTOR, date: r.rate_date };
            }),
          };
        }

        var investments = getMorningstarFetchableInvestments();
        if (idsParam) {
          var requestedIds = new Set(idsParam.split(",").map(Number));
          investments = investments.filter(function (inv) { return requestedIds.has(inv.id); });
        }

        sendEvent("init", {
          investments: investments.map(function (inv) {
            return {
              investmentId: inv.id,
              description: inv.description,
              currency: inv.currency_code,
              morningstarResolvable: inv.morningstarResolvable,
            };
          }),
          currencyRatesResult: currencyRatesResult,
          total: investments.length,
          method: "demo",
        });

        var successCount = 0;
        var failedIds = [];

        for (var i = 0; i < investments.length; i++) {
          var inv = investments[i];

          // Short random delay (500–2000ms) to look realistic
          if (i > 0) {
            await sleep(Math.floor(Math.random() * 1501) + 500);
          }

          // Manually priced investments
          if (!inv.morningstarResolvable) {
            sendEvent("price", {
              success: false,
              investmentId: inv.id,
              description: inv.description,
              rawPrice: "",
              parsedPrice: null,
              isMinorUnit: false,
              priceMinorUnit: null,
              currency: inv.currency_code,
              error: "No Morningstar ID — manually priced",
              errorCode: "MANUALLY_PRICED",
              fallbackUsed: false,
              priceDate: null,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            failedIds.push(inv.id);
            continue;
          }

          // Read latest price from DB
          var latest = getLatestPrice(inv.id);
          if (latest) {
            sendEvent("price", {
              success: true,
              investmentId: inv.id,
              description: inv.description,
              rawPrice: latest.price.toFixed(2),
              parsedPrice: latest.price,
              isMinorUnit: false,
              priceMinorUnit: null,
              currency: inv.currency_code,
              error: null,
              errorCode: null,
              fallbackUsed: false,
              priceDate: latest.price_date,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            successCount++;
          } else {
            sendEvent("price", {
              success: false,
              investmentId: inv.id,
              description: inv.description,
              rawPrice: "",
              parsedPrice: null,
              isMinorUnit: false,
              priceMinorUnit: null,
              currency: inv.currency_code,
              error: "No price data available",
              errorCode: "API_ERROR",
              fallbackUsed: false,
              priceDate: null,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            failedIds.push(inv.id);
          }
        }

        sendEvent("done", {
          success: true,
          message: "Demo fetch complete",
          total: investments.length,
          successCount: successCount,
          failCount: failedIds.length,
          failedIds: failedIds,
        });
      } catch (err) {
        sendEvent("error", { error: "Demo stream error: " + err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}

/**
 * @description Build a simulated SSE benchmark stream for demo mode.
 * Reads existing benchmark values from the database and emits them with
 * short delays. No external API calls or DB writes.
 * @param {Request} request - The incoming HTTP request
 * @returns {Response} SSE stream response
 */
function buildDemoBenchmarkStream(request) {
  var stream = new ReadableStream({
    async start(controller) {
      var encoder = new TextEncoder();
      var eventId = 0;

      function sendEvent(eventName, data) {
        try {
          controller.enqueue(encoder.encode("id: " + (++eventId) + "\n"));
          controller.enqueue(encoder.encode("event: " + eventName + "\n"));
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        } catch { /* connection lost */ }
      }

      try {
        var url = new URL(request.url);
        var idsParam = url.searchParams.get("ids");

        var benchmarks = getYahooFetchableBenchmarks();
        if (idsParam) {
          var requestedIds = new Set(idsParam.split(",").map(Number));
          benchmarks = benchmarks.filter(function (bm) { return requestedIds.has(bm.id); });
        }

        sendEvent("init", {
          benchmarks: benchmarks.map(function (bm) {
            return {
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
              currency: bm.currency_code,
              yahooResolvable: bm.yahooResolvable,
            };
          }),
          total: benchmarks.length,
          method: "demo",
        });

        var successCount = 0;
        var failedIds = [];

        for (var i = 0; i < benchmarks.length; i++) {
          var bm = benchmarks[i];

          // Short random delay (500–2000ms) to look realistic
          if (i > 0) {
            await sleep(Math.floor(Math.random() * 1501) + 500);
          }

          // Benchmarks without Yahoo ticker
          if (!bm.yahooResolvable) {
            sendEvent("benchmark", {
              success: false,
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
              rawValue: "",
              parsedValue: null,
              currency: bm.currency_code || "",
              error: "No Yahoo Finance ticker — requires web scraping",
              errorCode: "NO_YAHOO_TICKER",
              valueDate: null,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            failedIds.push(bm.id);
            continue;
          }

          // Read latest value from DB
          var latest = getLatestBenchmarkData(bm.id);
          if (latest) {
            sendEvent("benchmark", {
              success: true,
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
              rawValue: latest.value.toFixed(2),
              parsedValue: latest.value,
              currency: bm.currency_code || "",
              error: null,
              errorCode: null,
              valueDate: latest.benchmark_date,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            successCount++;
          } else {
            sendEvent("benchmark", {
              success: false,
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
              rawValue: "",
              parsedValue: null,
              currency: bm.currency_code || "",
              error: "No benchmark data available",
              errorCode: "API_ERROR",
              valueDate: null,
              attemptNumber: 1,
              maxAttempts: 1,
            });
            failedIds.push(bm.id);
          }
        }

        sendEvent("done", {
          success: true,
          message: "Demo fetch complete",
          total: benchmarks.length,
          successCount: successCount,
          failCount: failedIds.length,
          failedIds: failedIds,
        });
      } catch (err) {
        sendEvent("error", { error: "Demo stream error: " + err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
  });
}

export async function handleFetchRoute(method, path, request) {
  return await fetchRouter.match(method, path, request);
}
