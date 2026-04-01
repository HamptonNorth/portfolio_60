import { Router } from "../router.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDatabase } from "../db/connection.js";
import { checkpointDatabase } from "../db/connection.js";
import { runFullPriceUpdate } from "../services/fetch-service.js";
import { getFetchServerConfig } from "../config.js";
import { loadEnvValue } from "../auth.js";
import { upsertIntoDatabase } from "../services/fetch-server-sync.js";
import { resolveMorningstarId } from "../fetchers/morningstar-price-fetcher.js";
import { resolveBenchmarkTicker } from "../fetchers/yahoo-benchmark-fetcher.js";
import { getAllInvestments } from "../db/investments-db.js";
import { getAllBenchmarks } from "../db/benchmarks-db.js";

/**
 * @description Router instance for test database setup routes.
 * @type {Router}
 */
const testSetupRouter = new Router();

/**
 * @description SSE endpoint that runs the full test database setup:
 * 1. Backfill 36 months of prices, rates, and benchmark values
 * 2. Apply historic holding changes (SCD2 history)
 *
 * Sends progress events so the UI can inform the user what is happening.
 *
 * Event types:
 *   phase     — a new phase is starting (message describes what)
 *   progress  — incremental progress within a phase
 *   done      — setup complete
 *   error     — a non-fatal error occurred
 */
testSetupRouter.get("/api/test-setup/stream", async function (request) {
  try {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let connectionLost = false;
        let eventId = 0;

        function sendEvent(eventName, data) {
          try {
            controller.enqueue(encoder.encode("id: " + (++eventId) + "\n"));
            controller.enqueue(encoder.encode("event: " + eventName + "\n"));
            controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
          } catch {
            connectionLost = true;
          }
        }

        // Keepalive every 15s to prevent connection timeout
        const keepaliveId = setInterval(function () {
          try {
            controller.enqueue(encoder.encode(":keepalive\n\n"));
          } catch {
            clearInterval(keepaliveId);
            connectionLost = true;
          }
        }, 15000);

        try {
          // Phase 1: Load price/rate/benchmark data
          // Try fetch-server-60 history first (fast), fall back to public APIs (slow)
          var historyLoaded = false;
          var fetchServerConfig = getFetchServerConfig();

          if (fetchServerConfig.enabled && fetchServerConfig.url) {
            sendEvent("phase", {
              phase: 1,
              total: 3,
              message: "Resolving investment and benchmark identifiers...",
            });

            // Resolve morningstar_ids for all investments (fast API lookups)
            // These are needed to map fetch-server prices to local investments
            var investments = getAllInvestments();
            var resolvedCount = 0;
            for (var i = 0; i < investments.length; i++) {
              if (!investments[i].morningstar_id) {
                var result = await resolveMorningstarId(investments[i]);
                if (result) resolvedCount++;
              }
            }

            // Resolve yahoo_tickers for all benchmarks (local lookup, no API call)
            var benchmarks = getAllBenchmarks();
            var bmResolvedCount = 0;
            for (var j = 0; j < benchmarks.length; j++) {
              if (!benchmarks[j].yahoo_ticker) {
                var ticker = resolveBenchmarkTicker(benchmarks[j]);
                if (ticker) bmResolvedCount++;
              }
            }

            sendEvent("progress", {
              phase: 1,
              message: "Resolved " + resolvedCount + " investments, " + bmResolvedCount + " benchmarks",
            });

            // Now sync history from the fetch server
            sendEvent("progress", {
              phase: 1,
              message: "Loading history from fetch server...",
            });

            try {
              var apiKey = loadEnvValue("FETCH_SERVER_API_KEY");
              var historyUrl = fetchServerConfig.url.replace(/\/$/, "") + "/api/history";
              var historyResponse = await fetch(historyUrl, {
                method: "GET",
                headers: { "X-API-Key": apiKey || "" },
                signal: AbortSignal.timeout(30000),
              });

              if (historyResponse.ok) {
                var historyData = await historyResponse.json();
                if (historyData.fetchedAt) {
                  var counts = upsertIntoDatabase(historyData);
                  sendEvent("progress", {
                    phase: 1,
                    message: "History loaded from fetch server — " +
                      counts.prices + " prices, " +
                      counts.rates + " rates, " +
                      counts.benchmarks + " benchmarks",
                  });
                  historyLoaded = true;
                }
              }
            } catch (fetchErr) {
              sendEvent("progress", {
                phase: 1,
                message: "Fetch server unavailable (" + fetchErr.message + "), falling back to direct fetch",
              });
            }
          }

          if (!historyLoaded) {
            // Fall back to fetching from public APIs (slow — several minutes)
            sendEvent("phase", {
              phase: 1,
              total: 3,
              message: "Fetching currency rates, prices and benchmark values — this may take several minutes",
            });

            const summary = await runFullPriceUpdate({
              startedBy: 0,
              onCurrencyRates: function (result) {
                sendEvent("progress", {
                  phase: 1,
                  message: result.success
                    ? "Currency rates updated"
                    : "Currency rates: " + (result.error || "failed"),
                });
              },
              onPriceResult: function (result) {
                sendEvent("progress", {
                  phase: 1,
                  message: result.success
                    ? result.description + " — price updated"
                    : result.description + " — " + (result.error || "failed"),
                });
              },
              onBenchmarkResult: function (result) {
                sendEvent("progress", {
                  phase: 1,
                  message: result.success
                    ? result.description + " — value updated"
                    : result.description + " — " + (result.error || "failed"),
                });
              },
            });

            sendEvent("progress", {
              phase: 1,
              message: "Fetch complete — " +
                summary.priceSuccessCount + " prices, " +
                summary.benchmarkSuccessCount + " benchmarks",
            });
          }

          // Phase 2: Apply historic holding changes
          sendEvent("phase", {
            phase: 2,
            total: 3,
            message: "Adding historic portfolio changes",
          });

          const sqlPath = resolve("src/server/db/seed-test-history.sql");
          if (existsSync(sqlPath)) {
            const sql = readFileSync(sqlPath, "utf-8");
            const db = getDatabase();
            db.exec(sql);
            checkpointDatabase();

            sendEvent("progress", {
              phase: 2,
              message: "Historic holding changes applied",
            });
          } else {
            sendEvent("error", {
              phase: 2,
              message: "History seed file not found — skipped",
            });
          }

          // Phase 3: Done
          sendEvent("phase", {
            phase: 3,
            total: 3,
            message: "Setup complete — database is ready",
          });

          sendEvent("done", { success: true });
        } catch (err) {
          sendEvent("error", {
            message: "Setup failed: " + err.message,
          });
          sendEvent("done", { success: false, error: err.message });
        } finally {
          clearInterval(keepaliveId);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Test setup failed", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Handle test setup API requests.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {Request} request - The incoming request
 * @returns {Promise<Response|null>} The response, or null if no route matched
 */
export async function handleTestSetupRoute(method, path, request) {
  return await testSetupRouter.match(method, path, request);
}
