import { Router } from "../router.js";
import { getAllTestInvestments, getTestInvestmentById, createTestInvestment, updateTestInvestment, deleteTestInvestment, updateTestResult, resetTestInvestments } from "../db/test-investments-db.js";
import { getTestPriceHistory } from "../db/test-prices-db.js";
import { upsertTestPrice } from "../db/test-prices-db.js";
import { getAllInvestmentTypes } from "../db/investment-types-db.js";
import { validateTestInvestment } from "../validation.js";
import { getScraperTestingEnabled } from "../config.js";
import { scrapeSingleInvestmentPrice, extractDomain, calculateDelay, parsePrice, normaliseToMinorUnit, resolveScrapingConfig } from "../scrapers/price-scraper.js";
import { launchBrowser } from "../scrapers/browser-utils.js";
import { SCRAPE_RETRY_CONFIG } from "../../shared/constants.js";
import { testBackfillTestInvestment } from "../services/historic-backfill.js";

/**
 * @description Router instance for test investment API routes.
 * @type {Router}
 */
const testInvestmentsRouter = new Router();

/**
 * @description Create a 403 response when scraper testing is disabled.
 * @returns {Response} 403 JSON response
 */
function featureDisabledResponse() {
  return new Response(
    JSON.stringify({
      error: "Scraper testing is not enabled",
      detail: "Set scraperTesting.enabled to true in Edit Settings to use this feature.",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

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

/** @type {boolean} Server-side lock to prevent concurrent Test All streams */
let testAllRunning = false;

// GET /api/test-investments — list all test investments
testInvestmentsRouter.get("/api/test-investments", function () {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const testInvestments = getAllTestInvestments();
    return new Response(JSON.stringify(testInvestments), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch test investments", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/test-investments/reset — reset all test data from seed SQL
testInvestmentsRouter.post("/api/test-investments/reset", function () {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const result = resetTestInvestments();
    return new Response(
      JSON.stringify({
        message: "Test data reset: " + result.hardCodedCount + " hard-coded + " + result.liveCopiedCount + " from live portfolio = " + result.totalCount + " total",
        totalCount: result.totalCount,
        hardCodedCount: result.hardCodedCount,
        liveCopiedCount: result.liveCopiedCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to reset test data", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/test-investments/:id/scrape-config — resolve the effective URL and selector
testInvestmentsRouter.get("/api/test-investments/:id/scrape-config", function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const testInvestment = getTestInvestmentById(Number(params.id));
    if (!testInvestment) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const config = resolveScrapingConfig(testInvestment);
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to resolve scrape config", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/test-investments/:id/backfill/test — preview historic data availability from Morningstar
testInvestmentsRouter.get("/api/test-investments/:id/backfill/test", async function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const result = await testBackfillTestInvestment(Number(params.id));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/test-investments/:id — get a single test investment
testInvestmentsRouter.get("/api/test-investments/:id", function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const testInvestment = getTestInvestmentById(Number(params.id));
    if (!testInvestment) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(testInvestment), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch test investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/test-investments/:id/prices — get price history for a test investment
testInvestmentsRouter.get("/api/test-investments/:id/prices", function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const testInvestment = getTestInvestmentById(Number(params.id));
    if (!testInvestment) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const prices = getTestPriceHistory(Number(params.id));
    return new Response(JSON.stringify(prices), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch test prices", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/test-investments — create a new test investment
testInvestmentsRouter.post("/api/test-investments", async function (request) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Coerce IDs to numbers
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }
  if (body.investment_type_id !== undefined && body.investment_type_id !== null) {
    body.investment_type_id = Number(body.investment_type_id);
  }

  const errors = validateTestInvestment(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const testInvestment = createTestInvestment(body);
    return new Response(JSON.stringify(testInvestment), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(JSON.stringify({ error: "Invalid reference", detail: "The selected currency or investment type does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to create test investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// PUT /api/test-investments/:id — update an existing test investment
testInvestmentsRouter.put("/api/test-investments/:id", async function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Coerce IDs to numbers
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }
  if (body.investment_type_id !== undefined && body.investment_type_id !== null) {
    body.investment_type_id = Number(body.investment_type_id);
  }

  const errors = validateTestInvestment(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const testInvestment = updateTestInvestment(Number(params.id), body);
    if (!testInvestment) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(testInvestment), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(JSON.stringify({ error: "Invalid reference", detail: "The selected currency or investment type does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to update test investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// DELETE /api/test-investments/:id — delete a test investment (cascades to test_prices)
testInvestmentsRouter.delete("/api/test-investments/:id", function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const deleted = deleteTestInvestment(Number(params.id));
    if (!deleted) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "Test investment deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete test investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/test-investments/:id/scrape — scrape price for a single test investment
testInvestmentsRouter.post("/api/test-investments/:id/scrape", async function (request, params) {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  try {
    const testInvestment = getTestInvestmentById(Number(params.id));
    if (!testInvestment) {
      return new Response(JSON.stringify({ error: "Test investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const scrapeTime = new Date().toTimeString().slice(0, 8);
    const today = new Date().toISOString().split("T")[0];

    // testMode skips writing to live prices table; startedBy=3 marks as test investment scrape
    const priceResult = await scrapeSingleInvestmentPrice(testInvestment, null, {
      testMode: true,
      startedBy: 3,
      scrapeTime: scrapeTime,
      sourceTable: "test_investments",
    });

    // Store the price in test_prices (not live prices) and update last_test_* fields
    if (priceResult.success) {
      upsertTestPrice(testInvestment.id, today, scrapeTime, priceResult.priceMinorUnit);
      updateTestResult(testInvestment.id, today, true, String(priceResult.priceMinorUnit));
    } else {
      updateTestResult(testInvestment.id, today, false, null);
    }

    return new Response(JSON.stringify(priceResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to scrape test investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/test-investments/scrape/stream — SSE stream that scrapes all test investments
testInvestmentsRouter.get("/api/test-investments/scrape/stream", async function () {
  if (!getScraperTestingEnabled()) return featureDisabledResponse();

  if (testAllRunning) {
    return new Response(JSON.stringify({ error: "Test All already running", detail: "A Test All operation is already in progress. Wait for it to finish or restart the server." }), { status: 409, headers: { "Content-Type": "application/json" } });
  }

  try {
    testAllRunning = true;
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
          const scrapeTime = new Date().toTimeString().slice(0, 8);
          const today = new Date().toISOString().split("T")[0];
          const testInvestments = getAllTestInvestments();

          // Filter to scrapeable test investments (have URL or public_id)
          const scrapeable = testInvestments.filter(function (ti) {
            return ti.investment_url || ti.public_id;
          });

          sendEvent("init", {
            investments: scrapeable.map(function (ti) {
              return {
                investmentId: ti.id,
                description: ti.description,
                currency: ti.currency_code,
              };
            }),
            total: scrapeable.length,
          });

          if (scrapeable.length === 0) {
            sendEvent("done", {
              success: true,
              message: "No test investments with URL or public ID configured",
              total: 0,
              successCount: 0,
              failCount: 0,
              failedIds: [],
            });
          } else {
            browser = await launchBrowser();
            let successCount = 0;
            let failCount = 0;
            let previousDomain = "";
            const failedIds = [];

            for (const testInvestment of scrapeable) {
              // Random delay between requests
              const currentDomain = extractDomain(testInvestment.investment_url || "");
              const delayMs = calculateDelay(previousDomain, currentDomain);
              if (delayMs > 0) {
                await sleep(delayMs);
              }

              // Scrape with retry logic
              let priceResult = null;
              let attemptNumber = 1;

              while (attemptNumber <= SCRAPE_RETRY_CONFIG.maxAttempts) {
                priceResult = await scrapeSingleInvestmentPrice(testInvestment, browser, {
                  testMode: true,
                  startedBy: 3,
                  scrapeTime: scrapeTime,
                  attemptNumber: attemptNumber,
                  sourceTable: "test_investments",
                });

                if (priceResult.success) break;

                if (attemptNumber < SCRAPE_RETRY_CONFIG.maxAttempts) {
                  const retryDelay = SCRAPE_RETRY_CONFIG.retryDelays[attemptNumber - 1] || 2000;
                  sendEvent("retry", {
                    investmentId: testInvestment.id,
                    description: testInvestment.description,
                    attemptNumber: attemptNumber,
                    maxAttempts: SCRAPE_RETRY_CONFIG.maxAttempts,
                    error: priceResult.error,
                    retryingIn: retryDelay,
                  });
                  await sleep(retryDelay);
                }

                attemptNumber++;
              }

              // Store result in test_prices and update last_test_* fields
              if (priceResult.success) {
                upsertTestPrice(testInvestment.id, today, scrapeTime, priceResult.priceMinorUnit);
                updateTestResult(testInvestment.id, today, true, String(priceResult.priceMinorUnit));
                successCount++;
              } else {
                updateTestResult(testInvestment.id, today, false, null);
                failCount++;
                failedIds.push(testInvestment.id);
              }

              previousDomain = currentDomain;
              priceResult.attemptNumber = attemptNumber > SCRAPE_RETRY_CONFIG.maxAttempts ? SCRAPE_RETRY_CONFIG.maxAttempts : attemptNumber;
              priceResult.maxAttempts = SCRAPE_RETRY_CONFIG.maxAttempts;
              sendEvent("price", priceResult);

              // Run Morningstar historic data preview after the price scrape
              try {
                const historyResult = await testBackfillTestInvestment(testInvestment.id);
                // Cross-validate: compare live scrape price with most recent Morningstar price
                const historyEvent = {
                  investmentId: testInvestment.id,
                  success: historyResult.success,
                  rows: historyResult.rows || [],
                  rowCount: historyResult.rows ? historyResult.rows.length : 0,
                  currency: historyResult.currency || "",
                  description: historyResult.description || "",
                  error: historyResult.error || null,
                  priceWarning: null,
                };
                if (priceResult.success && historyResult.success && historyResult.rows && historyResult.rows.length > 0) {
                  const scrapedMajor = priceResult.priceMinorUnit / 100;
                  const morningstarMajor = historyResult.rows[0].price;
                  if (morningstarMajor > 0) {
                    const pctDiff = (Math.abs(scrapedMajor - morningstarMajor) / morningstarMajor) * 100;
                    if (pctDiff > 5) {
                      historyEvent.priceWarning = "Price mismatch: scraped " + scrapedMajor.toFixed(4) + " vs Morningstar " + morningstarMajor.toFixed(4) + " (" + pctDiff.toFixed(1) + "% difference)";
                    }
                  }
                }
                sendEvent("history", historyEvent);
              } catch (historyErr) {
                sendEvent("history", {
                  investmentId: testInvestment.id,
                  success: false,
                  rows: [],
                  rowCount: 0,
                  error: historyErr.message,
                  priceWarning: null,
                });
              }

              // Small delay for Morningstar rate politeness
              await sleep(500);
            }

            const total = successCount + failCount;
            let message = "Tested " + successCount + " of " + total + " test investment" + (total === 1 ? "" : "s");
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

        testAllRunning = false;
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
    testAllRunning = false;
    return new Response(JSON.stringify({ error: "Failed to start test scraping stream", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle a test investment API request. Delegates to the test investments router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleTestInvestmentsRoute(method, path, request) {
  return await testInvestmentsRouter.match(method, path, request);
}
