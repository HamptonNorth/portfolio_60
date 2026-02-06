// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-benchmarks-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllCurrencies, createCurrency } from "../../src/server/db/currencies-db.js";
import {
  getAllBenchmarks,
  getBenchmarkById,
  createBenchmark,
  updateBenchmark,
  deleteBenchmark,
  getGbpCurrencyId,
} from "../../src/server/db/benchmarks-db.js";

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

beforeAll(() => {
  cleanupDatabase();
  createDatabase();
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Helper functions ---

/**
 * @description Get the GBP currency from the seeded data.
 * @returns {Object} GBP currency object
 */
function getGbpCurrency() {
  const currencies = getAllCurrencies();
  return currencies.find((c) => c.code === "GBP");
}

// --- getGbpCurrencyId ---

describe("Benchmarks - getGbpCurrencyId", () => {
  test("returns the GBP currency ID", () => {
    const gbpId = getGbpCurrencyId();
    const gbp = getGbpCurrency();
    expect(gbpId).toBe(gbp.id);
  });
});

// --- Benchmarks CRUD ---

describe("Benchmarks - getAllBenchmarks", () => {
  test("returns empty array when no benchmarks exist", () => {
    const benchmarks = getAllBenchmarks();
    expect(benchmarks).toEqual([]);
  });
});

describe("Benchmarks - createBenchmark", () => {
  test("creates an index benchmark and returns it with joined fields", () => {
    const gbp = getGbpCurrency();

    const bm = createBenchmark({
      currencies_id: gbp.id,
      benchmark_type: "index",
      description: "FTSE 100 Index",
      benchmark_url: "https://www.example.com/ftse100",
      selector: ".index-value",
    });

    expect(bm).not.toBeNull();
    expect(bm.id).toBeGreaterThan(0);
    expect(bm.description).toBe("FTSE 100 Index");
    expect(bm.benchmark_type).toBe("index");
    expect(bm.currency_code).toBe("GBP");
    expect(bm.benchmark_url).toBe("https://www.example.com/ftse100");
    expect(bm.selector).toBe(".index-value");
  });

  test("creates a price benchmark with non-GBP currency", () => {
    // First create a USD currency
    const usd = createCurrency({
      code: "USD",
      description: "US Dollar",
    });

    const bm = createBenchmark({
      currencies_id: usd.id,
      benchmark_type: "price",
      description: "S&P 500 ETF",
      benchmark_url: "https://www.example.com/sp500-etf",
      selector: ".etf-price",
    });

    expect(bm).not.toBeNull();
    expect(bm.benchmark_type).toBe("price");
    expect(bm.currency_code).toBe("USD");
    expect(bm.description).toBe("S&P 500 ETF");
  });

  test("creates a benchmark with optional fields as null", () => {
    const gbp = getGbpCurrency();

    const bm = createBenchmark({
      currencies_id: gbp.id,
      benchmark_type: "index",
      description: "FTSE 250 Index",
    });

    expect(bm).not.toBeNull();
    expect(bm.benchmark_url).toBeNull();
    expect(bm.selector).toBeNull();
  });

  test("throws on invalid currency FK", () => {
    expect(() => {
      createBenchmark({
        currencies_id: 9999,
        benchmark_type: "index",
        description: "Bad currency ref",
      });
    }).toThrow();
  });
});

describe("Benchmarks - getAllBenchmarks after inserts", () => {
  test("returns all benchmarks ordered by description", () => {
    const benchmarks = getAllBenchmarks();
    expect(benchmarks.length).toBe(3);
    // Should be alphabetically ordered by description
    const descriptions = benchmarks.map((b) => b.description);
    const sorted = [...descriptions].sort();
    expect(descriptions).toEqual(sorted);
  });

  test("each benchmark has joined currency fields", () => {
    const benchmarks = getAllBenchmarks();
    for (const bm of benchmarks) {
      expect(bm.currency_code).toBeTruthy();
      expect(bm.currency_description).toBeTruthy();
    }
  });
});

describe("Benchmarks - getBenchmarkById", () => {
  test("returns the correct benchmark with joined fields", () => {
    const benchmarks = getAllBenchmarks();
    const bm = getBenchmarkById(benchmarks[0].id);
    expect(bm).not.toBeNull();
    expect(bm.id).toBe(benchmarks[0].id);
    expect(bm.description).toBe(benchmarks[0].description);
    expect(bm.currency_code).toBeTruthy();
  });

  test("returns null for non-existent ID", () => {
    const bm = getBenchmarkById(9999);
    expect(bm).toBeNull();
  });
});

describe("Benchmarks - updateBenchmark", () => {
  test("updates benchmark fields and returns the updated benchmark", () => {
    const benchmarks = getAllBenchmarks();
    const ftse100 = benchmarks.find((b) => b.description === "FTSE 100 Index");
    const gbp = getGbpCurrency();

    const updated = updateBenchmark(ftse100.id, {
      currencies_id: gbp.id,
      benchmark_type: "index",
      description: "FTSE 100 Index (Updated)",
      benchmark_url: "https://www.example.com/ftse100-updated",
      selector: ".new-selector",
    });

    expect(updated).not.toBeNull();
    expect(updated.description).toBe("FTSE 100 Index (Updated)");
    expect(updated.benchmark_url).toBe("https://www.example.com/ftse100-updated");
    expect(updated.selector).toBe(".new-selector");
  });

  test("returns null for non-existent ID", () => {
    const result = updateBenchmark(9999, {
      currencies_id: 1,
      benchmark_type: "index",
      description: "Does not exist",
    });
    expect(result).toBeNull();
  });

  test("throws on invalid FK during update", () => {
    const benchmarks = getAllBenchmarks();
    const id = benchmarks[0].id;
    expect(() => {
      updateBenchmark(id, {
        currencies_id: 9999,
        benchmark_type: "index",
        description: "Bad FK update",
      });
    }).toThrow();
  });
});

describe("Benchmarks - deleteBenchmark", () => {
  test("deletes a benchmark and returns {deleted: true}", () => {
    const benchmarks = getAllBenchmarks();
    const ftse250 = benchmarks.find((b) => b.description === "FTSE 250 Index");
    const result = deleteBenchmark(ftse250.id);
    expect(result.deleted).toBe(true);

    const deleted = getBenchmarkById(ftse250.id);
    expect(deleted).toBeNull();
  });

  test("returns {deleted: false, reason: 'Benchmark not found'} for non-existent ID", () => {
    const result = deleteBenchmark(9999);
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("Benchmark not found");
  });
});

// --- Validation tests (via routes) ---

describe("Benchmarks - validation rules", () => {
  test("benchmark_type must be 'index' or 'price'", () => {
    const gbp = getGbpCurrency();

    // The database CHECK constraint should reject invalid types
    expect(() => {
      createBenchmark({
        currencies_id: gbp.id,
        benchmark_type: "invalid_type",
        description: "Invalid type benchmark",
      });
    }).toThrow();
  });
});
