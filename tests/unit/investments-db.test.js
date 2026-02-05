// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-investments-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllInvestmentTypes, getInvestmentTypeById } from "../../src/server/db/investment-types-db.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import { getAllInvestments, getInvestmentById, createInvestment, updateInvestment, deleteInvestment } from "../../src/server/db/investments-db.js";

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

// --- Investment Types (seeded, read-only) ---

describe("Investment Types - getAllInvestmentTypes", () => {
  test("returns 5 seeded investment types", () => {
    const types = getAllInvestmentTypes();
    expect(types.length).toBe(5);
  });

  test("types are ordered by description", () => {
    const types = getAllInvestmentTypes();
    const descriptions = types.map((t) => t.description);
    const sorted = [...descriptions].sort();
    expect(descriptions).toEqual(sorted);
  });

  test("each type has required fields", () => {
    const types = getAllInvestmentTypes();
    for (const type of types) {
      expect(type.id).toBeGreaterThan(0);
      expect(type.short_description).toBeTruthy();
      expect(type.description).toBeTruthy();
    }
  });
});

describe("Investment Types - getInvestmentTypeById", () => {
  test("returns the correct type", () => {
    const types = getAllInvestmentTypes();
    const type = getInvestmentTypeById(types[0].id);
    expect(type).not.toBeNull();
    expect(type.id).toBe(types[0].id);
    expect(type.description).toBe(types[0].description);
  });

  test("returns null for non-existent ID", () => {
    const type = getInvestmentTypeById(9999);
    expect(type).toBeNull();
  });
});

// --- Currencies (seeded GBP) ---

describe("Currencies - getAllCurrencies", () => {
  test("returns at least GBP from seed data", () => {
    const currencies = getAllCurrencies();
    expect(currencies.length).toBeGreaterThanOrEqual(1);
    const gbp = currencies.find((c) => c.code === "GBP");
    expect(gbp).not.toBeUndefined();
    expect(gbp.description).toBe("British Pound Sterling");
  });
});

// --- Investments CRUD ---

describe("Investments - getAllInvestments", () => {
  test("returns empty array when no investments exist", () => {
    const investments = getAllInvestments();
    expect(investments).toEqual([]);
  });
});

describe("Investments - createInvestment", () => {
  test("creates an investment and returns it with joined fields", () => {
    const types = getAllInvestmentTypes();
    const currencies = getAllCurrencies();
    const shareType = types.find((t) => t.short_description === "SHARE");
    const gbp = currencies.find((c) => c.code === "GBP");

    const inv = createInvestment({
      currencies_id: gbp.id,
      investment_type_id: shareType.id,
      description: "Vanguard FTSE All-World ETF",
      investment_url: "https://www.example.com/fund-page",
      selector: ".price-value",
    });

    expect(inv).not.toBeNull();
    expect(inv.id).toBeGreaterThan(0);
    expect(inv.description).toBe("Vanguard FTSE All-World ETF");
    expect(inv.currency_code).toBe("GBP");
    expect(inv.type_short).toBe("SHARE");
    expect(inv.type_description).toBe("Shares");
    expect(inv.investment_url).toBe("https://www.example.com/fund-page");
    expect(inv.selector).toBe(".price-value");
  });

  test("creates an investment with optional fields as null", () => {
    const types = getAllInvestmentTypes();
    const currencies = getAllCurrencies();
    const mutualType = types.find((t) => t.short_description === "MUTUAL");
    const gbp = currencies.find((c) => c.code === "GBP");

    const inv = createInvestment({
      currencies_id: gbp.id,
      investment_type_id: mutualType.id,
      description: "Fundsmith Equity Fund",
    });

    expect(inv).not.toBeNull();
    expect(inv.investment_url).toBeNull();
    expect(inv.selector).toBeNull();
    expect(inv.type_short).toBe("MUTUAL");
  });

  test("throws on invalid currency FK", () => {
    const types = getAllInvestmentTypes();
    expect(() => {
      createInvestment({
        currencies_id: 9999,
        investment_type_id: types[0].id,
        description: "Bad currency ref",
      });
    }).toThrow();
  });

  test("throws on invalid investment type FK", () => {
    const currencies = getAllCurrencies();
    expect(() => {
      createInvestment({
        currencies_id: currencies[0].id,
        investment_type_id: 9999,
        description: "Bad type ref",
      });
    }).toThrow();
  });
});

describe("Investments - getAllInvestments after inserts", () => {
  test("returns all investments ordered by description", () => {
    const investments = getAllInvestments();
    expect(investments.length).toBe(2);
    // Fundsmith comes before Vanguard alphabetically
    expect(investments[0].description).toBe("Fundsmith Equity Fund");
    expect(investments[1].description).toBe("Vanguard FTSE All-World ETF");
  });

  test("each investment has joined currency and type fields", () => {
    const investments = getAllInvestments();
    for (const inv of investments) {
      expect(inv.currency_code).toBeTruthy();
      expect(inv.currency_description).toBeTruthy();
      expect(inv.type_short).toBeTruthy();
      expect(inv.type_description).toBeTruthy();
    }
  });
});

describe("Investments - getInvestmentById", () => {
  test("returns the correct investment with joined fields", () => {
    const investments = getAllInvestments();
    const inv = getInvestmentById(investments[0].id);
    expect(inv).not.toBeNull();
    expect(inv.id).toBe(investments[0].id);
    expect(inv.description).toBe(investments[0].description);
    expect(inv.currency_code).toBeTruthy();
    expect(inv.type_short).toBeTruthy();
  });

  test("returns null for non-existent ID", () => {
    const inv = getInvestmentById(9999);
    expect(inv).toBeNull();
  });
});

describe("Investments - updateInvestment", () => {
  test("updates investment fields and returns the updated investment", () => {
    const investments = getAllInvestments();
    const id = investments[0].id;
    const types = getAllInvestmentTypes();
    const trustType = types.find((t) => t.short_description === "TRUST");
    const currencies = getAllCurrencies();
    const gbp = currencies.find((c) => c.code === "GBP");

    const updated = updateInvestment(id, {
      currencies_id: gbp.id,
      investment_type_id: trustType.id,
      description: "Fundsmith Equity Fund (Updated)",
      investment_url: "https://www.example.com/updated",
      selector: ".new-selector",
    });

    expect(updated).not.toBeNull();
    expect(updated.description).toBe("Fundsmith Equity Fund (Updated)");
    expect(updated.type_short).toBe("TRUST");
    expect(updated.investment_url).toBe("https://www.example.com/updated");
    expect(updated.selector).toBe(".new-selector");
  });

  test("returns null for non-existent ID", () => {
    const result = updateInvestment(9999, {
      currencies_id: 1,
      investment_type_id: 1,
      description: "Does not exist",
    });
    expect(result).toBeNull();
  });

  test("throws on invalid FK during update", () => {
    const investments = getAllInvestments();
    const id = investments[0].id;
    expect(() => {
      updateInvestment(id, {
        currencies_id: 9999,
        investment_type_id: 1,
        description: "Bad FK update",
      });
    }).toThrow();
  });
});

describe("Investments - deleteInvestment", () => {
  test("deletes an investment and returns true", () => {
    const investments = getAllInvestments();
    const id = investments[0].id;
    const result = deleteInvestment(id);
    expect(result).toBe(true);

    const deleted = getInvestmentById(id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteInvestment(9999);
    expect(result).toBe(false);
  });
});
