import { Router } from "../router.js";
import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import { getLatestRates } from "../db/currency-rates-db.js";
import { scrapeAllPrices, scrapePriceById, getScrapeableInvestments, scrapeSingleInvestmentPrice, extractDomain, calculateDelay } from "../scrapers/price-scraper.js";
import { scrapeAllBenchmarks, scrapeBenchmarkById, getScrapeableBenchmarks, scrapeSingleBenchmarkValue, extractDomain as extractBenchmarkDomain, calculateDelay as calculateBenchmarkDelay } from "../scrapers/benchmark-scraper.js";
import { getScrapingHistoryWithDescriptions, getScrapingHistoryCount, getLastSuccessfulScrapeByType } from "../db/scraping-history-db.js";
import { launchBrowser } from "../scrapers/browser-utils.js";
import { SCRAPE_RETRY_CONFIG } from "../../shared/constants.js";

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
            // Step 3: Launch browser and scrape each investment, streaming results
            browser = await launchBrowser();
            let successCount = 0;
            let failCount = 0;
            let previousDomain = "";
            const failedIds = [];

            for (const investment of investments) {
              // Random delay between requests to avoid rate-limiting/blocking
              const currentDomain = extractDomain(investment.investment_url);
              const delayMs = calculateDelay(previousDomain, currentDomain);
              if (delayMs > 0) {
                await sleep(delayMs);
              }

              // Try scraping with retry logic
              let priceResult = null;
              let attemptNumber = 1;

              while (attemptNumber <= SCRAPE_RETRY_CONFIG.maxAttempts) {
                priceResult = await scrapeSingleInvestmentPrice(investment, browser, {
                  scrapeTime: scrapeTime,
                  attemptNumber: attemptNumber,
                });

                if (priceResult.success) {
                  break; // Success, no need to retry
                }

                // Check if we should retry
                if (attemptNumber < SCRAPE_RETRY_CONFIG.maxAttempts) {
                  const retryDelay = SCRAPE_RETRY_CONFIG.retryDelays[attemptNumber - 1] || 2000;
                  // Send a retry event so UI can show retry status
                  sendEvent("retry", {
                    investmentId: investment.id,
                    description: investment.description,
                    attemptNumber: attemptNumber,
                    maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                    error: priceResult.error,
                    retryingIn: retryDelay,
                  });
                  await sleep(retryDelay);
                }

                attemptNumber++;
              }

              previousDomain = currentDomain;
              // Add attempt info to result for UI display
              priceResult.attemptNumber = attemptNumber > SCRAPE_RETRY_CONFIG.maxAttempts ? SCRAPE_RETRY_CONFIG.maxAttempts : attemptNumber;
              priceResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
              sendEvent("price", priceResult);

              if (priceResult.success) {
                successCount++;
              } else {
                failCount++;
                failedIds.push(investment.id);
              }
            }

            // Step 4: Send done event with summary
            const total = successCount + failCount;
            let message = "Scraped " + successCount + " of " + total + " investment price" + (total === 1 ? "" : "s");
            if (failCount > 0) {
              message += " (" + failCount + " failed after " + SCRAPE_RETRY_CONFIG.maxAttempts + " attempts each)";
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
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch {
              // Ignore close errors
            }
          }
        }

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
            // Launch browser and scrape each benchmark, streaming results
            browser = await launchBrowser();
            let successCount = 0;
            let failCount = 0;
            let previousDomain = "";
            const failedIds = [];

            for (const benchmark of benchmarks) {
              // Random delay between requests to avoid rate-limiting/blocking
              const currentDomain = extractBenchmarkDomain(benchmark.benchmark_url);
              const delayMs = calculateBenchmarkDelay(previousDomain, currentDomain);
              if (delayMs > 0) {
                await sleep(delayMs);
              }

              // Try scraping with retry logic
              let benchmarkResult = null;
              let attemptNumber = 1;

              while (attemptNumber <= SCRAPE_RETRY_CONFIG.maxAttempts) {
                benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, browser, {
                  scrapeTime: scrapeTime,
                  attemptNumber: attemptNumber,
                });

                if (benchmarkResult.success) {
                  break; // Success, no need to retry
                }

                // Check if we should retry
                if (attemptNumber < SCRAPE_RETRY_CONFIG.maxAttempts) {
                  const retryDelay = SCRAPE_RETRY_CONFIG.retryDelays[attemptNumber - 1] || 2000;
                  // Send a retry event so UI can show retry status
                  sendEvent("retry", {
                    benchmarkId: benchmark.id,
                    description: benchmark.description,
                    attemptNumber: attemptNumber,
                    maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                    error: benchmarkResult.error,
                    retryingIn: retryDelay,
                  });
                  await sleep(retryDelay);
                }

                attemptNumber++;
              }

              previousDomain = currentDomain;
              // Add attempt info to result for UI display
              benchmarkResult.attemptNumber = attemptNumber > SCRAPE_RETRY_CONFIG.maxAttempts ? SCRAPE_RETRY_CONFIG.maxAttempts : attemptNumber;
              benchmarkResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
              sendEvent("benchmark", benchmarkResult);

              if (benchmarkResult.success) {
                successCount++;
              } else {
                failCount++;
                failedIds.push(benchmark.id);
              }
            }

            // Send done event with summary
            const total = successCount + failCount;
            let message = "Scraped " + successCount + " of " + total + " benchmark value" + (total === 1 ? "" : "s");
            if (failCount > 0) {
              message += " (" + failCount + " failed after " + SCRAPE_RETRY_CONFIG.maxAttempts + " attempts each)";
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
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch {
              // Ignore close errors
            }
          }
        }

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
