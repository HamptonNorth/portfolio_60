// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-benchmark-data-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import { createBenchmark } from "../../src/server/db/benchmarks-db.js";
import { upsertBenchmarkData, getLatestBenchmarkData, getBenchmarkDataHistory, getBenchmarkDataByDate, scaleBenchmarkValue, unscaleBenchmarkValue } from "../../src/server/db/benchmark-data-db.js";

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

let testBenchmark;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Get GBP currency (seeded)
  const currencies = getAllCurrencies();
  const gbp = currencies.find((c) => c.code === "GBP");

  // Create a test benchmark
  testBenchmark = createBenchmark({
    currencies_id: gbp.id,
    benchmark_type: "index",
    description: "Test Index",
    benchmark_url: "https://example.com/index",
    selector: ".value",
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scale/Unscale functions ---

describe("BenchmarkData - scaleBenchmarkValue", () => {
  test("scales a value by multiplying by 10000", () => {
    expect(scaleBenchmarkValue(7890.1234)).toBe(78901234);
  });

  test("rounds to nearest integer", () => {
    expect(scaleBenchmarkValue(7890.12345)).toBe(78901235);
  });

  test("handles zero", () => {
    expect(scaleBenchmarkValue(0)).toBe(0);
  });
});

describe("BenchmarkData - unscaleBenchmarkValue", () => {
  test("unscales a value by dividing by 10000", () => {
    expect(unscaleBenchmarkValue(78901234)).toBe(7890.1234);
  });

  test("handles zero", () => {
    expect(unscaleBenchmarkValue(0)).toBe(0);
  });
});

// --- upsertBenchmarkData ---

describe("BenchmarkData - upsertBenchmarkData", () => {
  test("inserts a new value for a benchmark", () => {
    upsertBenchmarkData(testBenchmark.id, "2026-02-06", "10:30:00", 7890.1234);

    const data = getBenchmarkDataByDate(testBenchmark.id, "2026-02-06");
    expect(data).not.toBeNull();
    expect(data.value_scaled).toBe(78901234);
    expect(data.value).toBeCloseTo(7890.1234, 4);
  });

  test("overwrites an existing value for the same date", () => {
    upsertBenchmarkData(testBenchmark.id, "2026-02-06", "10:35:00", 9999.9999);

    const data = getBenchmarkDataByDate(testBenchmark.id, "2026-02-06");
    expect(data.value_scaled).toBe(99999999);
  });

  test("inserts values for different dates", () => {
    upsertBenchmarkData(testBenchmark.id, "2026-02-05", "10:30:00", 7800.0);
    upsertBenchmarkData(testBenchmark.id, "2026-02-04", "10:30:00", 7750.5);

    const data5 = getBenchmarkDataByDate(testBenchmark.id, "2026-02-05");
    const data4 = getBenchmarkDataByDate(testBenchmark.id, "2026-02-04");

    expect(data5.value).toBeCloseTo(7800.0, 4);
    expect(data4.value).toBeCloseTo(7750.5, 4);
  });
});

// --- getLatestBenchmarkData ---

describe("BenchmarkData - getLatestBenchmarkData", () => {
  test("returns the most recent value by date", () => {
    const latest = getLatestBenchmarkData(testBenchmark.id);
    expect(latest).not.toBeNull();
    expect(latest.benchmark_date).toBe("2026-02-06");
  });

  test("returns null for benchmark with no data", () => {
    const currencies = getAllCurrencies();
    const gbp = currencies.find((c) => c.code === "GBP");

    const emptyBm = createBenchmark({
      currencies_id: gbp.id,
      benchmark_type: "index",
      description: "No Data Benchmark",
    });

    const latest = getLatestBenchmarkData(emptyBm.id);
    expect(latest).toBeNull();
  });
});

// --- getBenchmarkDataHistory ---

describe("BenchmarkData - getBenchmarkDataHistory", () => {
  test("returns data ordered by date descending", () => {
    const history = getBenchmarkDataHistory(testBenchmark.id);
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Check order is descending
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].benchmark_date >= history[i].benchmark_date).toBe(true);
    }
  });

  test("respects the limit parameter", () => {
    const history = getBenchmarkDataHistory(testBenchmark.id, 2);
    expect(history.length).toBe(2);
  });

  test("returns empty array for non-existent benchmark", () => {
    const history = getBenchmarkDataHistory(9999);
    expect(history).toEqual([]);
  });
});

// --- getBenchmarkDataByDate ---

describe("BenchmarkData - getBenchmarkDataByDate", () => {
  test("returns the value for a specific date", () => {
    const data = getBenchmarkDataByDate(testBenchmark.id, "2026-02-05");
    expect(data).not.toBeNull();
    expect(data.benchmark_date).toBe("2026-02-05");
    expect(data.benchmark_id).toBe(testBenchmark.id);
  });

  test("returns null for date with no data", () => {
    const data = getBenchmarkDataByDate(testBenchmark.id, "2020-01-01");
    expect(data).toBeNull();
  });

  test("returns null for non-existent benchmark", () => {
    const data = getBenchmarkDataByDate(9999, "2026-02-06");
    expect(data).toBeNull();
  });
});
