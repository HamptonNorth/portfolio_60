// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-drawdown-schedules-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { createAccount } from "../../src/server/db/accounts-db.js";
import {
  createDrawdownSchedule,
  updateDrawdownSchedule,
  deleteDrawdownSchedule,
  getDrawdownScheduleById,
  getDrawdownSchedulesByAccountId,
  getActiveDrawdownSchedules,
  getDueDrawdownDates,
  scaleAmount,
  unscaleAmount,
} from "../../src/server/db/drawdown-schedules-db.js";

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
/** @type {Object} Second SIPP account (different user) */
let sippAccount2;

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
    cash_balance: 50000,
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

  sippAccount2 = createAccount({
    user_id: testUser2.id,
    account_type: "sipp",
    account_ref: "SIPP-002",
    cash_balance: 30000,
    warn_cash: 3000,
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scaling helpers ---

describe("scaleAmount / unscaleAmount", () => {
  test("scales a decimal value to integer x10000", () => {
    expect(scaleAmount(1200)).toBe(12000000);
    expect(scaleAmount(0)).toBe(0);
    expect(scaleAmount(99.99)).toBe(999900);
  });

  test("unscales an integer back to decimal", () => {
    expect(unscaleAmount(12000000)).toBe(1200);
    expect(unscaleAmount(0)).toBe(0);
    expect(unscaleAmount(999900)).toBe(99.99);
  });
});

// --- Create drawdown schedule ---

describe("createDrawdownSchedule", () => {
  test("creates a monthly schedule with normalised dates", () => {
    const schedule = createDrawdownSchedule({
      account_id: sippAccount.id,
      frequency: "monthly",
      trigger_day: 15,
      from_date: "2026-04-15",
      to_date: "2027-03-20",
      amount: 1200,
      notes: "Monthly pension",
    });

    expect(schedule).not.toBeNull();
    expect(schedule.id).toBeGreaterThan(0);
    expect(schedule.account_id).toBe(sippAccount.id);
    expect(schedule.frequency).toBe("monthly");
    expect(schedule.trigger_day).toBe(15);
    // Dates normalised to first of month
    expect(schedule.from_date).toBe("2026-04-01");
    expect(schedule.to_date).toBe("2027-03-01");
    expect(schedule.amount).toBe(1200);
    expect(schedule.amount_scaled).toBe(12000000);
    expect(schedule.notes).toBe("Monthly pension");
    expect(schedule.active).toBe(1);
  });

  test("creates a quarterly schedule", () => {
    const schedule = createDrawdownSchedule({
      account_id: sippAccount.id,
      frequency: "quarterly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-12-01",
      amount: 3600,
    });

    expect(schedule).not.toBeNull();
    expect(schedule.frequency).toBe("quarterly");
    expect(schedule.notes).toBeNull();
  });

  test("creates a schedule for a different account", () => {
    const schedule = createDrawdownSchedule({
      account_id: sippAccount2.id,
      frequency: "annually",
      trigger_day: 5,
      from_date: "2026-06-01",
      to_date: "2030-06-01",
      amount: 15000,
      notes: "Annual lump sum",
    });

    expect(schedule).not.toBeNull();
    expect(schedule.account_id).toBe(sippAccount2.id);
    expect(schedule.frequency).toBe("annually");
  });

  test("throws on invalid frequency", () => {
    expect(() => {
      createDrawdownSchedule({
        account_id: sippAccount.id,
        frequency: "weekly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      });
    }).toThrow();
  });

  test("throws on trigger_day out of range", () => {
    expect(() => {
      createDrawdownSchedule({
        account_id: sippAccount.id,
        frequency: "monthly",
        trigger_day: 29,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      });
    }).toThrow();
  });

  test("throws on invalid account_id FK", () => {
    expect(() => {
      createDrawdownSchedule({
        account_id: 9999,
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      });
    }).toThrow();
  });
});

// --- Read drawdown schedules ---

describe("getDrawdownScheduleById", () => {
  test("returns the correct schedule with unscaled amount", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    const schedule = getDrawdownScheduleById(schedules[0].id);

    expect(schedule).not.toBeNull();
    expect(schedule.id).toBe(schedules[0].id);
    expect(schedule.account_id).toBe(sippAccount.id);
  });

  test("returns null for non-existent ID", () => {
    const schedule = getDrawdownScheduleById(9999);
    expect(schedule).toBeNull();
  });
});

describe("getDrawdownSchedulesByAccountId", () => {
  test("returns schedules ordered by from_date", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    expect(schedules.length).toBe(2);
    // Quarterly (2026-01-01) first, then monthly (2026-04-01)
    expect(schedules[0].frequency).toBe("quarterly");
    expect(schedules[1].frequency).toBe("monthly");
  });

  test("returns empty array for account with no schedules", () => {
    // Create a trading account (no schedules)
    const tradingAccount = createAccount({
      user_id: testUser.id,
      account_type: "trading",
      account_ref: "TRADE-001",
      cash_balance: 0,
      warn_cash: 0,
    });
    const schedules = getDrawdownSchedulesByAccountId(tradingAccount.id);
    expect(schedules).toEqual([]);
  });
});

describe("getActiveDrawdownSchedules", () => {
  test("returns all active schedules across all accounts", () => {
    const active = getActiveDrawdownSchedules();
    // 2 for sippAccount + 1 for sippAccount2 = 3
    expect(active.length).toBe(3);
  });
});

// --- Update drawdown schedule ---

describe("updateDrawdownSchedule", () => {
  test("updates schedule fields and returns the updated schedule", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    const monthly = schedules.find((s) => s.frequency === "monthly");

    const updated = updateDrawdownSchedule(monthly.id, {
      frequency: "monthly",
      trigger_day: 20,
      from_date: "2026-05-01",
      to_date: "2027-04-01",
      amount: 1500,
      notes: "Updated pension amount",
      active: 1,
    });

    expect(updated).not.toBeNull();
    expect(updated.trigger_day).toBe(20);
    expect(updated.from_date).toBe("2026-05-01");
    expect(updated.to_date).toBe("2027-04-01");
    expect(updated.amount).toBe(1500);
    expect(updated.notes).toBe("Updated pension amount");
  });

  test("can pause a schedule by setting active to 0", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    const quarterly = schedules.find((s) => s.frequency === "quarterly");

    const updated = updateDrawdownSchedule(quarterly.id, {
      frequency: quarterly.frequency,
      trigger_day: quarterly.trigger_day,
      from_date: quarterly.from_date,
      to_date: quarterly.to_date,
      amount: quarterly.amount,
      notes: quarterly.notes,
      active: 0,
    });

    expect(updated.active).toBe(0);

    // Active schedules should now be 2 (monthly for sippAccount + annual for sippAccount2)
    const active = getActiveDrawdownSchedules();
    expect(active.length).toBe(2);
  });

  test("returns null for non-existent ID", () => {
    const result = updateDrawdownSchedule(9999, {
      frequency: "monthly",
      trigger_day: 1,
      from_date: "2026-01-01",
      to_date: "2026-12-01",
      amount: 100,
    });
    expect(result).toBeNull();
  });
});

