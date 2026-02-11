// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-accounts-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import {
  getAccountsByUserId,
  getAccountById,
  createAccount,
  updateAccount,
  deleteAccount,
  scaleCash,
  unscaleCash,
} from "../../src/server/db/accounts-db.js";

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

/** @type {Object} Test user created in beforeAll */
let testUser;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Create a test user to attach accounts to
  testUser = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    provider: "ii",
    trading_ref: null,
    isa_ref: null,
    sipp_ref: null,
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scaling helpers ---

describe("scaleCash / unscaleCash", () => {
  test("scales a decimal value to integer x10000", () => {
    expect(scaleCash(23765.5)).toBe(237655000);
    expect(scaleCash(0)).toBe(0);
    expect(scaleCash(100)).toBe(1000000);
  });

  test("unscales an integer back to decimal", () => {
    expect(unscaleCash(237655000)).toBe(23765.5);
    expect(unscaleCash(0)).toBe(0);
    expect(unscaleCash(1000000)).toBe(100);
  });

  test("round-trips correctly", () => {
    const original = 12345.6789;
    const scaled = scaleCash(original);
    const unscaled = unscaleCash(scaled);
    // Within rounding tolerance (scaled uses Math.round)
    expect(Math.abs(unscaled - original)).toBeLessThan(0.0001);
  });
});

// --- Accounts CRUD ---

describe("getAccountsByUserId", () => {
  test("returns empty array when no accounts exist", () => {
    const accounts = getAccountsByUserId(testUser.id);
    expect(accounts).toEqual([]);
  });
});

describe("createAccount", () => {
  test("creates a SIPP account and returns it with unscaled values", () => {
    const account = createAccount({
      user_id: testUser.id,
      account_type: "sipp",
      account_ref: "12345",
      cash_balance: 23765.50,
      warn_cash: 25000.00,
    });

    expect(account).not.toBeNull();
    expect(account.id).toBeGreaterThan(0);
    expect(account.user_id).toBe(testUser.id);
    expect(account.account_type).toBe("sipp");
    expect(account.account_ref).toBe("12345");
    expect(account.cash_balance).toBe(23765.5);
    expect(account.warn_cash).toBe(25000);
    expect(account.cash_balance_scaled).toBe(237655000);
    expect(account.warn_cash_scaled).toBe(250000000);
  });

  test("creates a Trading account with zero cash", () => {
    const account = createAccount({
      user_id: testUser.id,
      account_type: "trading",
      account_ref: "7654321",
      cash_balance: 27,
      warn_cash: 0,
    });

    expect(account).not.toBeNull();
    expect(account.account_type).toBe("trading");
    expect(account.account_ref).toBe("7654321");
    expect(account.cash_balance).toBe(27);
    expect(account.warn_cash).toBe(0);
  });

  test("creates an ISA account", () => {
    const account = createAccount({
      user_id: testUser.id,
      account_type: "isa",
      account_ref: "775339",
      cash_balance: 19088,
      warn_cash: 0,
    });

    expect(account).not.toBeNull();
    expect(account.account_type).toBe("isa");
  });

  test("throws on duplicate user_id + account_type", () => {
    expect(() => {
      createAccount({
        user_id: testUser.id,
        account_type: "sipp",
        account_ref: "99999",
        cash_balance: 0,
        warn_cash: 0,
      });
    }).toThrow();
  });

  test("throws on invalid account_type", () => {
    expect(() => {
      createAccount({
        user_id: testUser.id,
        account_type: "pension",
        account_ref: "111",
        cash_balance: 0,
        warn_cash: 0,
      });
    }).toThrow();
  });

  test("throws on invalid user_id FK", () => {
    expect(() => {
      createAccount({
        user_id: 9999,
        account_type: "trading",
        account_ref: "111",
        cash_balance: 0,
        warn_cash: 0,
      });
    }).toThrow();
  });
});

describe("getAccountsByUserId after inserts", () => {
  test("returns all accounts for the user ordered by account_type", () => {
    const accounts = getAccountsByUserId(testUser.id);
    expect(accounts.length).toBe(3);
    // Alphabetical: isa, sipp, trading
    expect(accounts[0].account_type).toBe("isa");
    expect(accounts[1].account_type).toBe("sipp");
    expect(accounts[2].account_type).toBe("trading");
  });

  test("returns empty array for non-existent user", () => {
    const accounts = getAccountsByUserId(9999);
    expect(accounts).toEqual([]);
  });
});

describe("getAccountById", () => {
  test("returns the correct account with unscaled values", () => {
    const accounts = getAccountsByUserId(testUser.id);
    const sipp = accounts.find((a) => a.account_type === "sipp");
    const account = getAccountById(sipp.id);

    expect(account).not.toBeNull();
    expect(account.id).toBe(sipp.id);
    expect(account.account_type).toBe("sipp");
    expect(account.cash_balance).toBe(23765.5);
  });

  test("returns null for non-existent ID", () => {
    const account = getAccountById(9999);
    expect(account).toBeNull();
  });
});

describe("updateAccount", () => {
  test("updates account fields and returns the updated account", () => {
    const accounts = getAccountsByUserId(testUser.id);
    const sipp = accounts.find((a) => a.account_type === "sipp");

    const updated = updateAccount(sipp.id, {
      account_ref: "12345-NEW",
      cash_balance: 30000,
      warn_cash: 20000,
    });

    expect(updated).not.toBeNull();
    expect(updated.account_ref).toBe("12345-NEW");
    expect(updated.cash_balance).toBe(30000);
    expect(updated.warn_cash).toBe(20000);
  });

  test("returns null for non-existent ID", () => {
    const result = updateAccount(9999, {
      account_ref: "X",
      cash_balance: 0,
      warn_cash: 0,
    });
    expect(result).toBeNull();
  });
});

describe("deleteAccount", () => {
  test("deletes an account and returns true", () => {
    const accounts = getAccountsByUserId(testUser.id);
    const isa = accounts.find((a) => a.account_type === "isa");

    const result = deleteAccount(isa.id);
    expect(result).toBe(true);

    const deleted = getAccountById(isa.id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteAccount(9999);
    expect(result).toBe(false);
  });

  test("remaining accounts still exist", () => {
    const accounts = getAccountsByUserId(testUser.id);
    expect(accounts.length).toBe(2);
  });
});
