// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-prices-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { upsertPrice, getLatestPrice, getPriceHistory, getPriceByDate, scalePrice, unscalePrice } from "../../src/server/db/prices-db.js";

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

let testCurrency;
let testInvestment;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Get GBP currency (seeded)
  const currencies = getAllCurrencies();
  testCurrency = currencies.find((c) => c.code === "GBP");

  // Get an investment type
  const types = getAllInvestmentTypes();
  const shareType = types.find((t) => t.short_description === "SHARE");

  // Create a test investment
  testInvestment = createInvestment({
    currencies_id: testCurrency.id,
    investment_type_id: shareType.id,
    description: "Test Share",
    investment_url: "https://example.com/share",
    selector: ".price",
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scale/Unscale functions ---

describe("Prices - scalePrice", () => {
  test("scales a price by multiplying by 10000", () => {
    expect(scalePrice(123.4567)).toBe(1234567);
  });

  test("rounds to nearest integer", () => {
    expect(scalePrice(123.45678)).toBe(1234568);
  });

  test("handles zero", () => {
    expect(scalePrice(0)).toBe(0);
  });

  test("handles negative values", () => {
    expect(scalePrice(-50.25)).toBe(-502500);
  });
});

describe("Prices - unscalePrice", () => {
  test("unscales a price by dividing by 10000", () => {
    expect(unscalePrice(1234567)).toBe(123.4567);
  });

  test("handles zero", () => {
    expect(unscalePrice(0)).toBe(0);
  });
});

// --- upsertPrice ---

describe("Prices - upsertPrice", () => {
  test("inserts a new price for an investment", () => {
    // upsertPrice takes minor units (pence) and scales by 10000 internally
    // 123.4567 pence -> stored as 1234567
    upsertPrice(testInvestment.id, "2026-02-06", "10:30:00", 123.4567);

    const price = getPriceByDate(testInvestment.id, "2026-02-06");
    expect(price).not.toBeNull();
    expect(price.price_scaled).toBe(1234567);
    expect(price.price).toBeCloseTo(123.4567, 4);
  });

  test("overwrites an existing price for the same date", () => {
    upsertPrice(testInvestment.id, "2026-02-06", "10:35:00", 999.9999);

    const price = getPriceByDate(testInvestment.id, "2026-02-06");
    expect(price.price_scaled).toBe(9999999);
  });

  test("inserts prices for different dates", () => {
    upsertPrice(testInvestment.id, "2026-02-05", "10:30:00", 111.1111);
    upsertPrice(testInvestment.id, "2026-02-04", "10:30:00", 222.2222);

    const price5 = getPriceByDate(testInvestment.id, "2026-02-05");
    const price4 = getPriceByDate(testInvestment.id, "2026-02-04");

    expect(price5.price_scaled).toBe(1111111);
    expect(price4.price_scaled).toBe(2222222);
  });
});

// --- getLatestPrice ---

describe("Prices - getLatestPrice", () => {
  test("returns the most recent price by date", () => {
    const latest = getLatestPrice(testInvestment.id);
    expect(latest).not.toBeNull();
    expect(latest.price_date).toBe("2026-02-06");
  });

  test("returns null for investment with no prices", () => {
    // Create another investment with no prices
    const types = getAllInvestmentTypes();
    const shareType = types.find((t) => t.short_description === "SHARE");

    const emptyInv = createInvestment({
      currencies_id: testCurrency.id,
      investment_type_id: shareType.id,
      description: "No Prices Investment",
    });

    const latest = getLatestPrice(emptyInv.id);
    expect(latest).toBeNull();
  });
});

// --- getPriceHistory ---

describe("Prices - getPriceHistory", () => {
  test("returns prices ordered by date descending", () => {
    const history = getPriceHistory(testInvestment.id);
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Check order is descending
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].price_date >= history[i].price_date).toBe(true);
    }
  });

  test("respects the limit parameter", () => {
    const history = getPriceHistory(testInvestment.id, 2);
    expect(history.length).toBe(2);
  });

  test("returns empty array for non-existent investment", () => {
    const history = getPriceHistory(9999);
    expect(history).toEqual([]);
  });
});

// --- getPriceByDate ---

describe("Prices - getPriceByDate", () => {
  test("returns the price for a specific date", () => {
    const price = getPriceByDate(testInvestment.id, "2026-02-05");
    expect(price).not.toBeNull();
    expect(price.price_date).toBe("2026-02-05");
    expect(price.investment_id).toBe(testInvestment.id);
  });

  test("returns null for date with no price", () => {
    const price = getPriceByDate(testInvestment.id, "2020-01-01");
    expect(price).toBeNull();
  });

  test("returns null for non-existent investment", () => {
    const price = getPriceByDate(9999, "2026-02-06");
    expect(price).toBeNull();
  });
});
