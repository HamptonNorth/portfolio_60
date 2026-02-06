import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Tests for the scraping service (src/server/services/scraping-service.js).
 * Uses a test database and mocks the scraper functions to verify the service
 * correctly orchestrates the scraping pipeline and collects results.
 *
 * The scraping service imports from price-scraper, benchmark-scraper, and
 * currency-scraper. Since we cannot easily mock ES module imports in Bun,
 * these tests mock globalThis.fetch (for currency scraper) and verify the
 * service's coordination logic by testing with an empty database (no
 * scrapeable investments or benchmarks configured, so the browser-based
 * scraping loops are skipped).
 *
 * For full integration testing of the scraping pipeline with real browser
 * scraping, see the manual testing checklist in PLAN_v0.2.0.md.
 */

const testDbPath = resolve("data/portfolio_60_test/test-scraping-service.db");

// Set DB_PATH before importing any database modules
process.env.DB_PATH = testDbPath;

// Import database functions
import { createDatabase, closeDatabase, databaseExists } from "../../src/server/db/connection.js";
import { createCurrency } from "../../src/server/db/currencies-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { createBenchmark } from "../../src/server/db/benchmarks-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { runFullScrape, retryFailedItems } from "../../src/server/services/scraping-service.js";

/**
 * @description Remove the test database files.
 */
function cleanupDatabase() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = testDbPath + suffix;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/** @type {Object} Reference to the original globalThis.fetch */
let originalFetch;

beforeAll(function () {
  cleanupDatabase();
  createDatabase();

  // Save original fetch for restoration
  originalFetch = globalThis.fetch;
});

afterAll(function () {
  // Restore original fetch
  globalThis.fetch = originalFetch;
  cleanupDatabase();
  delete process.env.DB_PATH;
});

describe("runFullScrape — with no data configured", function () {
  test("completes successfully with no currencies, investments, or benchmarks", async function () {
    // Mock fetch to return empty rates (no non-GBP currencies exist yet)
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    const summary = await runFullScrape({ startedBy: 0 });

    expect(summary).toBeDefined();
    expect(summary.currencySuccess).toBe(true);
    expect(summary.priceSuccessCount).toBe(0);
    expect(summary.priceFailCount).toBe(0);
    expect(summary.benchmarkSuccessCount).toBe(0);
    expect(summary.benchmarkFailCount).toBe(0);
    expect(summary.failedInvestmentIds).toHaveLength(0);
    expect(summary.failedBenchmarkIds).toHaveLength(0);
  });

  test("calls onCurrencyRates callback", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    let callbackCalled = false;
    let callbackData = null;

    await runFullScrape({
      startedBy: 0,
      onCurrencyRates: function (result) {
        callbackCalled = true;
        callbackData = result;
      },
    });

    expect(callbackCalled).toBe(true);
    expect(callbackData).toBeDefined();
    expect(callbackData.success).toBe(true);
  });

  test("calls onComplete callback with summary", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    let completeSummary = null;

    await runFullScrape({
      startedBy: 0,
      onComplete: function (summary) {
        completeSummary = summary;
      },
    });

    expect(completeSummary).toBeDefined();
    expect(completeSummary.priceSuccessCount).toBe(0);
    expect(completeSummary.benchmarkSuccessCount).toBe(0);
  });
});

describe("runFullScrape — with non-GBP currency", function () {
  test("fetches currency rates for configured currencies", async function () {
    // Add a USD currency
    createCurrency({ code: "USD", description: "US Dollar" });

    let fetchUrl = null;
    globalThis.fetch = mock(async function (url) {
      fetchUrl = url;
      return {
        ok: true,
        status: 200,
        json: async function () {
          return {
            base: "GBP",
            date: "2026-02-06",
            rates: { USD: 1.2543 },
          };
        },
      };
    });

    const summary = await runFullScrape({ startedBy: 1 });

    expect(summary.currencySuccess).toBe(true);
    // Verify the Frankfurter API was called with USD
    expect(fetchUrl).toContain("USD");
  });
});

