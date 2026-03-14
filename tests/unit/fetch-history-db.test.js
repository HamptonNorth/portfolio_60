// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-fetch-history-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllCurrencies, createCurrency } from "../../src/server/db/currencies-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { createBenchmark } from "../../src/server/db/benchmarks-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { recordFetchAttempt, getLastSuccessfulFetch, getLastSuccessfulFetchByType, getFetchHistory, getFetchHistoryCount, getFetchHistoryWithDescriptions } from "../../src/server/db/fetch-history-db.js";

const testDbPath = getDatabasePath();

/**
 * @description Clean up the isolated test database files only.
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

let gbpCurrency;
let usdCurrency;
let testInvestment;
let testBenchmark;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Get GBP currency (seeded)
  const currencies = getAllCurrencies();
  gbpCurrency = currencies.find((c) => c.code === "GBP");

  // Create USD currency
  usdCurrency = createCurrency({
    code: "USD",
    description: "US Dollar",
  });

  // Get an investment type
  const types = getAllInvestmentTypes();
  const shareType = types.find((t) => t.short_description === "SHARE");

  // Create a test investment
  testInvestment = createInvestment({
    currencies_id: gbpCurrency.id,
    investment_type_id: shareType.id,
    description: "Test Investment",
    investment_url: "https://example.com/share",
    selector: ".price",
  });

  // Create a test benchmark
  testBenchmark = createBenchmark({
    currencies_id: gbpCurrency.id,
    benchmark_type: "index",
    description: "Test Benchmark",
    benchmark_url: "https://example.com/index",
    selector: ".value",
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- recordFetchAttempt ---

describe("FetchHistory - recordFetchAttempt", () => {
  test("records a successful currency fetch", () => {
    const id = recordFetchAttempt({
      fetchType: "currency",
      referenceId: usdCurrency.id,
      startedBy: 0,
      attemptNumber: 1,
      success: true,
      errorCode: null,
      errorMessage: null,
    });

    expect(id).toBeGreaterThan(0);
  });

  test("records a failed investment fetch with error details", () => {
    const id = recordFetchAttempt({
      fetchType: "investment",
      referenceId: testInvestment.id,
      startedBy: 1,
      attemptNumber: 2,
      success: false,
      errorCode: "TIMEOUT",
      errorMessage: "Connection timed out",
    });

    expect(id).toBeGreaterThan(0);
  });

  test("records a benchmark fetch", () => {
    const id = recordFetchAttempt({
      fetchType: "benchmark",
      referenceId: testBenchmark.id,
      startedBy: 0,
      attemptNumber: 1,
      success: true,
    });

    expect(id).toBeGreaterThan(0);
  });

  test("uses default values for optional parameters", () => {
    const id = recordFetchAttempt({
      fetchType: "currency",
      referenceId: gbpCurrency.id,
      success: true,
    });

    const history = getFetchHistory({ limit: 1 });
    expect(history[0].started_by).toBe(0);
    expect(history[0].attempt_number).toBe(1);
  });
});

// --- getLastSuccessfulFetch ---

describe("FetchHistory - getLastSuccessfulFetch", () => {
  test("returns the datetime of the most recent successful fetch", () => {
    const last = getLastSuccessfulFetch();
    expect(last).not.toBeNull();
    expect(typeof last).toBe("string");
    // Should be in ISO format: YYYY-MM-DDTHH:MM:SS
    expect(last).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

// --- getLastSuccessfulFetchByType ---

describe("FetchHistory - getLastSuccessfulFetchByType", () => {
  test("returns the last successful currency fetch datetime", () => {
    const last = getLastSuccessfulFetchByType("currency");
    expect(last).not.toBeNull();
  });

  test("returns the last successful benchmark fetch datetime", () => {
    const last = getLastSuccessfulFetchByType("benchmark");
    expect(last).not.toBeNull();
  });

  test("returns null for type with no successful fetches", () => {
    // We haven't recorded any successful investment fetches
    const last = getLastSuccessfulFetchByType("investment");
    expect(last).toBeNull();
  });
});

// --- getFetchHistory ---

describe("FetchHistory - getFetchHistory", () => {
  test("returns all history records ordered by datetime descending", () => {
    const history = getFetchHistory();
    expect(history.length).toBeGreaterThan(0);

    // Check order is descending
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].fetch_datetime >= history[i].fetch_datetime).toBe(true);
    }
  });

  test("filters by fetchType", () => {
    const history = getFetchHistory({ fetchType: "currency" });
    for (const h of history) {
      expect(h.fetch_type).toBe("currency");
    }
  });

  test("filters by success=true", () => {
    const history = getFetchHistory({ success: true });
    for (const h of history) {
      expect(h.success).toBe(true);
    }
  });

  test("filters by success=false", () => {
    const history = getFetchHistory({ success: false });
    for (const h of history) {
      expect(h.success).toBe(false);
    }
  });

  test("respects limit and offset", () => {
    const allHistory = getFetchHistory();
    const page1 = getFetchHistory({ limit: 2, offset: 0 });
    const page2 = getFetchHistory({ limit: 2, offset: 2 });

    expect(page1.length).toBeLessThanOrEqual(2);
    if (allHistory.length > 2) {
      expect(page1[0].id).not.toBe(page2[0].id);
    }
  });
});

// --- getFetchHistoryCount ---

describe("FetchHistory - getFetchHistoryCount", () => {
  test("returns total count matching filters", () => {
    const count = getFetchHistoryCount();
    const history = getFetchHistory({ limit: 1000 });
    expect(count).toBe(history.length);
  });

  test("returns count filtered by type", () => {
    const count = getFetchHistoryCount({ fetchType: "currency" });
    const history = getFetchHistory({ fetchType: "currency", limit: 1000 });
    expect(count).toBe(history.length);
  });
});

// --- getFetchHistoryWithDescriptions ---

describe("FetchHistory - getFetchHistoryWithDescriptions", () => {
  test("includes reference descriptions for each record", () => {
    const history = getFetchHistoryWithDescriptions();
    for (const h of history) {
      expect(h.reference_description).toBeDefined();
      expect(h.reference_description).not.toBe("");
    }
  });

  test("shows currency code and description for currency fetches", () => {
    const history = getFetchHistoryWithDescriptions({ fetchType: "currency" });
    for (const h of history) {
      // Currency description format: "USD - US Dollar"
      expect(h.reference_description).toContain(" - ");
    }
  });

  test("shows investment description for investment fetches", () => {
    const history = getFetchHistoryWithDescriptions({ fetchType: "investment" });
    for (const h of history) {
      expect(h.reference_description).toBe("Test Investment");
    }
  });

  test("shows benchmark description for benchmark fetches", () => {
    const history = getFetchHistoryWithDescriptions({ fetchType: "benchmark" });
    for (const h of history) {
      expect(h.reference_description).toBe("Test Benchmark");
    }
  });

  test("respects filters like fetchType", () => {
    const history = getFetchHistoryWithDescriptions({ fetchType: "benchmark" });
    for (const h of history) {
      expect(h.fetch_type).toBe("benchmark");
    }
  });
});
