// Set isolated DB path BEFORE importing connection.js (which reads it lazily on first call)
process.env.DB_PATH = "data/portfolio_60_test/test-currencies-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import {
  getAllCurrencies,
  getCurrencyById,
  createCurrency,
  updateCurrency,
  deleteCurrency,
} from "../../src/server/db/currencies-db.js";

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

// --- Seeded data ---

describe("Currencies - getAllCurrencies", () => {
  test("returns at least GBP from seed data", () => {
    const currencies = getAllCurrencies();
    expect(currencies.length).toBeGreaterThanOrEqual(1);
    const gbp = currencies.find((c) => c.code === "GBP");
    expect(gbp).not.toBeUndefined();
    expect(gbp.description).toBe("British Pound Sterling");
  });

  test("currencies are ordered by code", () => {
    const currencies = getAllCurrencies();
    const codes = currencies.map((c) => c.code);
    const sorted = [...codes].sort();
    expect(codes).toEqual(sorted);
  });
});

describe("Currencies - getCurrencyById", () => {
  test("returns the correct currency", () => {
    const currencies = getAllCurrencies();
    const currency = getCurrencyById(currencies[0].id);
    expect(currency).not.toBeNull();
    expect(currency.id).toBe(currencies[0].id);
    expect(currency.code).toBe(currencies[0].code);
  });

  test("returns null for non-existent ID", () => {
    const currency = getCurrencyById(9999);
    expect(currency).toBeNull();
  });
});

// --- Create ---

describe("Currencies - createCurrency", () => {
  test("creates a currency and returns it", () => {
    const currency = createCurrency({ code: "USD", description: "US Dollar" });
    expect(currency).not.toBeNull();
    expect(currency.id).toBeGreaterThan(0);
    expect(currency.code).toBe("USD");
    expect(currency.description).toBe("US Dollar");
  });

  test("creates another currency", () => {
    const currency = createCurrency({ code: "EUR", description: "Euro" });
    expect(currency).not.toBeNull();
    expect(currency.code).toBe("EUR");
  });

  test("throws on duplicate code", () => {
    expect(() => {
      createCurrency({ code: "USD", description: "Duplicate USD" });
    }).toThrow();
  });
});

describe("Currencies - getAllCurrencies after inserts", () => {
  test("returns all currencies ordered by code", () => {
    const currencies = getAllCurrencies();
    expect(currencies.length).toBe(3);
    expect(currencies[0].code).toBe("EUR");
    expect(currencies[1].code).toBe("GBP");
    expect(currencies[2].code).toBe("USD");
  });
});

// --- Update ---

describe("Currencies - updateCurrency", () => {
  test("updates a currency and returns it", () => {
    const currencies = getAllCurrencies();
    const usd = currencies.find((c) => c.code === "USD");

    const updated = updateCurrency(usd.id, { code: "USD", description: "United States Dollar" });
    expect(updated).not.toBeNull();
    expect(updated.description).toBe("United States Dollar");
    expect(updated.code).toBe("USD");
  });

  test("can change currency code", () => {
    const currencies = getAllCurrencies();
    const eur = currencies.find((c) => c.code === "EUR");

    const updated = updateCurrency(eur.id, { code: "JPY", description: "Japanese Yen" });
    expect(updated).not.toBeNull();
    expect(updated.code).toBe("JPY");
    expect(updated.description).toBe("Japanese Yen");
  });

  test("returns null for non-existent ID", () => {
    const result = updateCurrency(9999, { code: "XXX", description: "Does not exist" });
    expect(result).toBeNull();
  });

  test("throws on duplicate code during update", () => {
    const currencies = getAllCurrencies();
    const jpy = currencies.find((c) => c.code === "JPY");

    expect(() => {
      updateCurrency(jpy.id, { code: "USD", description: "Try duplicate" });
    }).toThrow();
  });
});

// --- Delete ---

describe("Currencies - deleteCurrency", () => {
  test("blocks deletion of GBP", () => {
    const currencies = getAllCurrencies();
    const gbp = currencies.find((c) => c.code === "GBP");

    const result = deleteCurrency(gbp.id);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain("base currency");
  });

  test("returns not found for non-existent ID", () => {
    const result = deleteCurrency(9999);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain("not found");
  });

  test("deletes a currency with no references", () => {
    const currencies = getAllCurrencies();
    const jpy = currencies.find((c) => c.code === "JPY");

    const result = deleteCurrency(jpy.id);
    expect(result.deleted).toBe(true);

    const deleted = getCurrencyById(jpy.id);
    expect(deleted).toBeNull();
  });

  test("blocks deletion when investments reference the currency", () => {
    // We need to import createInvestment to set up the FK reference
    const { createInvestment } = require("../../src/server/db/investments-db.js");
    const { getAllInvestmentTypes } = require("../../src/server/db/investment-types-db.js");

    const currencies = getAllCurrencies();
    const usd = currencies.find((c) => c.code === "USD");
    const types = getAllInvestmentTypes();

    // Create an investment referencing USD
    createInvestment({
      currencies_id: usd.id,
      investment_type_id: types[0].id,
      description: "Test investment for FK check",
    });

    const result = deleteCurrency(usd.id);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain("investment");
  });
});
