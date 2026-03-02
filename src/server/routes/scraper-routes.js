import { Router } from "../router.js";
import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import { getLatestRates } from "../db/currency-rates-db.js";
import { getAllInvestments, getInvestmentById, updateAutoScrape } from "../db/investments-db.js";
import { getLatestPrice } from "../db/prices-db.js";
import { getAllBenchmarks } from "../db/benchmarks-db.js";
import { getLatestBenchmarkData } from "../db/benchmark-data-db.js";
import { scrapeAllPrices, scrapePriceById, getScrapeableInvestments, scrapeSingleInvestmentPrice, extractDomain, calculateDelay } from "../scrapers/price-scraper.js";
import { scrapeAllBenchmarks, scrapeBenchmarkById, getScrapeableBenchmarks, scrapeSingleBenchmarkValue, extractDomain as extractBenchmarkDomain, calculateDelay as calculateBenchmarkDelay } from "../scrapers/benchmark-scraper.js";
import { getScrapingHistoryWithDescriptions, getScrapingHistoryCount, getLastSuccessfulScrapeByType, recordScrapingAttempt } from "../db/scraping-history-db.js";
import { launchBrowser } from "../scrapers/browser-utils.js";
import { SCRAPE_RETRY_CONFIG } from "../../shared/constants.js";
import { getSchedulerStatus } from "../services/scheduled-scraper.js";

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

// GET /api/scraper/prices/stream — SSE stream that scrapes prices one-by-one
// Sends events: "init" (investment list + currency rates), "price" (each result), "done" (summary)
scraperRouter.get("/api/scraper/prices/stream", async function () {
  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        /**
         * @description Send an SSE event to the client.
         * @param {string} eventName - The event type
         * @param {Object} data - The data payload (will be JSON-stringified)
         */
        function sendEvent(eventName, data) {
          controller.enqueue(encoder.encode("event: " + eventName + "\n"));
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        }

        // Send SSE comment every 30s to prevent Bun's idleTimeout (255s) from
        // closing the connection during long gaps between price events.
        const keepaliveId = setInterval(function () {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepaliveId);
          }
        }, 30000);

        let browser = null;

        try {
          // Capture timestamp once for the entire fetch run so all values share it
          const scrapeTime = new Date().toTimeString().slice(0, 8);

          // Step 1: Fetch currency rates first (prices and rates must be contemporaneous)
          const currencyRatesResult = await fetchCurrencyRates({ scrapeTime: scrapeTime });

          // Step 2: Get the list of investments to scrape
          const investments = getScrapeableInvestments();

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

              for (const investment of failedInvestments) {
                const currentDomain = extractDomain(investment.investment_url);
                const delayMs = calculateDelay(previousDomain, currentDomain);
                if (delayMs > 0) {
                  await sleep(delayMs);
                }

                const priceResult = await scrapeSingleInvestmentPrice(investment, browser, {
                  scrapeTime: scrapeTime,
                  attemptNumber: pass,
                });

                previousDomain = currentDomain;
                priceResult.attemptNumber = pass;
                priceResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
                sendEvent("price", priceResult);

                if (priceResult.success) {
                  successCount++;
                } else {
                  stillFailed.push(investment);
                }
              }

              failedInvestments = stillFailed;
            }

            // Collect final failures after all passes
            const failCount = failedInvestments.length;
            for (const inv of failedInvestments) {
              finalFailedIds.push(inv.id);
            }

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
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to start price scraping stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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

// POST /api/scraper/prices/retry — retry scraping specific failed investments
// Body: { ids: number[] } - array of investment IDs to retry
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
scraperRouter.get("/api/scraper/benchmarks/stream", async function () {
  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        /**
         * @description Send an SSE event to the client.
         * @param {string} eventName - The event type
         * @param {Object} data - The data payload (will be JSON-stringified)
         */
        function sendEvent(eventName, data) {
          controller.enqueue(encoder.encode("event: " + eventName + "\n"));
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        }

        // Send SSE comment every 30s to prevent Bun's idleTimeout (255s) from
        // closing the connection during long gaps between benchmark events.
        const keepaliveId = setInterval(function () {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepaliveId);
          }
        }, 30000);

        let browser = null;

        try {
          // Capture timestamp once for the entire fetch run so all values share it
          const scrapeTime = new Date().toTimeString().slice(0, 8);

          // Get the list of benchmarks to scrape
          const benchmarks = getScrapeableBenchmarks();

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

              for (const benchmark of failedBenchmarks) {
                const currentDomain = extractBenchmarkDomain(benchmark.benchmark_url);
                const delayMs = calculateBenchmarkDelay(previousDomain, currentDomain);
                if (delayMs > 0) {
                  await sleep(delayMs);
                }

                const benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, browser, {
                  scrapeTime: scrapeTime,
                  attemptNumber: pass,
                });

                previousDomain = currentDomain;
                benchmarkResult.attemptNumber = pass;
                benchmarkResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
                sendEvent("benchmark", benchmarkResult);

                if (benchmarkResult.success) {
                  successCount++;
                } else {
                  stillFailed.push(benchmark);
                }
              }

              failedBenchmarks = stillFailed;
            }

            // Collect final failures after all passes
            const failCount = failedBenchmarks.length;
            for (const bm of failedBenchmarks) {
              finalFailedIds.push(bm.id);
            }

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
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to start benchmark scraping stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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

// POST /api/scraper/benchmarks/retry — retry scraping specific failed benchmarks
// Body: { ids: number[] } - array of benchmark IDs to retry
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
