// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-cash-transactions-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { createAccount, getAccountById } from "../../src/server/db/accounts-db.js";
import { createCashTransaction, getCashTransactionById, getCashTransactionsByAccountId, deleteCashTransaction, getIsaDepositsForTaxYear, drawdownExistsForDate, scaleCashAmount, unscaleCashAmount } from "../../src/server/db/cash-transactions-db.js";

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
/** @type {Object} Test SIPP account */
let sippAccount;
/** @type {Object} Test ISA account */
let isaAccount;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  testUser = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    provider: "ii",
    trading_ref: null,
    isa_ref: null,
    sipp_ref: null,
  });

  sippAccount = createAccount({
    user_id: testUser.id,
    account_type: "sipp",
    account_ref: "SIPP-001",
    cash_balance: 10000,
    warn_cash: 5000,
  });

  isaAccount = createAccount({
    user_id: testUser.id,
    account_type: "isa",
    account_ref: "ISA-001",
    cash_balance: 5000,
    warn_cash: 0,
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scaling helpers ---

describe("scaleCashAmount / unscaleCashAmount", () => {
  test("scales a decimal value to integer x10000", () => {
    expect(scaleCashAmount(1500)).toBe(15000000);
    expect(scaleCashAmount(0)).toBe(0);
    expect(scaleCashAmount(99.99)).toBe(999900);
  });

  test("unscales an integer back to decimal", () => {
    expect(unscaleCashAmount(15000000)).toBe(1500);
    expect(unscaleCashAmount(0)).toBe(0);
    expect(unscaleCashAmount(999900)).toBe(99.99);
  });

  test("round-trips correctly", () => {
    const original = 12345.6789;
    const scaled = scaleCashAmount(original);
    const unscaled = unscaleCashAmount(scaled);
    expect(Math.abs(unscaled - original)).toBeLessThan(0.0001);
  });
});

// --- Create cash transaction ---

describe("createCashTransaction", () => {
  test("creates a deposit and increases account cash balance", () => {
    const tx = createCashTransaction({
      account_id: sippAccount.id,
      transaction_type: "deposit",
      transaction_date: "2026-01-15",
      amount: 2000,
      notes: "Monthly pension contribution",
    });

    expect(tx).not.toBeNull();
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.account_id).toBe(sippAccount.id);
    expect(tx.transaction_type).toBe("deposit");
    expect(tx.transaction_date).toBe("2026-01-15");
    expect(tx.amount).toBe(2000);
    expect(tx.amount_scaled).toBe(20000000);
    expect(tx.notes).toBe("Monthly pension contribution");

    // Check balance increased from 10000 to 12000
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(12000);
  });

  test("creates a withdrawal and decreases account cash balance", () => {
    const tx = createCashTransaction({
      account_id: sippAccount.id,
      transaction_type: "withdrawal",
      transaction_date: "2026-01-20",
      amount: 500,
      notes: "Transfer out",
    });

    expect(tx).not.toBeNull();
    expect(tx.transaction_type).toBe("withdrawal");
    expect(tx.amount).toBe(500);

    // Balance was 12000, now 11500
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(11500);
  });

  test("creates a drawdown and decreases account cash balance", () => {
    const tx = createCashTransaction({
      account_id: sippAccount.id,
      transaction_type: "drawdown",
      transaction_date: "2026-02-01",
      amount: 1200,
      notes: "SIPP monthly pension",
    });

    expect(tx).not.toBeNull();
    expect(tx.transaction_type).toBe("drawdown");
    expect(tx.amount).toBe(1200);

    // Balance was 11500, now 10300
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(10300);
  });

  test("creates a transaction with null notes", () => {
    const tx = createCashTransaction({
      account_id: sippAccount.id,
      transaction_type: "deposit",
      transaction_date: "2026-02-05",
      amount: 100,
    });

    expect(tx.notes).toBeNull();

    // Balance was 10300, now 10400
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(10400);
  });

  test("throws on invalid transaction_type", () => {
    expect(() => {
      createCashTransaction({
        account_id: sippAccount.id,
        transaction_type: "transfer",
        transaction_date: "2026-02-10",
        amount: 100,
      });
    }).toThrow();
  });

  test("throws on invalid account_id FK", () => {
    expect(() => {
      createCashTransaction({
        account_id: 9999,
        transaction_type: "deposit",
        transaction_date: "2026-02-10",
        amount: 100,
      });
    }).toThrow();
  });
});

// --- Read cash transactions ---

describe("getCashTransactionById", () => {
  test("returns the correct transaction with unscaled amount", () => {
    const txList = getCashTransactionsByAccountId(sippAccount.id);
    const tx = getCashTransactionById(txList[0].id);

    expect(tx).not.toBeNull();
    expect(tx.id).toBe(txList[0].id);
    expect(tx.account_id).toBe(sippAccount.id);
  });

  test("returns null for non-existent ID", () => {
    const tx = getCashTransactionById(9999);
    expect(tx).toBeNull();
  });
});

describe("getCashTransactionsByAccountId", () => {
  test("returns transactions ordered newest first", () => {
    const txList = getCashTransactionsByAccountId(sippAccount.id);

    expect(txList.length).toBe(5);
    // Most recent first: opening balance (today), then 2026-02-05, 2026-02-01, 2026-01-20, 2026-01-15
    expect(txList[0].notes).toBe("Opening balance");
    expect(txList[1].transaction_date).toBe("2026-02-05");
    expect(txList[2].transaction_date).toBe("2026-02-01");
    expect(txList[3].transaction_date).toBe("2026-01-20");
    expect(txList[4].transaction_date).toBe("2026-01-15");
  });

  test("ISA account has opening balance transaction", () => {
    const txList = getCashTransactionsByAccountId(isaAccount.id);
    expect(txList.length).toBe(1);
    expect(txList[0].notes).toBe("Opening balance");
    expect(txList[0].amount).toBe(5000);
  });

  test("respects the limit parameter", () => {
    const txList = getCashTransactionsByAccountId(sippAccount.id, 2);
    expect(txList.length).toBe(2);
  });
});

// --- Delete cash transaction ---

describe("deleteCashTransaction", () => {
  test("deletes a deposit and reverses the balance increase", () => {
    // Current SIPP balance: 10400
    // The 100 deposit on 2026-02-05 was the last one
    const txList = getCashTransactionsByAccountId(sippAccount.id);
    const depositTx = txList.find((t) => t.transaction_date === "2026-02-05" && t.transaction_type === "deposit");

    const result = deleteCashTransaction(depositTx.id);
    expect(result).toBe(true);

    // Balance should decrease by 100: 10400 - 100 = 10300
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(10300);

    // Transaction should no longer exist
    const deleted = getCashTransactionById(depositTx.id);
    expect(deleted).toBeNull();
  });

  test("deletes a withdrawal and reverses the balance decrease", () => {
    // Current SIPP balance: 10300
    const txList = getCashTransactionsByAccountId(sippAccount.id);
    const withdrawalTx = txList.find((t) => t.transaction_type === "withdrawal");

    const result = deleteCashTransaction(withdrawalTx.id);
    expect(result).toBe(true);

    // Balance should increase by 500: 10300 + 500 = 10800
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(10800);
  });

  test("returns false for non-existent ID", () => {
    const result = deleteCashTransaction(9999);
    expect(result).toBe(false);
  });
});

// --- ISA deposit totals ---

describe("getIsaDepositsForTaxYear", () => {
  test("returns total deposits within date range", () => {
    // Add some ISA deposits
    createCashTransaction({
      account_id: isaAccount.id,
      transaction_type: "deposit",
      transaction_date: "2025-06-01",
      amount: 4500,
      notes: "ISA deposit 1",
    });
    createCashTransaction({
      account_id: isaAccount.id,
      transaction_type: "deposit",
      transaction_date: "2025-09-15",
      amount: 3000,
      notes: "ISA deposit 2",
    });
    createCashTransaction({
      account_id: isaAccount.id,
      transaction_type: "withdrawal",
      transaction_date: "2025-08-01",
      amount: 200,
      notes: "Withdrawal - should not count",
    });

    // Tax year 2025/26: 6 Apr 2025 to 5 Apr 2026
    const total = getIsaDepositsForTaxYear(isaAccount.id, "2025-04-06", "2026-04-05");
    // Only deposits count: 5000 (opening balance) + 4500 + 3000 = 12500
    expect(total).toBe(12500);
  });

  test("returns 0 when no deposits in range", () => {
    // Different tax year — no deposits before April 2025
    const total = getIsaDepositsForTaxYear(isaAccount.id, "2024-04-06", "2025-04-05");
    expect(total).toBe(0);
  });

  test("returns 0 for account with no transactions", () => {
    const tradingAccount = createAccount({
      user_id: testUser.id,
      account_type: "trading",
      account_ref: "TRADE-001",
      cash_balance: 0,
      warn_cash: 0,
    });
    const total = getIsaDepositsForTaxYear(tradingAccount.id, "2025-04-06", "2026-04-05");
    expect(total).toBe(0);
  });
});

// --- Adjustment (fee) transactions ---

describe("createCashTransaction — adjustments", () => {
  /** @type {Object} Separate user for adjustment tests */
  let adjUser;
  /** @type {Object} Account for adjustment tests */
  let adjAccount;

  beforeAll(() => {
    adjUser = createUser({
      initials: "AJ",
      first_name: "Adj",
      last_name: "Tester",
      provider: "hl",
    });
    adjAccount = createAccount({
      user_id: adjUser.id,
      account_type: "trading",
      account_ref: "ADJ-001",
      cash_balance: 5000,
      warn_cash: 0,
    });
  });

  test("debit adjustment decreases cash balance", () => {
    const tx = createCashTransaction({
      account_id: adjAccount.id,
      transaction_type: "adjustment",
      transaction_date: "2026-02-10",
      amount: 150,
      notes: "Platform fee",
      direction: "debit",
    });

    expect(tx).not.toBeNull();
    expect(tx.transaction_type).toBe("adjustment");
    expect(tx.amount).toBe(150);
    expect(tx.notes).toBe("Platform fee");

    // Balance was 5000, now 4850
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4850);
  });

  test("debit adjustment defaults when direction omitted", () => {
    const tx = createCashTransaction({
      account_id: adjAccount.id,
      transaction_type: "adjustment",
      transaction_date: "2026-02-11",
      amount: 50,
      notes: "Admin charge",
    });

    expect(tx.transaction_type).toBe("adjustment");
    expect(tx.amount).toBe(50);

    // Balance was 4850, now 4800 (defaults to debit)
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4800);
  });

  test("credit adjustment increases cash balance", () => {
    const tx = createCashTransaction({
      account_id: adjAccount.id,
      transaction_type: "adjustment",
      transaction_date: "2026-02-12",
      amount: 25,
      notes: "Provider refund",
      direction: "credit",
    });

    expect(tx).not.toBeNull();
    expect(tx.transaction_type).toBe("adjustment");
    expect(tx.amount).toBe(25);
    // Notes should be prefixed with [Credit]
    expect(tx.notes).toBe("[Credit] Provider refund");

    // Balance was 4800, now 4825
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4825);
  });

  test("credit adjustment with no user notes stores [Credit] tag", () => {
    const tx = createCashTransaction({
      account_id: adjAccount.id,
      transaction_type: "adjustment",
      transaction_date: "2026-02-13",
      amount: 10,
      direction: "credit",
    });

    expect(tx.notes).toBe("[Credit]");

    // Balance was 4825, now 4835
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4835);
  });

  test("delete credit adjustment reverses the balance increase", () => {
    // Find the last credit adjustment (the one with notes "[Credit]")
    const txList = getCashTransactionsByAccountId(adjAccount.id);
    const creditTx = txList.find((t) => t.notes === "[Credit]");

    const result = deleteCashTransaction(creditTx.id);
    expect(result).toBe(true);

    // Balance was 4835, removing a +10 credit reverses to 4825
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4825);
  });

  test("delete debit adjustment reverses the balance decrease", () => {
    const txList = getCashTransactionsByAccountId(adjAccount.id);
    const debitTx = txList.find((t) => t.notes === "Admin charge");

    const result = deleteCashTransaction(debitTx.id);
    expect(result).toBe(true);

    // Balance was 4825, removing a -50 debit reverses to 4875
    const account = getAccountById(adjAccount.id);
    expect(account.cash_balance).toBe(4875);
  });
});

// --- Drawdown exists check ---

describe("drawdownExistsForDate", () => {
  test("returns true when drawdown exists for date", () => {
    // A drawdown was created on 2026-02-01 for sippAccount
    const exists = drawdownExistsForDate(sippAccount.id, "2026-02-01");
    expect(exists).toBe(true);
  });

  test("returns false when no drawdown for date", () => {
    const exists = drawdownExistsForDate(sippAccount.id, "2026-03-01");
    expect(exists).toBe(false);
  });

  test("returns false for different account", () => {
    const exists = drawdownExistsForDate(isaAccount.id, "2026-02-01");
    expect(exists).toBe(false);
  });
});