// --- Delete drawdown schedule ---

describe("deleteDrawdownSchedule", () => {
  test("deletes a schedule and returns true", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    const quarterly = schedules.find((s) => s.frequency === "quarterly");

    const result = deleteDrawdownSchedule(quarterly.id);
    expect(result).toBe(true);

    const deleted = getDrawdownScheduleById(quarterly.id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteDrawdownSchedule(9999);
    expect(result).toBe(false);
  });

  test("remaining schedules still exist", () => {
    const schedules = getDrawdownSchedulesByAccountId(sippAccount.id);
    expect(schedules.length).toBe(1);
    expect(schedules[0].frequency).toBe("monthly");
  });
});

// --- getDueDrawdownDates ---

describe("getDueDrawdownDates", () => {
  test("returns monthly trigger dates within range", () => {
    const schedule = {
      from_date: "2026-01-01",
      to_date: "2026-06-01",
      frequency: "monthly",
      trigger_day: 15,
    };

    const dates = getDueDrawdownDates(schedule, "2026-12-31");
    expect(dates).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
    ]);
  });

  test("stops at upToDate for monthly", () => {
    const schedule = {
      from_date: "2026-01-01",
      to_date: "2026-12-01",
      frequency: "monthly",
      trigger_day: 10,
    };

    const dates = getDueDrawdownDates(schedule, "2026-03-15");
    expect(dates).toEqual([
      "2026-01-10",
      "2026-02-10",
      "2026-03-10",
    ]);
  });

  test("returns quarterly trigger dates", () => {
    const schedule = {
      from_date: "2026-01-01",
      to_date: "2026-12-01",
      frequency: "quarterly",
      trigger_day: 1,
    };

    const dates = getDueDrawdownDates(schedule, "2026-12-31");
    expect(dates).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
  });

  test("returns annually trigger dates", () => {
    const schedule = {
      from_date: "2026-06-01",
      to_date: "2030-06-01",
      frequency: "annually",
      trigger_day: 5,
    };

    const dates = getDueDrawdownDates(schedule, "2028-12-31");
    expect(dates).toEqual([
      "2026-06-05",
      "2027-06-05",
      "2028-06-05",
    ]);
  });

  test("returns empty array when upToDate is before first trigger", () => {
    const schedule = {
      from_date: "2026-06-01",
      to_date: "2026-12-01",
      frequency: "monthly",
      trigger_day: 15,
    };

    const dates = getDueDrawdownDates(schedule, "2026-05-31");
    expect(dates).toEqual([]);
  });

  test("handles year boundary for monthly", () => {
    const schedule = {
      from_date: "2026-11-01",
      to_date: "2027-02-01",
      frequency: "monthly",
      trigger_day: 28,
    };

    const dates = getDueDrawdownDates(schedule, "2027-12-31");
    expect(dates).toEqual([
      "2026-11-28",
      "2026-12-28",
      "2027-01-28",
      "2027-02-28",
    ]);
  });

  test("handles year boundary for quarterly", () => {
    const schedule = {
      from_date: "2026-10-01",
      to_date: "2027-06-01",
      frequency: "quarterly",
      trigger_day: 1,
    };

    const dates = getDueDrawdownDates(schedule, "2027-12-31");
    expect(dates).toEqual([
      "2026-10-01",
      "2027-01-01",
      "2027-04-01",
    ]);
  });
});
