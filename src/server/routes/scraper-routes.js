import { Router } from "../router.js";
import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import { getLatestRates } from "../db/currency-rates-db.js";

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
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch currency rates", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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
    return new Response(
      JSON.stringify({ error: "Failed to get latest rates", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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
