import { Router } from "../router.js";
import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import { getLatestRates, getTotalRateCount, getRateCount } from "../db/currency-rates-db.js";
import { getAllInvestments, getInvestmentById, updateAutoScrape } from "../db/investments-db.js";
import { getLatestPrice, getTotalPriceCount, getPriceCount } from "../db/prices-db.js";
import { getAllBenchmarks } from "../db/benchmarks-db.js";
import { getLatestBenchmarkData, getTotalBenchmarkDataCount, getBenchmarkDataCount } from "../db/benchmark-data-db.js";
import { scrapeAllPrices, scrapePriceById, getScrapeableInvestments, scrapeSingleInvestmentPrice, extractDomain, calculateDelay } from "../scrapers/price-scraper.js";
import { fetchLatestMorningstarPrice, getMorningstarScrapeableInvestments } from "../scrapers/morningstar-price-scraper.js";
import { scrapeAllBenchmarks, scrapeBenchmarkById, getScrapeableBenchmarks, scrapeSingleBenchmarkValue, extractDomain as extractBenchmarkDomain, calculateDelay as calculateBenchmarkDelay } from "../scrapers/benchmark-scraper.js";
import { getScrapingHistoryWithDescriptions, getScrapingHistoryCount, getLastSuccessfulScrapeByType, recordScrapingAttempt, getLatestFailures } from "../db/scraping-history-db.js";
import { launchBrowser, isBrowserAlive } from "../scrapers/browser-utils.js";
import { SCRAPE_RETRY_CONFIG } from "../../shared/server-constants.js";
import { getSchedulerStatus } from "../services/scheduled-scraper.js";
import { getScrapeBatchConfig, getPriceMethodConfig } from "../config.js";
import { fetchLatestYahooBenchmarkValue, getYahooScrapeableBenchmarks } from "../scrapers/yahoo-benchmark-scraper.js";
import { checkpointDatabase, getDatabase } from "../db/connection.js";
import { backfillInvestmentPrices, backfillBenchmarkValues, backfillCurrencyRates, backfillSingleInvestment, backfillSingleBenchmark, backfillSingleCurrency } from "../services/historic-backfill.js";

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
 * @description Router instance for scraper API routes.
 * These routes are UNPROTECTED (no passphrase required) so that
 * future cron-scheduled scraping can run without user interaction.
 * @type {Router}
 */
const scraperRouter = new Router();

