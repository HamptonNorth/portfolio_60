/**
 * @description API routes for historic data backfill.
 * Provides SSE streaming endpoints that fetch historic data from external
 * sources and insert it into the database with real-time progress updates.
 */

import { Router } from "../router.js";
import { backfillCurrencyRates, backfillInvestmentPrices, backfillBenchmarkValues, testBackfillInvestment, loadBackfillInvestment, testBackfillCurrency, loadBackfillCurrency, testBackfillBenchmark, loadBackfillBenchmark } from "../services/historic-backfill.js";

const backfillRouter = new Router();

/**
 * @description Create an SSE response that streams progress events from a backfill function.
 * @param {Function} backfillFn - Async function that accepts a progressCallback
 * @param {string} errorLabel - Label for error messages (e.g. "currency rate backfill")
 * @returns {Response} SSE streaming response
 */
function createBackfillStream(backfillFn, errorLabel) {
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

      try {
        const result = await backfillFn(function (progress) {
          sendEvent("progress", progress);
        });

        sendEvent("done", result);
      } catch (err) {
        sendEvent("error", {
          message: "Failed: " + errorLabel + " — " + err.message,
        });
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
}

// GET /api/backfill/historic/currencies/stream — backfill currency rates from BoE
backfillRouter.get("/api/backfill/historic/currencies/stream", async function () {
  return createBackfillStream(backfillCurrencyRates, "currency rate backfill");
});

// GET /api/backfill/historic/prices/stream — backfill investment prices from Morningstar
backfillRouter.get("/api/backfill/historic/prices/stream", async function () {
  return createBackfillStream(backfillInvestmentPrices, "investment price backfill");
});

// GET /api/backfill/historic/benchmarks/stream — backfill benchmark values from Yahoo Finance
backfillRouter.get("/api/backfill/historic/benchmarks/stream", async function () {
  return createBackfillStream(backfillBenchmarkValues, "benchmark value backfill");
});

// ---------------------------------------------------------------------------
// Per-record test and load endpoints (Phase 4b)
// ---------------------------------------------------------------------------

// GET /api/backfill/test/investment/:id — preview 10 most recent weekly prices
backfillRouter.get("/api/backfill/test/investment/:id", async function (request, params) {
  try {
    const result = await testBackfillInvestment(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

// POST /api/backfill/load/investment/:id — load 3 years of weekly prices for one investment
backfillRouter.post("/api/backfill/load/investment/:id", async function (request, params) {
  try {
    const result = await loadBackfillInvestment(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

// GET /api/backfill/test/currency/:id — preview 10 most recent weekly rates
backfillRouter.get("/api/backfill/test/currency/:id", async function (request, params) {
  try {
    const result = await testBackfillCurrency(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

// POST /api/backfill/load/currency/:id — load 3 years of weekly rates for one currency
backfillRouter.post("/api/backfill/load/currency/:id", async function (request, params) {
  try {
    const result = await loadBackfillCurrency(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

// GET /api/backfill/test/benchmark/:id — preview 10 most recent weekly values
backfillRouter.get("/api/backfill/test/benchmark/:id", async function (request, params) {
  try {
    const result = await testBackfillBenchmark(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

// POST /api/backfill/load/benchmark/:id — load 3 years of weekly values for one benchmark
backfillRouter.post("/api/backfill/load/benchmark/:id", async function (request, params) {
  try {
    const result = await loadBackfillBenchmark(Number(params.id));
    return Response.json(result);
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
});

/**
 * @description Handle backfill API routes.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleBackfillRoute(method, path, request) {
  return await backfillRouter.match(method, path, request);
}
