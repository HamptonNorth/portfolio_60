// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-investments-db-phase-b.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import {
  getAllTestInvestments,
  getTestInvestmentById,
  createTestInvestment,
  updateTestInvestment,
  deleteTestInvestment,
  updateTestResult,
} from "../../src/server/db/test-investments-db.js";
import { upsertTestPrice, getTestPriceHistory, getLatestTestPrice } from "../../src/server/db/test-prices-db.js";

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

// --- Test Investments CRUD ---

describe("TestInvestments - getAllTestInvestments", () => {
  test("returns empty array when no test investments exist", () => {
    const testInvestments = getAllTestInvestments();
    expect(testInvestments).toEqual([]);
  });
});

describe("TestInvestments - createTestInvestment", () => {
  test("creates a test investment with all fields", () => {
    const types = getAllInvestmentTypes();
    const currencies = getAllCurrencies();
    const mutualType = types.find((t) => t.short_description === "MUTUAL");
    const gbp = currencies.find((c) => c.code === "GBP");

    const ti = createTestInvestment({
      currencies_id: gbp.id,
      investment_type_id: mutualType.id,
      description: "Fundsmith (FT Markets test)",
      public_id: "GB00B41YBW71",
      investment_url: "https://markets.ft.com/data/funds/tearsheet/summary?s=GB00B41YBW71:GBP",
      selector: "span.mod-ui-data-list__value",
      source_site: "FT Markets (Funds)",
      notes: "Testing ISIN-based FT Markets lookup",
    });

    expect(ti).not.toBeNull();
    expect(ti.id).toBeGreaterThan(0);
    expect(ti.description).toBe("Fundsmith (FT Markets test)");
    expect(ti.public_id).toBe("GB00B41YBW71");
    expect(ti.source_site).toBe("FT Markets (Funds)");
    expect(ti.notes).toBe("Testing ISIN-based FT Markets lookup");
    expect(ti.currency_code).toBe("GBP");
    expect(ti.type_short).toBe("MUTUAL");
    expect(ti.last_test_date).toBeNull();
    expect(ti.last_test_success).toBeNull();
    expect(ti.last_test_price).toBeNull();
  });

  test("creates a test investment with only required fields", () => {
    const types = getAllInvestmentTypes();
    const currencies = getAllCurrencies();
    const shareType = types.find((t) => t.short_description === "SHARE");
    const gbp = currencies.find((c) => c.code === "GBP");

    const ti = createTestInvestment({
      currencies_id: gbp.id,
      investment_type_id: shareType.id,
      description: "AstraZeneca (LSE test)",
    });

    expect(ti).not.toBeNull();
    expect(ti.id).toBeGreaterThan(0);
    expect(ti.public_id).toBeNull();
    expect(ti.investment_url).toBeNull();
    expect(ti.selector).toBeNull();
    expect(ti.source_site).toBeNull();
    expect(ti.notes).toBeNull();
  });

  test("throws on invalid currency FK", () => {
    const types = getAllInvestmentTypes();
    expect(() => {
      createTestInvestment({
        currencies_id: 9999,
        investment_type_id: types[0].id,
        description: "Bad currency ref",
      });
    }).toThrow();
  });

  test("throws on invalid investment type FK", () => {
    const currencies = getAllCurrencies();
    expect(() => {
      createTestInvestment({
        currencies_id: currencies[0].id,
        investment_type_id: 9999,
        description: "Bad type ref",
      });
    }).toThrow();
  });
});

describe("TestInvestments - getAllTestInvestments after inserts", () => {
  test("returns all test investments ordered by description", () => {
    const tests = getAllTestInvestments();
    expect(tests.length).toBe(2);
    expect(tests[0].description).toBe("AstraZeneca (LSE test)");
    expect(tests[1].description).toBe("Fundsmith (FT Markets test)");
  });

  test("each test investment has joined currency and type fields", () => {
    const tests = getAllTestInvestments();
    for (const ti of tests) {
      expect(ti.currency_code).toBeTruthy();
      expect(ti.currency_description).toBeTruthy();
      expect(ti.type_short).toBeTruthy();
      expect(ti.type_description).toBeTruthy();
    }
  });
});

describe("TestInvestments - getTestInvestmentById", () => {
  test("returns the correct test investment with joined fields", () => {
    const tests = getAllTestInvestments();
    const ti = getTestInvestmentById(tests[0].id);
    expect(ti).not.toBeNull();
    expect(ti.id).toBe(tests[0].id);
    expect(ti.description).toBe(tests[0].description);
  });

  test("returns null for non-existent ID", () => {
    const ti = getTestInvestmentById(9999);
    expect(ti).toBeNull();
  });
});

