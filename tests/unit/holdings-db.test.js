// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-holdings-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { createAccount, deleteAccount } from "../../src/server/db/accounts-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import {
  getHoldingsByAccountId,
  getHoldingById,
  createHolding,
  updateHolding,
  deleteHolding,
  scaleQuantity,
  unscaleQuantity,
} from "../../src/server/db/holdings-db.js";

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

/** @type {Object} Test user */
let testUser;
/** @type {Object} Test account */
let testAccount;
/** @type {Object} First test investment */
let investment1;
/** @type {Object} Second test investment */
let investment2;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Create test user
  testUser = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    provider: "ii",
  });

  // Create test account
  testAccount = createAccount({
    user_id: testUser.id,
    account_type: "sipp",
    account_ref: "12345",
    cash_balance: 23765.50,
    warn_cash: 25000,
  });

  // Create test investments
  const types = getAllInvestmentTypes();
  const currencies = getAllCurrencies();
  const shareType = types.find((t) => t.short_description === "SHARE");
  const gbp = currencies.find((c) => c.code === "GBP");

  investment1 = createInvestment({
    currencies_id: gbp.id,
    investment_type_id: shareType.id,
    description: "Raspberry Pi Holdings",
    public_id: "LSE:RPI",
  });

  investment2 = createInvestment({
    currencies_id: gbp.id,
    investment_type_id: shareType.id,
    description: "Rathbone Global Opportunities Fund",
    public_id: "GB00B7FQLN12",
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scaling helpers ---

describe("scaleQuantity / unscaleQuantity", () => {
  test("scales a decimal value to integer x10000", () => {
    expect(scaleQuantity(661.152)).toBe(6611520);
    expect(scaleQuantity(0)).toBe(0);
    expect(scaleQuantity(365)).toBe(3650000);
  });

  test("unscales an integer back to decimal", () => {
    expect(unscaleQuantity(6611520)).toBe(661.152);
    expect(unscaleQuantity(0)).toBe(0);
    expect(unscaleQuantity(3650000)).toBe(365);
  });

  test("round-trips correctly", () => {
    const original = 661.1523;
    const scaled = scaleQuantity(original);
    const unscaled = unscaleQuantity(scaled);
    expect(Math.abs(unscaled - original)).toBeLessThan(0.0001);
  });
});

// --- Holdings CRUD ---

describe("getHoldingsByAccountId", () => {
  test("returns empty array when no holdings exist", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    expect(holdings).toEqual([]);
  });
});

describe("createHolding", () => {
  test("creates a holding and returns it with investment details", () => {
    const holding = createHolding({
      account_id: testAccount.id,
      investment_id: investment1.id,
      quantity: 365,
      average_cost: 0.955,
    });

    expect(holding).not.toBeNull();
    expect(holding.id).toBeGreaterThan(0);
    expect(holding.account_id).toBe(testAccount.id);
    expect(holding.investment_id).toBe(investment1.id);
    expect(holding.quantity).toBe(365);
    expect(holding.average_cost).toBe(0.955);
    expect(holding.quantity_scaled).toBe(3650000);
    expect(holding.average_cost_scaled).toBe(9550);
    expect(holding.investment_description).toBe("Raspberry Pi Holdings");
    expect(holding.investment_public_id).toBe("LSE:RPI");
    expect(holding.currency_code).toBe("GBP");
  });

  test("creates a second holding with fractional quantity", () => {
    const holding = createHolding({
      account_id: testAccount.id,
      investment_id: investment2.id,
      quantity: 661.152,
      average_cost: 130.40,
    });

    expect(holding).not.toBeNull();
    expect(holding.quantity).toBe(661.152);
    expect(holding.average_cost).toBe(130.4);
    expect(holding.investment_description).toBe("Rathbone Global Opportunities Fund");
  });

  test("throws on duplicate account_id + investment_id", () => {
    expect(() => {
      createHolding({
        account_id: testAccount.id,
        investment_id: investment1.id,
        quantity: 100,
        average_cost: 1.00,
      });
    }).toThrow();
  });

  test("throws on invalid account_id FK", () => {
    expect(() => {
      createHolding({
        account_id: 9999,
        investment_id: investment1.id,
        quantity: 100,
        average_cost: 1.00,
      });
    }).toThrow();
  });

  test("throws on invalid investment_id FK", () => {
    expect(() => {
      createHolding({
        account_id: testAccount.id,
        investment_id: 9999,
        quantity: 100,
        average_cost: 1.00,
      });
    }).toThrow();
  });
});

describe("getHoldingsByAccountId after inserts", () => {
  test("returns all holdings for the account ordered by investment description", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    expect(holdings.length).toBe(2);
    // Alphabetical: Raspberry Pi comes before Rathbone
    expect(holdings[0].investment_description).toBe("Raspberry Pi Holdings");
    expect(holdings[1].investment_description).toBe("Rathbone Global Opportunities Fund");
  });

  test("each holding has investment details", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    for (const h of holdings) {
      expect(h.investment_description).toBeTruthy();
      expect(h.currency_code).toBeTruthy();
    }
  });

  test("returns empty array for non-existent account", () => {
    const holdings = getHoldingsByAccountId(9999);
    expect(holdings).toEqual([]);
  });
});

describe("getHoldingById", () => {
  test("returns the correct holding with investment details", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    const holding = getHoldingById(holdings[0].id);

    expect(holding).not.toBeNull();
    expect(holding.id).toBe(holdings[0].id);
    expect(holding.investment_description).toBe("Raspberry Pi Holdings");
    expect(holding.currency_code).toBe("GBP");
  });

  test("returns null for non-existent ID", () => {
    const holding = getHoldingById(9999);
    expect(holding).toBeNull();
  });
});

describe("updateHolding", () => {
  test("updates quantity and average_cost and returns the updated holding", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    const id = holdings[0].id;

    const updated = updateHolding(id, {
      quantity: 400,
      average_cost: 1.10,
    });

    expect(updated).not.toBeNull();
    expect(updated.quantity).toBe(400);
    expect(updated.average_cost).toBe(1.1);
    // Investment details preserved
    expect(updated.investment_description).toBe("Raspberry Pi Holdings");
  });

  test("returns null for non-existent ID", () => {
    const result = updateHolding(9999, {
      quantity: 100,
      average_cost: 1.00,
    });
    expect(result).toBeNull();
  });
});

describe("deleteHolding", () => {
  test("deletes a holding and returns true", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    const id = holdings[0].id;

    const result = deleteHolding(id);
    expect(result).toBe(true);

    const deleted = getHoldingById(id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteHolding(9999);
    expect(result).toBe(false);
  });

  test("remaining holdings still exist", () => {
    const holdings = getHoldingsByAccountId(testAccount.id);
    expect(holdings.length).toBe(1);
  });
});

describe("cascade delete via account", () => {
  test("deleting an account removes its holdings", () => {
    // Verify we have holdings
    let holdings = getHoldingsByAccountId(testAccount.id);
    expect(holdings.length).toBe(1);

    // Delete the account (should cascade to holdings)
    const result = deleteAccount(testAccount.id);
    expect(result).toBe(true);

    // Holdings should be gone
    holdings = getHoldingsByAccountId(testAccount.id);
    expect(holdings).toEqual([]);
  });
});