// POST /api/scraper/currency-rates — fetch and store current exchange rates
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
scraperRouter.post("/api/scraper/currency-rates", async function (request) {
  try {
    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    // Auto-backfill: if the currency_rates table is empty and we're in API mode,
    // run the BoE historic backfill first (first run only)
    if (!testMode && getPriceMethodConfig() === "api" && getTotalRateCount() === 0) {
      try {
        await backfillCurrencyRates(function () {});
        checkpointDatabase();
      } catch (err) {
        console.warn("[Scraper] Currency rate backfill failed: " + err.message);
      }
    }

    // Per-currency backfill: if any non-GBP currency has no rate history,
    // backfill 3 years of weekly rates for that currency (e.g. newly added currency)
    if (!testMode && getPriceMethodConfig() === "api") {
      const db = getDatabase();
      const currencies = db.query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code").all();

      for (const c of currencies) {
        if (getRateCount(c.id) === 0) {
          console.log("[Scraper] No rate history for " + c.code + " — backfilling...");
          try {
            await backfillSingleCurrency(c, function (progress) {
              console.log("[Scraper/Backfill] " + progress.message);
            });
            checkpointDatabase();
          } catch (err) {
            console.warn("[Scraper] Currency rate backfill for " + c.code + " failed: " + err.message);
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

// GET /api/scraper/currency-rates/latest — get latest stored rates
scraperRouter.get("/api/scraper/currency-rates/latest", function () {
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

// GET /api/scraper/current-values — get latest stored currency rates, investment prices and benchmark values
// This reads from the database only (no scraping). Used by the "Show Current" button.
scraperRouter.get("/api/scraper/current-values", function () {
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

// POST /api/scraper/prices — scrape prices for all configured investments
scraperRouter.post("/api/scraper/prices", async function () {
  try {
    const result = await scrapeAllPrices();

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to scrape prices", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/scraper/prices/list — return the list of scrapeable investments (no scraping)
// Used by the client to split investments into batches before opening SSE streams.
// Includes batch config so the client knows how to chunk requests.
// Method is determined by the priceMethod config setting.
scraperRouter.get("/api/scraper/prices/list", async function (request) {
  const method = getPriceMethodConfig();

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const batchConfig = getScrapeBatchConfig();

      if (method === "api") {
        const investments = getMorningstarScrapeableInvestments();
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
      }

      // Default: web scrape method
      const investments = getScrapeableInvestments();
      return new Response(
        JSON.stringify({
          method: "scrape",
          investments: investments.map(function (inv) {
            return {
              investmentId: inv.id,
              description: inv.description,
              currency: inv.currency_code,
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
        console.warn("[Scraper] prices/list attempt " + attempt + " failed: " + err.message + " — retrying in 2s");
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      } else {
        return new Response(JSON.stringify({ error: "Failed to get investment list", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
  }
});

// GET /api/scraper/benchmarks/list — return the list of scrapeable benchmarks (no scraping)
// Method is determined by the priceMethod config setting.
scraperRouter.get("/api/scraper/benchmarks/list", async function () {
  const method = getPriceMethodConfig();

  // Retry up to 3 times with a short delay — the database WAL file may be
  // temporarily inaccessible after a long price-scraping session.
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const batchConfig = getScrapeBatchConfig();

      if (method === "api") {
        const benchmarks = getYahooScrapeableBenchmarks();
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
      }

      // Default: web scrape method
      const benchmarks = getScrapeableBenchmarks();
      return new Response(
        JSON.stringify({
          method: "scrape",
          benchmarks: benchmarks.map(function (bm) {
            return {
              benchmarkId: bm.id,
              description: bm.description,
              benchmarkType: bm.benchmark_type,
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
        console.warn("[Scraper] benchmarks/list attempt " + attempt + " failed: " + err.message + " — retrying in 2s");
        await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      } else {
        return new Response(JSON.stringify({ error: "Failed to get benchmark list", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
  }
});

// GET /api/scraper/prices/stream — SSE stream that scrapes prices one-by-one
// Sends events: "init" (investment list + currency rates), "price" (each result), "done" (summary)
// Query parameter: ids=1,2,3 — optional, scrape only these investment IDs (for batched scraping)
// Query parameter: skipCurrencyRates=true — skip the currency rate fetch step
// Method is determined by the priceMethod config setting ("scrape" or "api")
scraperRouter.get("/api/scraper/prices/stream", async function (request) {
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

        let streamTimedOut = false;
        let streamTimeoutId = null;

        let browser = null;

        try {
          // Parse query parameters for batched scraping
          const url = new URL(request.url);
          const idsParam = url.searchParams.get("ids");
          const skipCurrencyRates = url.searchParams.get("skipCurrencyRates") === "true";
          const method = getPriceMethodConfig();

          // Capture timestamp once for the entire fetch run so all values share it
          const scrapeTime = new Date().toTimeString().slice(0, 8);

          // Step 1: Fetch currency rates (skip if caller already fetched them)
          let currencyRatesResult = null;
          if (!skipCurrencyRates) {
            currencyRatesResult = await fetchCurrencyRates({ scrapeTime: scrapeTime });
          }

          // -----------------------------------------------------------------
          // API method — Morningstar API, no browser, single pass, random delays
          // -----------------------------------------------------------------
          if (method === "api") {
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

            let investments = getMorningstarScrapeableInvestments();

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
                  console.log("[Scraper/MS] Connection lost — stopping");
                  break;
                }

                // Random delay of 5-30 seconds between API calls (skip before first item)
                if (!isFirstItem) {
                  const delayMs = Math.floor(Math.random() * 25001) + 5000;
                  console.log("[Scraper/MS] Delay " + delayMs + "ms before investment " + investment.id + " (" + investment.description + ")");
                  await sleep(delayMs);
                }
                isFirstItem = false;

                // Skip manually priced investments (no Morningstar ID resolvable)
                if (!investment.morningstarResolvable) {
                  console.log("[Scraper/MS] Skipping investment " + investment.id + " — manually priced");
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
                  console.log("[Scraper/MS] No price history for investment " + investment.id + " — backfilling...");
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

                console.log("[Scraper/MS] Fetching price for investment " + investment.id + " (" + investment.description + ")");

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
                    recordScrapingAttempt({
                      scrapeType: "investment",
                      referenceId: investment.id,
                      attemptNumber: 1,
                      maxAttempts: 1,
                      success: true,
                    });
                  } catch (historyErr) {
                    console.warn("[Scraper/MS] Failed to record history for investment " + investment.id + ": " + historyErr.message);
                  }
                } else {
                  failedIds.push(investment.id);
                  // Only record non-manually-priced failures in history
                  if (priceResult.errorCode !== "MANUALLY_PRICED") {
                    try {
                      recordScrapingAttempt({
                        scrapeType: "investment",
                        referenceId: investment.id,
                        attemptNumber: 1,
                        maxAttempts: 1,
                        success: false,
                        errorCode: priceResult.errorCode,
                        errorMessage: priceResult.error,
                      });
                    } catch (historyErr) {
                      console.warn("[Scraper/MS] Failed to record history for investment " + investment.id + ": " + historyErr.message);
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

            clearInterval(keepaliveId);
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          // -----------------------------------------------------------------
          // Web scrape method (default) — Playwright browser-based scraping
          // -----------------------------------------------------------------

          // Step 2: Get the list of investments to scrape
          let investments = getScrapeableInvestments();

          // If specific IDs were requested, filter to just those
          if (idsParam) {
            const requestedIds = new Set(idsParam.split(",").map(Number));
            investments = investments.filter(function (inv) {
              return requestedIds.has(inv.id);
            });
          }

          // Stream timeout: 60s per item, minimum 10 minutes
          const streamTimeoutMs = Math.max(600000, investments.length * 60000);
          streamTimeoutId = setTimeout(function () {
            streamTimedOut = true;
          }, streamTimeoutMs);

          // Send init event with the investment list and currency rates
          sendEvent("init", {
            investments: investments.map(function (inv) {
              return {
                investmentId: inv.id,
                description: inv.description,
                currency: inv.currency_code,
              };
            }),
            currencyRatesResult: currencyRatesResult,
            total: investments.length,
          });

          if (investments.length === 0) {
            sendEvent("done", {
              success: true,
              message: "No investments with URL and selector configured",
              total: 0,
              successCount: 0,
              failCount: 0,
              failedIds: [],
            });
          } else {
            // Step 3: Launch browser and scrape investments using breadth-first retry.
            // Pass 1 attempts every investment once. Subsequent passes retry only
            // the failures from the previous pass, avoiding the delay of retrying
            // a single broken investment multiple times before moving on.
            browser = await launchBrowser();
            let successCount = 0;
            let previousDomain = "";
            let failedInvestments = [...investments];
            const finalFailedIds = [];
            // Track the last scrape result for each investment so we can record
            // the final failure with correct errorCode/errorMessage after all passes.
            const lastResultByInvestmentId = new Map();

            for (let pass = 1; pass <= SCRAPE_RETRY_CONFIG.maxAttempts; pass++) {
              // On retry passes, notify the UI and wait before retrying
              if (pass > 1) {
                if (failedInvestments.length === 0) {
                  break;
                }
                const retryDelay = SCRAPE_RETRY_CONFIG.retryDelays[pass - 2] || 2000;
                sendEvent("retry_pass", {
                  pass: pass,
                  maxPasses: SCRAPE_RETRY_CONFIG.maxAttempts,
                  retryCount: failedInvestments.length,
                  delay: retryDelay,
                });
                await sleep(retryDelay);
                previousDomain = "";
              }

              const stillFailed = [];

              let itemIndex = 0;

              for (const investment of failedInvestments) {
                itemIndex++;
                // Stop if client disconnected or stream timed out
                if (connectionLost || streamTimedOut) {
                  console.log("[Scraper] Stream stopped: connectionLost=" + connectionLost + " streamTimedOut=" + streamTimedOut);
                  if (streamTimedOut && !connectionLost) {
                    sendEvent("error", { error: "Stream timed out after 10 minutes" });
                  }
                  clearInterval(keepaliveId);
                  clearTimeout(streamTimeoutId);
                  try { controller.close(); } catch { /* already closed */ }
                  return;
                }

                // Relaunch browser if it has crashed
                if (!isBrowserAlive(browser)) {
                  console.log("[Scraper] Browser crashed — relaunching");
                  try {
                    await browser.close();
                  } catch {
                    // Already dead — ignore
                  }
                  browser = await launchBrowser();
                  previousDomain = "";
                }

                const currentDomain = extractDomain(investment.investment_url);
                const delayMs = calculateDelay(previousDomain, currentDomain);
                if (delayMs > 0) {
                  console.log("[Scraper] Delay " + delayMs + "ms before investment " + investment.id + " (" + investment.description + ")");
                  await sleep(delayMs);
                }

                console.log("[Scraper] Pass " + pass + " item " + itemIndex + "/" + failedInvestments.length + ": scraping investment " + investment.id + " (" + investment.description + ")");

                // Per-item timeout: if a single scrape (including fallback chains)
                // takes longer than 2 minutes, abandon it and move on. This prevents
                // the entire batch from stalling on one slow/hung item.
                const ITEM_TIMEOUT_MS = 120000;
                const priceResult = await Promise.race([
                  scrapeSingleInvestmentPrice(investment, browser, {
                    scrapeTime: scrapeTime,
                    attemptNumber: pass,
                    skipHistoryRecord: true,
                  }),
                  sleep(ITEM_TIMEOUT_MS).then(function () { return null; }),
                ]);

                // If the item timed out, close and relaunch the browser to clean up
                // any abandoned pages/contexts from the timed-out scrape
                if (priceResult === null) {
                  console.warn("[Scraper] Item timeout after " + (ITEM_TIMEOUT_MS / 1000) + "s for investment " + investment.id + " (" + investment.description + ")");
                  try { await browser.close(); } catch { /* ignore */ }
                  browser = await launchBrowser();
                  previousDomain = "";

                  const timeoutResult = {
                    success: false,
                    investmentId: investment.id,
                    description: investment.description,
                    rawPrice: "",
                    parsedPrice: null,
                    priceMinorUnit: null,
                    currency: investment.currency_code || "",
                    error: "Scrape timed out after " + (ITEM_TIMEOUT_MS / 1000) + " seconds",
                    errorCode: "ITEM_TIMEOUT",
                    attemptNumber: pass,
                    maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                  };
                  sendEvent("price", timeoutResult);
                  stillFailed.push(investment);
                  lastResultByInvestmentId.set(investment.id, timeoutResult);
                  continue;
                }

                previousDomain = currentDomain;
                priceResult.attemptNumber = pass;
                priceResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
                sendEvent("price", priceResult);

                if (priceResult.success) {
                  successCount++;
                  // Record success immediately — one row with the pass it succeeded on
                  try {
                    recordScrapingAttempt({
                      scrapeType: "investment",
                      referenceId: investment.id,
                      attemptNumber: pass,
                      maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                      success: true,
                    });
                  } catch (historyErr) {
                    console.warn("[Scraper] Failed to record scraping history for investment " + investment.id + ": " + historyErr.message);
                  }
                } else {
                  stillFailed.push(investment);
                  lastResultByInvestmentId.set(investment.id, priceResult);
                }
              }

              failedInvestments = stillFailed;
            }

            // Record final failures — one row per item that failed all passes
            const failCount = failedInvestments.length;
            for (const inv of failedInvestments) {
              finalFailedIds.push(inv.id);
              const lastResult = lastResultByInvestmentId.get(inv.id);
              try {
                recordScrapingAttempt({
                  scrapeType: "investment",
                  referenceId: inv.id,
                  attemptNumber: SCRAPE_RETRY_CONFIG.maxAttempts,
                  maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                  success: false,
                  errorCode: lastResult ? lastResult.errorCode : null,
                  errorMessage: lastResult ? lastResult.error : null,
                });
              } catch (historyErr) {
                console.warn("[Scraper] Failed to record scraping history for investment " + inv.id + ": " + historyErr.message);
              }
            }

            // Flush the WAL file so the database is clean for the next batch
            checkpointDatabase();

            // Step 4: Send done event with summary
            const total = successCount + failCount;
            let message = "Scraped " + successCount + " of " + total + " investment price" + (total === 1 ? "" : "s");
            if (failCount > 0) {
              message += " (" + failCount + " failed after " + SCRAPE_RETRY_CONFIG.maxAttempts + " pass" + (SCRAPE_RETRY_CONFIG.maxAttempts === 1 ? "" : "es") + ")";
            }

            sendEvent("done", {
              success: true,
              message: message,
              total: total,
              successCount: successCount,
              failCount: failCount,
              failedIds: finalFailedIds,
            });
          }
        } catch (err) {
          sendEvent("error", { error: err.message });
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch {
              // Ignore close errors
            }
          }
        }

        clearInterval(keepaliveId);
        clearTimeout(streamTimeoutId);
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
    return new Response(JSON.stringify({ error: "Failed to start price scraping stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/scraper/prices/retry — retry scraping specific failed investments
// Body: { ids: number[] } - array of investment IDs to retry
// IMPORTANT: This literal route must be registered before the /:id parameterised
// route below, otherwise the router matches "retry" as an :id value.
scraperRouter.post("/api/scraper/prices/retry", async function (request) {
  try {
    const body = await request.json();
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or empty ids array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const scrapeTime = new Date().toTimeString().slice(0, 8);
    const results = [];
    let successCount = 0;

    // Launch a shared browser for efficiency
    const browser = await launchBrowser();

    try {
      for (const id of ids) {
        const result = await scrapePriceById(id, { scrapeTime: scrapeTime });
        results.push(result);
        if (result.success) successCount++;
      }
    } finally {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
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
    return new Response(JSON.stringify({ error: "Failed to retry price scraping", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/scraper/prices/:id — scrape price for a single investment
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
scraperRouter.post("/api/scraper/prices/:id", async function (request, params) {
  try {
    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    const result = await scrapePriceById(Number(params.id), { testMode: testMode });

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
    return new Response(JSON.stringify({ error: "Failed to scrape price", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/scraper/benchmarks — scrape values for all configured benchmarks
scraperRouter.post("/api/scraper/benchmarks", async function () {
  try {
    const result = await scrapeAllBenchmarks();

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to scrape benchmarks", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/scraper/benchmarks/stream — SSE stream that scrapes benchmark values one-by-one
// Sends events: "init" (benchmark list), "benchmark" (each result), "done" (summary)
// Query parameter: ids=1,2,3 — optional, scrape only these benchmark IDs (for batched scraping)
scraperRouter.get("/api/scraper/benchmarks/stream", async function (request) {
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

        let streamTimedOut = false;
        let streamTimeoutId = null;

        let browser = null;

        try {
          // Parse query parameters for batched scraping
          const url = new URL(request.url);
          const idsParam = url.searchParams.get("ids");

          // Capture timestamp once for the entire fetch run so all values share it
          const scrapeTime = new Date().toTimeString().slice(0, 8);
          const method = getPriceMethodConfig();

          // -----------------------------------------------------------------
          // API method — Yahoo Finance API, no browser, single pass, random delays
          // -----------------------------------------------------------------
          if (method === "api") {
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

            let benchmarks = getYahooScrapeableBenchmarks();

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
                  console.log("[Scraper/YF] Connection lost — stopping");
                  break;
                }

                // Random delay of 5-30 seconds between API calls (skip before first item)
                if (!isFirstItem) {
                  const delayMs = Math.floor(Math.random() * 25001) + 5000;
                  console.log("[Scraper/YF] Delay " + delayMs + "ms before benchmark " + benchmark.id + " (" + benchmark.description + ")");
                  await sleep(delayMs);
                }
                isFirstItem = false;

                // Skip benchmarks without Yahoo ticker (e.g. MSCI)
                if (!benchmark.yahooResolvable) {
                  console.log("[Scraper/YF] Skipping benchmark " + benchmark.id + " — no API source");
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
                  console.log("[Scraper/YF] No value history for benchmark " + benchmark.id + " — backfilling...");
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

                console.log("[Scraper/YF] Fetching value for benchmark " + benchmark.id + " (" + benchmark.description + ")");

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
                    recordScrapingAttempt({
                      scrapeType: "benchmark",
                      referenceId: benchmark.id,
                      attemptNumber: 1,
                      maxAttempts: 1,
                      success: true,
                    });
                  } catch (historyErr) {
                    console.warn("[Scraper/YF] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
                  }
                } else {
                  failedIds.push(benchmark.id);
                  // Only record non-ticker-missing failures in history
                  if (benchmarkResult.errorCode !== "NO_YAHOO_TICKER") {
                    try {
                      recordScrapingAttempt({
                        scrapeType: "benchmark",
                        referenceId: benchmark.id,
                        attemptNumber: 1,
                        maxAttempts: 1,
                        success: false,
                        errorCode: benchmarkResult.errorCode,
                        errorMessage: benchmarkResult.error,
                      });
                    } catch (historyErr) {
                      console.warn("[Scraper/YF] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
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

            clearInterval(keepaliveId);
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          // -----------------------------------------------------------------
          // Web scrape method (default) — Playwright browser-based scraping
          // -----------------------------------------------------------------

          // Get the list of benchmarks to scrape
          let benchmarks = getScrapeableBenchmarks();

          // If specific IDs were requested, filter to just those
          if (idsParam) {
            const requestedIds = new Set(idsParam.split(",").map(Number));
            benchmarks = benchmarks.filter(function (bm) {
              return requestedIds.has(bm.id);
            });
          }

          // Stream timeout: 60s per item, minimum 10 minutes
          const streamTimeoutMs = Math.max(600000, benchmarks.length * 60000);
          streamTimeoutId = setTimeout(function () {
            streamTimedOut = true;
          }, streamTimeoutMs);

          // Send init event with the benchmark list
          sendEvent("init", {
            benchmarks: benchmarks.map(function (bm) {
              return {
                benchmarkId: bm.id,
                description: bm.description,
                benchmarkType: bm.benchmark_type,
                currency: bm.currency_code,
              };
            }),
            total: benchmarks.length,
          });

          if (benchmarks.length === 0) {
            sendEvent("done", {
              success: true,
              message: "No benchmarks with URL and selector configured",
              total: 0,
              successCount: 0,
              failCount: 0,
              failedIds: [],
            });
          } else {
            // Launch browser and scrape benchmarks using breadth-first retry.
            // Pass 1 attempts every benchmark once. Subsequent passes retry only
            // the failures from the previous pass.
            browser = await launchBrowser();
            let successCount = 0;
            let previousDomain = "";
            let failedBenchmarks = [...benchmarks];
            const finalFailedIds = [];
            // Track the last scrape result for each benchmark so we can record
            // the final failure with correct errorCode/errorMessage after all passes.
            const lastResultByBenchmarkId = new Map();

            for (let pass = 1; pass <= SCRAPE_RETRY_CONFIG.maxAttempts; pass++) {
              // On retry passes, notify the UI and wait before retrying
              if (pass > 1) {
                if (failedBenchmarks.length === 0) {
                  break;
                }
                const retryDelay = SCRAPE_RETRY_CONFIG.retryDelays[pass - 2] || 2000;
                sendEvent("retry_pass", {
                  pass: pass,
                  maxPasses: SCRAPE_RETRY_CONFIG.maxAttempts,
                  retryCount: failedBenchmarks.length,
                  delay: retryDelay,
                });
                await sleep(retryDelay);
                previousDomain = "";
              }

              const stillFailed = [];
              let bmItemIndex = 0;

              for (const benchmark of failedBenchmarks) {
                bmItemIndex++;
                // Stop if client disconnected or stream timed out
                if (connectionLost || streamTimedOut) {
                  console.log("[Scraper] Benchmark stream stopped: connectionLost=" + connectionLost + " streamTimedOut=" + streamTimedOut);
                  if (streamTimedOut && !connectionLost) {
                    sendEvent("error", { error: "Stream timed out after 10 minutes" });
                  }
                  clearInterval(keepaliveId);
                  clearTimeout(streamTimeoutId);
                  try { controller.close(); } catch { /* already closed */ }
                  return;
                }

                // Relaunch browser if it has crashed
                if (!isBrowserAlive(browser)) {
                  try {
                    await browser.close();
                  } catch {
                    // Already dead — ignore
                  }
                  browser = await launchBrowser();
                  previousDomain = "";
                }

                const currentDomain = extractBenchmarkDomain(benchmark.benchmark_url);
                const delayMs = calculateBenchmarkDelay(previousDomain, currentDomain);
                if (delayMs > 0) {
                  console.log("[Scraper] Delay " + delayMs + "ms before benchmark " + benchmark.id + " (" + benchmark.description + ")");
                  await sleep(delayMs);
                }

                console.log("[Scraper] Pass " + pass + " item " + bmItemIndex + "/" + failedBenchmarks.length + ": scraping benchmark " + benchmark.id + " (" + benchmark.description + ")");

                // Per-item timeout: if a single scrape takes longer than 2 minutes,
                // abandon it and move on.
                const ITEM_TIMEOUT_MS = 120000;
                const benchmarkResult = await Promise.race([
                  scrapeSingleBenchmarkValue(benchmark, browser, {
                    scrapeTime: scrapeTime,
                    attemptNumber: pass,
                    skipHistoryRecord: true,
                  }),
                  sleep(ITEM_TIMEOUT_MS).then(function () { return null; }),
                ]);

                if (benchmarkResult === null) {
                  console.warn("[Scraper] Item timeout after " + (ITEM_TIMEOUT_MS / 1000) + "s for benchmark " + benchmark.id + " (" + benchmark.description + ")");
                  try { await browser.close(); } catch { /* ignore */ }
                  browser = await launchBrowser();
                  previousDomain = "";

                  const timeoutResult = {
                    success: false,
                    benchmarkId: benchmark.id,
                    description: benchmark.description,
                    rawValue: "",
                    parsedValue: null,
                    error: "Scrape timed out after " + (ITEM_TIMEOUT_MS / 1000) + " seconds",
                    errorCode: "ITEM_TIMEOUT",
                    attemptNumber: pass,
                    maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                  };
                  sendEvent("benchmark", timeoutResult);
                  stillFailed.push(benchmark);
                  lastResultByBenchmarkId.set(benchmark.id, timeoutResult);
                  continue;
                }

                previousDomain = currentDomain;
                benchmarkResult.attemptNumber = pass;
                benchmarkResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
                sendEvent("benchmark", benchmarkResult);

                if (benchmarkResult.success) {
                  successCount++;
                  // Record success immediately — one row with the pass it succeeded on
                  try {
                    recordScrapingAttempt({
                      scrapeType: "benchmark",
                      referenceId: benchmark.id,
                      attemptNumber: pass,
                      maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                      success: true,
                    });
                  } catch (historyErr) {
                    console.warn("[Scraper] Failed to record scraping history for benchmark " + benchmark.id + ": " + historyErr.message);
                  }
                } else {
                  stillFailed.push(benchmark);
                  lastResultByBenchmarkId.set(benchmark.id, benchmarkResult);
                }
              }

              failedBenchmarks = stillFailed;
            }

            // Record final failures — one row per item that failed all passes
            const failCount = failedBenchmarks.length;
            for (const bm of failedBenchmarks) {
              finalFailedIds.push(bm.id);
              const lastResult = lastResultByBenchmarkId.get(bm.id);
              try {
                recordScrapingAttempt({
                  scrapeType: "benchmark",
                  referenceId: bm.id,
                  attemptNumber: SCRAPE_RETRY_CONFIG.maxAttempts,
                  maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                  success: false,
                  errorCode: lastResult ? lastResult.errorCode : null,
                  errorMessage: lastResult ? lastResult.error : null,
                });
              } catch (historyErr) {
                console.warn("[Scraper] Failed to record scraping history for benchmark " + bm.id + ": " + historyErr.message);
              }
            }

            // Flush the WAL file so the database is clean for the next batch
            checkpointDatabase();

            // Send done event with summary
            const total = successCount + failCount;
            let message = "Scraped " + successCount + " of " + total + " benchmark value" + (total === 1 ? "" : "s");
            if (failCount > 0) {
              message += " (" + failCount + " failed after " + SCRAPE_RETRY_CONFIG.maxAttempts + " pass" + (SCRAPE_RETRY_CONFIG.maxAttempts === 1 ? "" : "es") + ")";
            }

            sendEvent("done", {
              success: true,
              message: message,
              total: total,
              successCount: successCount,
              failCount: failCount,
              failedIds: finalFailedIds,
            });
          }
        } catch (err) {
          sendEvent("error", { error: err.message });
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch {
              // Ignore close errors
            }
          }
        }

        clearInterval(keepaliveId);
        clearTimeout(streamTimeoutId);
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
    return new Response(JSON.stringify({ error: "Failed to start benchmark scraping stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/scraper/benchmarks/retry — retry scraping specific failed benchmarks
// Body: { ids: number[] } - array of benchmark IDs to retry
// IMPORTANT: This literal route must be registered before the /:id parameterised
// route below, otherwise the router matches "retry" as an :id value.
scraperRouter.post("/api/scraper/benchmarks/retry", async function (request) {
  try {
    const body = await request.json();
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or empty ids array" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const scrapeTime = new Date().toTimeString().slice(0, 8);
    const results = [];
    let successCount = 0;

    // Launch a shared browser for efficiency
    const browser = await launchBrowser();

    try {
      for (const id of ids) {
        const result = await scrapeBenchmarkById(id, { scrapeTime: scrapeTime });
        results.push(result);
        if (result.success) successCount++;
      }
    } finally {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
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
    return new Response(JSON.stringify({ error: "Failed to retry benchmark scraping", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/scraper/benchmarks/:id — scrape value for a single benchmark
// Query parameter: testMode=true to skip database writes (returns JSON without updating tables)
scraperRouter.post("/api/scraper/benchmarks/:id", async function (request, params) {
  try {
    const url = new URL(request.url);
    const testMode = url.searchParams.get("testMode") === "true";

    const result = await scrapeBenchmarkById(Number(params.id), { testMode: testMode });

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
    return new Response(JSON.stringify({ error: "Failed to scrape benchmark", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/scraper/history — get scraping history with optional filters
// Query parameters: scrapeType, success, startDate, endDate, limit, offset
scraperRouter.get("/api/scraper/history", function (request) {
  try {
    const url = new URL(request.url);
    const filters = {};

    const scrapeType = url.searchParams.get("scrapeType");
    if (scrapeType) {
      filters.scrapeType = scrapeType;
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

    const autoScrapeOnly = url.searchParams.get("autoScrapeOnly");
    if (autoScrapeOnly !== null) {
      filters.autoScrapeOnly = autoScrapeOnly === "true";
    }

    const history = getScrapingHistoryWithDescriptions(filters);
    const totalCount = getScrapingHistoryCount(filters);

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
    return new Response(JSON.stringify({ error: "Failed to get scraping history", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/scraper/last-scrape — get last successful scrape datetime for each type
scraperRouter.get("/api/scraper/last-scrape", function () {
  try {
    const lastCurrency = getLastSuccessfulScrapeByType("currency");
    const lastInvestment = getLastSuccessfulScrapeByType("investment");
    const lastBenchmark = getLastSuccessfulScrapeByType("benchmark");

    return new Response(
      JSON.stringify({
        currency: lastCurrency,
        investment: lastInvestment,
        benchmark: lastBenchmark,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to get last scrape times", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/scraper/latest-failures — get items whose most recent scrape history record is a failure
// Returns investment and benchmark failures separately for the UI retry buttons
scraperRouter.get("/api/scraper/latest-failures", function () {
  try {
    const failures = getLatestFailures();
    const investmentFailures = failures.filter(function (f) {
      return f.scrape_type === "investment";
    });
    const benchmarkFailures = failures.filter(function (f) {
      return f.scrape_type === "benchmark";
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

// GET /api/scraper/scheduler-status — get the current status of the scheduled scraper
scraperRouter.get("/api/scraper/scheduler-status", function () {
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

// PATCH /api/investments/:id/auto-scrape — toggle auto-scrape flag
scraperRouter.patch("/api/investments/:id/auto-scrape", async function (request, params) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: "Invalid investment ID" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const body = await request.json();
    if (body.autoScrape === undefined) {
      return new Response(JSON.stringify({ error: "autoScrape field is required (true or false)" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const updated = updateAutoScrape(id, body.autoScrape);
    if (!updated) {
      return new Response(JSON.stringify({ error: "Investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(updated), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to update auto-scrape setting", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle a scraper API request. Delegates to the scraper router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleScraperRoute(method, path, request) {
  return await scraperRouter.match(method, path, request);
}
