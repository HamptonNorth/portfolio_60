import { Router } from "../router.js";
import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import { getLatestRates } from "../db/currency-rates-db.js";
import { scrapeAllPrices, scrapePriceById, getScrapeableInvestments, scrapeSingleInvestmentPrice, extractDomain, calculateDelay } from "../scrapers/price-scraper.js";
import { chromium } from "playwright";

/**
 * @description Router instance for scraper API routes.
 * These routes are UNPROTECTED (no passphrase required) so that
 * future cron-scheduled scraping can run without user interaction.
 * @type {Router}
 */
const scraperRouter = new Router();

// POST /api/scraper/currency-rates — fetch and store current exchange rates
scraperRouter.post("/api/scraper/currency-rates", async function () {
  try {
    const result = await fetchCurrencyRates();

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.message,
          detail: result.error || "",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
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
          // Step 1: Fetch currency rates first (prices and rates must be contemporaneous)
          const currencyRatesResult = await fetchCurrencyRates();

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
            });
          } else {
            // Step 3: Launch browser and scrape each investment, streaming results
            browser = await chromium.launch({ headless: true });
            let successCount = 0;
            let failCount = 0;
            let previousDomain = "";

            for (const investment of investments) {
              // Random delay between requests to avoid rate-limiting/blocking
              const currentDomain = extractDomain(investment.investment_url);
              const delayMs = calculateDelay(previousDomain, currentDomain);
              if (delayMs > 0) {
                await new Promise(function (resolve) {
                  setTimeout(resolve, delayMs);
                });
              }

              const priceResult = await scrapeSingleInvestmentPrice(investment, browser);
              previousDomain = currentDomain;
              sendEvent("price", priceResult);

              if (priceResult.success) {
                successCount++;
              } else {
                failCount++;
              }
            }

            // Step 4: Send done event with summary
            const total = successCount + failCount;
            let message = "Scraped " + successCount + " of " + total + " investment price" + (total === 1 ? "" : "s");
            if (failCount > 0) {
              message += " (" + failCount + " failed)";
            }

            sendEvent("done", {
              success: true,
              message: message,
              total: total,
              successCount: successCount,
              failCount: failCount,
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
scraperRouter.post("/api/scraper/prices/:id", async function (request, params) {
  try {
    const result = await scrapePriceById(Number(params.id));

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.message,
          detail: result.error || "",
          price: result.price,
        }),
        { status: result.price === null ? 404 : 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to scrape price", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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