describe("TestInvestments - updateTestInvestment", () => {
  test("updates test investment fields", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;
    const types = getAllInvestmentTypes();
    const trustType = types.find((t) => t.short_description === "TRUST");
    const currencies = getAllCurrencies();
    const gbp = currencies.find((c) => c.code === "GBP");

    const updated = updateTestInvestment(id, {
      currencies_id: gbp.id,
      investment_type_id: trustType.id,
      description: "AstraZeneca (Updated)",
      public_id: "LSE:AZN",
      source_site: "FT Markets (Equities)",
      notes: "Changed to ticker-based lookup",
    });

    expect(updated).not.toBeNull();
    expect(updated.description).toBe("AstraZeneca (Updated)");
    expect(updated.public_id).toBe("LSE:AZN");
    expect(updated.type_short).toBe("TRUST");
    expect(updated.source_site).toBe("FT Markets (Equities)");
    expect(updated.notes).toBe("Changed to ticker-based lookup");
  });

  test("returns null for non-existent ID", () => {
    const result = updateTestInvestment(9999, {
      currencies_id: 1,
      investment_type_id: 1,
      description: "Does not exist",
    });
    expect(result).toBeNull();
  });
});

describe("TestInvestments - updateTestResult", () => {
  test("updates last_test_* fields", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    updateTestResult(id, "2026-02-08", true, "152.34");

    const ti = getTestInvestmentById(id);
    expect(ti.last_test_date).toBe("2026-02-08");
    expect(ti.last_test_success).toBe(1);
    expect(ti.last_test_price).toBe("152.34");
  });

  test("updates to failure state", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    updateTestResult(id, "2026-02-09", false, null);

    const ti = getTestInvestmentById(id);
    expect(ti.last_test_date).toBe("2026-02-09");
    expect(ti.last_test_success).toBe(0);
    expect(ti.last_test_price).toBeNull();
  });
});

// --- Test Prices ---

describe("TestPrices - upsertTestPrice and getTestPriceHistory", () => {
  test("inserts a test price", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    upsertTestPrice(id, "2026-02-08", "10:30:00", 152.34);

    const history = getTestPriceHistory(id);
    expect(history.length).toBe(1);
    expect(history[0].price_date).toBe("2026-02-08");
    expect(history[0].price_time).toBe("10:30:00");
    expect(history[0].price).toBeCloseTo(152.34, 2);
  });

  test("replaces price on same date (INSERT OR REPLACE)", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    upsertTestPrice(id, "2026-02-08", "14:00:00", 153.00);

    const history = getTestPriceHistory(id);
    expect(history.length).toBe(1);
    expect(history[0].price_time).toBe("14:00:00");
    expect(history[0].price).toBeCloseTo(153.00, 2);
  });

  test("inserts multiple dates", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    upsertTestPrice(id, "2026-02-07", "09:00:00", 150.50);
    upsertTestPrice(id, "2026-02-06", "09:00:00", 149.25);

    const history = getTestPriceHistory(id);
    expect(history.length).toBe(3);
    // Most recent first
    expect(history[0].price_date).toBe("2026-02-08");
    expect(history[1].price_date).toBe("2026-02-07");
    expect(history[2].price_date).toBe("2026-02-06");
  });

  test("respects limit parameter", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    const history = getTestPriceHistory(id, 2);
    expect(history.length).toBe(2);
    expect(history[0].price_date).toBe("2026-02-08");
    expect(history[1].price_date).toBe("2026-02-07");
  });
});

describe("TestPrices - getLatestTestPrice", () => {
  test("returns the most recent price", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    const latest = getLatestTestPrice(id);
    expect(latest).not.toBeNull();
    expect(latest.price_date).toBe("2026-02-08");
    expect(latest.price).toBeCloseTo(153.00, 2);
  });

  test("returns null for test investment with no prices", () => {
    const tests = getAllTestInvestments();
    const id = tests[1].id; // Fundsmith — no prices inserted
    const latest = getLatestTestPrice(id);
    expect(latest).toBeNull();
  });
});

// --- Cascade Delete ---

describe("TestInvestments - deleteTestInvestment cascade", () => {
  test("deleting a test investment cascades to test_prices", () => {
    const tests = getAllTestInvestments();
    const id = tests[0].id;

    // Confirm prices exist before delete
    const pricesBefore = getTestPriceHistory(id);
    expect(pricesBefore.length).toBeGreaterThan(0);

    const result = deleteTestInvestment(id);
    expect(result).toBe(true);

    // Verify the test investment is gone
    const deleted = getTestInvestmentById(id);
    expect(deleted).toBeNull();

    // Verify prices were cascade-deleted
    const pricesAfter = getTestPriceHistory(id);
    expect(pricesAfter.length).toBe(0);
  });

  test("returns false for non-existent ID", () => {
    const result = deleteTestInvestment(9999);
    expect(result).toBe(false);
  });
});
