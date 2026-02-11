// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-drawdown-processor.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { createAccount, getAccountById } from "../../src/server/db/accounts-db.js";
import { createDrawdownSchedule, updateDrawdownSchedule } from "../../src/server/db/drawdown-schedules-db.js";
import { getCashTransactionsByAccountId, createCashTransaction } from "../../src/server/db/cash-transactions-db.js";
import { processDrawdowns, previewDrawdowns } from "../../src/server/services/drawdown-processor.js";

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
/** @type {Object} SIPP account with ample cash */
let sippAccount;
/** @type {Object} SIPP account with low cash (for negative balance test) */
let lowCashSippAccount;

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
    cash_balance: 100000,
    warn_cash: 5000,
  });

  const testUser2 = createUser({
    initials: "JC",
    first_name: "Jane",
    last_name: "Collins",
    provider: "hl",
    trading_ref: null,
    isa_ref: null,
    sipp_ref: null,
  });

  lowCashSippAccount = createAccount({
    user_id: testUser2.id,
    account_type: "sipp",
    account_ref: "SIPP-002",
    cash_balance: 500,
    warn_cash: 0,
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

describe("processDrawdowns", () => {
  test("returns zero counts when no active schedules exist", () => {
    const result = processDrawdowns();
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  test("processes monthly drawdowns up to today", () => {
    // Create a schedule starting well in the past so we get some due dates
    // Use dates that are definitely in the past relative to today (2026-02-11)
    createDrawdownSchedule({
      account_id: sippAccount.id,
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2025-11-01",
      to_date: "2026-04-01",
      amount: 1200,
      notes: "Monthly pension",
    });

    const result = processDrawdowns();

    // Should have processed drawdowns for months up to today (2026-02-11):
    // 2025-11-01, 2025-12-01, 2026-01-01, 2026-02-01 = 4 dates
    expect(result.processed).toBe(4);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);

    // Verify transactions were created
    const txList = getCashTransactionsByAccountId(sippAccount.id);
    expect(txList.length).toBe(4);
    // All should be drawdown type
    for (const tx of txList) {
      expect(tx.transaction_type).toBe("drawdown");
      expect(tx.amount).toBe(1200);
    }

    // Verify cash balance was reduced: 100000 - (4 * 1200) = 95200
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(95200);
  });

  test("skips already-processed dates (idempotent)", () => {
    // Run processor again — all 4 drawdowns should be skipped
    const result = processDrawdowns();
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(4);
    expect(result.warnings).toEqual([]);

    // Balance should remain unchanged
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(95200);
  });

  test("skips paused (inactive) schedules", () => {
    // Create a second schedule and immediately pause it
    const schedule = createDrawdownSchedule({
      account_id: sippAccount.id,
      frequency: "monthly",
      trigger_day: 15,
      from_date: "2025-10-01",
      to_date: "2026-04-01",
      amount: 500,
      notes: "Paused schedule",
    });

    updateDrawdownSchedule(schedule.id, {
      frequency: "monthly",
      trigger_day: 15,
      from_date: "2025-10-01",
      to_date: "2026-04-01",
      amount: 500,
      notes: "Paused schedule",
      active: 0,
    });

    const result = processDrawdowns();
    // Only the original schedule's 4 dates should be skipped, nothing new processed
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(4);
  });

  test("processes quarterly schedule correctly", () => {
    createDrawdownSchedule({
      account_id: sippAccount.id,
      frequency: "quarterly",
      trigger_day: 5,
      from_date: "2025-07-01",
      to_date: "2026-06-01",
      amount: 3000,
      notes: "Quarterly drawdown",
    });

    const result = processDrawdowns();

    // Quarterly from July 2025: 2025-07-05, 2025-10-05, 2026-01-05 = 3 dates
    // (2026-04-05 is in the future relative to 2026-02-11)
    // Plus 4 skipped from previous monthly schedule
    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(4);

    // Verify balance: 95200 - (3 * 3000) = 86200
    const account = getAccountById(sippAccount.id);
    expect(account.cash_balance).toBe(86200);
  });

  test("warns but still processes when cash balance goes negative", () => {
    // lowCashSippAccount has £500 cash
    createDrawdownSchedule({
      account_id: lowCashSippAccount.id,
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-06-01",
      amount: 400,
      notes: "Pension that will exhaust cash",
    });

    const result = processDrawdowns();

    // Should process 2026-01-01 and 2026-02-01
    // First: 500 - 400 = 100 (no warning)
    // Second: 100 - 400 = -300 (warning!)
    // Plus skips from other account's schedules
    expect(result.processed).toBe(2);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("Balance will go negative");
    expect(result.warnings[0]).toContain("SIPP-002");

    // Verify balance went negative: 500 - (2 * 400) = -300
    const account = getAccountById(lowCashSippAccount.id);
    expect(account.cash_balance).toBe(-300);
  });

  test("does not duplicate drawdowns that were manually created", () => {
    // Create a new user/account to isolate this test
    const testUser3 = createUser({
      initials: "TC",
      first_name: "Tom",
      last_name: "Collins",
      provider: "ii",
      trading_ref: null,
      isa_ref: null,
      sipp_ref: null,
    });

    const account3 = createAccount({
      user_id: testUser3.id,
      account_type: "sipp",
      account_ref: "SIPP-003",
      cash_balance: 50000,
      warn_cash: 0,
    });

    // Manually create a drawdown transaction for a specific date
    createCashTransaction({
      account_id: account3.id,
      transaction_type: "drawdown",
      transaction_date: "2026-01-01",
      amount: 800,
      notes: "Manually created drawdown",
    });

    // Now create a schedule that would include that same date
    createDrawdownSchedule({
      account_id: account3.id,
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-03-01",
      amount: 800,
      notes: "Auto pension",
    });

    const result = processDrawdowns();

    // 2026-01-01 should be skipped (already exists), 2026-02-01 should be processed
    // (other schedules from previous tests also contribute to skipped count)
    const txList = getCashTransactionsByAccountId(account3.id);
    // Should have 2 transactions: the manual one + the auto one for Feb
    expect(txList.length).toBe(2);
    expect(txList.some((t) => t.transaction_date === "2026-01-01")).toBe(true);
    expect(txList.some((t) => t.transaction_date === "2026-02-01")).toBe(true);
  });
});

describe("previewDrawdowns", () => {
  test("returns preview without modifying the database", () => {
    // Create a fresh schedule on a new account to get predictable results
    const testUser4 = createUser({
      initials: "PD",
      first_name: "Preview",
      last_name: "Test",
      provider: "ii",
      trading_ref: null,
      isa_ref: null,
      sipp_ref: null,
    });

    const previewAccount = createAccount({
      user_id: testUser4.id,
      account_type: "sipp",
      account_ref: "SIPP-PREV",
      cash_balance: 5000,
      warn_cash: 0,
    });

    createDrawdownSchedule({
      account_id: previewAccount.id,
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-04-01",
      amount: 2000,
      notes: "Preview test pension",
    });

    // Capture balance before preview
    const balanceBefore = getAccountById(previewAccount.id).cash_balance;

    const result = previewDrawdowns();

    // Should show items that would be created for this new schedule
    // (2026-01-01 and 2026-02-01, since today is 2026-02-11)
    // Other schedules from earlier tests will also appear in already_exist
    const newItems = result.would_process.filter(function (item) {
      return item.account_id === previewAccount.id;
    });
    expect(newItems.length).toBe(2);
    expect(newItems[0].date).toBe("2026-01-01");
    expect(newItems[0].amount).toBe(2000);
    expect(newItems[0].account_ref).toBe("SIPP-PREV");
    expect(newItems[0].notes).toBe("Preview test pension");
    expect(newItems[1].date).toBe("2026-02-01");

    // Balance should NOT have changed (dry run)
    const balanceAfter = getAccountById(previewAccount.id).cash_balance;
    expect(balanceAfter).toBe(balanceBefore);

    // No transactions should have been created for this account
    const txList = getCashTransactionsByAccountId(previewAccount.id);
    expect(txList.length).toBe(0);

    // total_amount should include amounts from this account's new items
    expect(result.total_amount).toBeGreaterThan(0);
    expect(result.already_exist).toBeGreaterThan(0);
  });

  test("includes warnings when balance would go negative", () => {
    const result = previewDrawdowns();

    // The SIPP-PREV account has £5000 and 2 drawdowns of £2000 each
    // First: 5000 - 2000 = 3000 (ok)
    // Second: 3000 - 2000 = 1000 (ok)
    // No warning for this account, but earlier lowCashSippAccount schedules
    // have already been processed so they appear in already_exist

    // Create a schedule that will definitely trigger a warning
    const testUser5 = createUser({
      initials: "WN",
      first_name: "Warn",
      last_name: "Test",
      provider: "hl",
      trading_ref: null,
      isa_ref: null,
      sipp_ref: null,
    });

    const warnAccount = createAccount({
      user_id: testUser5.id,
      account_type: "sipp",
      account_ref: "SIPP-WARN",
      cash_balance: 100,
      warn_cash: 0,
    });

    createDrawdownSchedule({
      account_id: warnAccount.id,
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-04-01",
      amount: 500,
      notes: "Will go negative",
    });

    const result2 = previewDrawdowns();
    const warnItems = result2.would_process.filter(function (item) {
      return item.account_id === warnAccount.id;
    });

    expect(warnItems.length).toBe(2);
    // First drawdown: 100 < 500, so warning
    expect(warnItems[0].warning).not.toBeNull();
    expect(warnItems[0].warning).toContain("would go negative");
    // Second drawdown: simulated balance is -400, also warning
    expect(warnItems[1].warning).not.toBeNull();

    // Still no DB changes
    const txList = getCashTransactionsByAccountId(warnAccount.id);
    expect(txList.length).toBe(0);
  });
});
