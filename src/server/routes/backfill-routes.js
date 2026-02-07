/**
 * @description API routes for historic data backfill.
 * Provides SSE streaming endpoints that fetch historic data from external
 * sources and insert it into the database with real-time progress updates.
 */

import { Router } from "../router.js";
import { backfillCurrencyRates } from "../services/historic-backfill.js";

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