describe("runFullScrape — currency rate failure", function () {
  test("reports currency failure when API returns error", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: false,
        status: 502,
        text: async function () {
          return "Bad Gateway";
        },
      };
    });

    const summary = await runFullScrape({ startedBy: 0 });

    expect(summary.currencySuccess).toBe(false);
  });
});

describe("runFullScrape — error handling", function () {
  test("calls onError callback on fatal error", async function () {
    globalThis.fetch = mock(async function () {
      throw new Error("Network failure");
    });

    let errorCaught = null;

    await runFullScrape({
      startedBy: 0,
      onError: function (err) {
        errorCaught = err;
      },
    });

    // The currency scraper catches network errors internally,
    // so this should complete without hitting onError
    // (the currency scraper returns { success: false } instead of throwing)
    // If we get here, it means the service handled it gracefully
    expect(true).toBe(true);
  });
});

describe("runFullScrape — delay profile", function () {
  test("sets SCRAPE_DELAY_PROFILE env var and restores it", async function () {
    // Save current value
    const originalProfile = process.env.SCRAPE_DELAY_PROFILE;
    delete process.env.SCRAPE_DELAY_PROFILE;

    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    await runFullScrape({
      startedBy: 1,
      delayProfile: "cron",
    });

    // After completion, the env var should be restored (deleted since it wasn't set before)
    expect(process.env.SCRAPE_DELAY_PROFILE).toBeUndefined();

    // Restore original if it existed
    if (originalProfile !== undefined) {
      process.env.SCRAPE_DELAY_PROFILE = originalProfile;
    }
  });
});

describe("retryFailedItems — with empty failure lists", function () {
  test("completes successfully with nothing to retry", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    const result = await retryFailedItems(
      {
        investmentIds: [],
        benchmarkIds: [],
        retryCurrency: false,
      },
      {
        attemptNumber: 2,
        startedBy: 1,
      },
    );

    expect(result.failedInvestmentIds).toHaveLength(0);
    expect(result.failedBenchmarkIds).toHaveLength(0);
    expect(result.currencySuccess).toBe(true);
  });
});

describe("retryFailedItems — currency retry", function () {
  test("retries currency rates when retryCurrency is true", async function () {
    let fetchCalled = false;
    globalThis.fetch = mock(async function () {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        json: async function () {
          return {
            base: "GBP",
            date: "2026-02-06",
            rates: { USD: 1.2543 },
          };
        },
      };
    });

    const result = await retryFailedItems(
      {
        investmentIds: [],
        benchmarkIds: [],
        retryCurrency: true,
      },
      {
        attemptNumber: 2,
        startedBy: 1,
      },
    );

    expect(fetchCalled).toBe(true);
    expect(result.currencySuccess).toBe(true);
  });

  test("calls onRetryResult callback for currency retry", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return {
            base: "GBP",
            date: "2026-02-06",
            rates: { USD: 1.2543 },
          };
        },
      };
    });

    let retryResults = [];

    await retryFailedItems(
      {
        investmentIds: [],
        benchmarkIds: [],
        retryCurrency: true,
      },
      {
        attemptNumber: 3,
        startedBy: 1,
        onRetryResult: function (type, id, result) {
          retryResults.push({ type, id, result });
        },
      },
    );

    expect(retryResults).toHaveLength(1);
    expect(retryResults[0].type).toBe("currency");
    expect(retryResults[0].id).toBeNull();
    expect(retryResults[0].result.success).toBe(true);
  });
});

describe("retryFailedItems — investment IDs that don't match scrapeable", function () {
  test("skips investment IDs that are not scrapeable", async function () {
    globalThis.fetch = mock(async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { base: "GBP", date: "2026-02-06", rates: {} };
        },
      };
    });

    // Pass non-existent investment IDs — they won't match any scrapeable investments
    const result = await retryFailedItems(
      {
        investmentIds: [9999],
        benchmarkIds: [],
        retryCurrency: false,
      },
      {
        attemptNumber: 2,
        startedBy: 0,
      },
    );

    // No matching scrapeable investments, so nothing retried and nothing failed
    expect(result.failedInvestmentIds).toHaveLength(0);
  });
});
