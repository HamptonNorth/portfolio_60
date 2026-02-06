// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-scraping-history-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllCurrencies, createCurrency } from "../../src/server/db/currencies-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { createBenchmark } from "../../src/server/db/benchmarks-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import {
  recordScrapingAttempt,
  getLastSuccessfulScrape,
  getLastSuccessfulScrapeByType,
  getScrapingHistory,
  getScrapingHistoryCount,
  getScrapingHistoryWithDescriptions,
} from "../../src/server/db/scraping-history-db.js";

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

// --- recordScrapingAttempt ---

describe("ScrapingHistory - recordScrapingAttempt", () => {
  test("records a successful currency scrape", () => {
    const id = recordScrapingAttempt({
      scrapeType: "currency",
      referenceId: usdCurrency.id,
      startedBy: 0,
      attemptNumber: 1,
      success: true,
      errorCode: null,
      errorMessage: null,
    });

    expect(id).toBeGreaterThan(0);
  });

  test("records a failed investment scrape with error details", () => {
    const id = recordScrapingAttempt({
      scrapeType: "investment",
      referenceId: testInvestment.id,
      startedBy: 1,
      attemptNumber: 2,
      success: false,
      errorCode: "TIMEOUT",
      errorMessage: "Connection timed out",
    });

    expect(id).toBeGreaterThan(0);
  });

  test("records a benchmark scrape", () => {
    const id = recordScrapingAttempt({
      scrapeType: "benchmark",
      referenceId: testBenchmark.id,
      startedBy: 0,
      attemptNumber: 1,
      success: true,
    });

    expect(id).toBeGreaterThan(0);
  });

  test("uses default values for optional parameters", () => {
    const id = recordScrapingAttempt({
      scrapeType: "currency",
      referenceId: gbpCurrency.id,
      success: true,
    });

    const history = getScrapingHistory({ limit: 1 });
    expect(history[0].started_by).toBe(0);
    expect(history[0].attempt_number).toBe(1);
  });
});

// --- getLastSuccessfulScrape ---

describe("ScrapingHistory - getLastSuccessfulScrape", () => {
  test("returns the datetime of the most recent successful scrape", () => {
    const last = getLastSuccessfulScrape();
    expect(last).not.toBeNull();
    expect(typeof last).toBe("string");
    // Should be in ISO format: YYYY-MM-DDTHH:MM:SS
    expect(last).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

// --- getLastSuccessfulScrapeByType ---

describe("ScrapingHistory - getLastSuccessfulScrapeByType", () => {
  test("returns the last successful currency scrape datetime", () => {
    const last = getLastSuccessfulScrapeByType("currency");
    expect(last).not.toBeNull();
  });

  test("returns the last successful benchmark scrape datetime", () => {
    const last = getLastSuccessfulScrapeByType("benchmark");
    expect(last).not.toBeNull();
  });

  test("returns null for type with no successful scrapes", () => {
    // We haven't recorded any successful investment scrapes
    const last = getLastSuccessfulScrapeByType("investment");
    expect(last).toBeNull();
  });
});

// --- getScrapingHistory ---

describe("ScrapingHistory - getScrapingHistory", () => {
  test("returns all history records ordered by datetime descending", () => {
    const history = getScrapingHistory();
    expect(history.length).toBeGreaterThan(0);

    // Check order is descending
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].scrape_datetime >= history[i].scrape_datetime).toBe(true);
    }
  });

  test("filters by scrapeType", () => {
    const history = getScrapingHistory({ scrapeType: "currency" });
    for (const h of history) {
      expect(h.scrape_type).toBe("currency");
    }
  });

  test("filters by success=true", () => {
    const history = getScrapingHistory({ success: true });
    for (const h of history) {
      expect(h.success).toBe(true);
    }
  });

  test("filters by success=false", () => {
    const history = getScrapingHistory({ success: false });
    for (const h of history) {
      expect(h.success).toBe(false);
    }
  });

  test("respects limit and offset", () => {
    const allHistory = getScrapingHistory();
    const page1 = getScrapingHistory({ limit: 2, offset: 0 });
    const page2 = getScrapingHistory({ limit: 2, offset: 2 });

    expect(page1.length).toBeLessThanOrEqual(2);
    if (allHistory.length > 2) {
      expect(page1[0].id).not.toBe(page2[0].id);
    }
  });
});

// --- getScrapingHistoryCount ---

describe("ScrapingHistory - getScrapingHistoryCount", () => {
  test("returns total count matching filters", () => {
    const count = getScrapingHistoryCount();
    const history = getScrapingHistory({ limit: 1000 });
    expect(count).toBe(history.length);
  });

  test("returns count filtered by type", () => {
    const count = getScrapingHistoryCount({ scrapeType: "currency" });
    const history = getScrapingHistory({ scrapeType: "currency", limit: 1000 });
    expect(count).toBe(history.length);
  });
});

// --- getScrapingHistoryWithDescriptions ---

describe("ScrapingHistory - getScrapingHistoryWithDescriptions", () => {
  test("includes reference descriptions for each record", () => {
    const history = getScrapingHistoryWithDescriptions();
    for (const h of history) {
      expect(h.reference_description).toBeDefined();
      expect(h.reference_description).not.toBe("");
    }
  });

  test("shows currency code and description for currency scrapes", () => {
    const history = getScrapingHistoryWithDescriptions({ scrapeType: "currency" });
    for (const h of history) {
      // Currency description format: "USD - US Dollar"
      expect(h.reference_description).toContain(" - ");
    }
  });

  test("shows investment description for investment scrapes", () => {
    const history = getScrapingHistoryWithDescriptions({ scrapeType: "investment" });
    for (const h of history) {
      expect(h.reference_description).toBe("Test Investment");
    }
  });

  test("shows benchmark description for benchmark scrapes", () => {
    const history = getScrapingHistoryWithDescriptions({ scrapeType: "benchmark" });
    for (const h of history) {
      expect(h.reference_description).toBe("Test Benchmark");
    }
  });

  test("respects filters like scrapeType", () => {
    const history = getScrapingHistoryWithDescriptions({ scrapeType: "benchmark" });
    for (const h of history) {
      expect(h.scrape_type).toBe("benchmark");
    }
  });
});
