// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-holding-movements-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { createAccount, getAccountById } from "../../src/server/db/accounts-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { getAllCurrencies } from "../../src/server/db/currencies-db.js";
import { createHolding, getHoldingById } from "../../src/server/db/holdings-db.js";
import {
  createBuyMovement,
  createSellMovement,
  getMovementById,
  getMovementsByHoldingId,
  scaleValue,
  unscaleValue,
} from "../../src/server/db/holding-movements-db.js";

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
/** @type {Object} Test account with cash */
let testAccount;
/** @type {Object} Test investment (GBP share) */
let investment1;
/** @type {Object} Test investment (GBP fund) */
let investment2;
/** @type {Object} Holding for investment1 */
let holding1;
/** @type {Object} Holding for investment2 (starts empty, for first-buy test) */
let holding2;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  testUser = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    provider: "ii",
  });

  testAccount = createAccount({
    user_id: testUser.id,
    account_type: "isa",
    account_ref: "5565928",
    cash_balance: 50000,
    warn_cash: 5000,
  });

  const types = getAllInvestmentTypes();
  const currencies = getAllCurrencies();
  const shareType = types.find((t) => t.short_description === "SHARE");
  const fundType = types.find((t) => t.short_description === "MF");
  const gbp = currencies.find((c) => c.code === "GBP");

  investment1 = createInvestment({
    currencies_id: gbp.id,
    investment_type_id: shareType.id,
    description: "Raspberry Pi Holdings",
    public_id: "LSE:RPI",
  });

  investment2 = createInvestment({
    currencies_id: gbp.id,
    investment_type_id: (fundType || shareType).id,
    description: "Stewart Inv APAC Leaders B GBP Acc",
    public_id: "GB0033874768",
  });

  // Holding1: existing position (100 shares at avg cost 5.00)
  holding1 = createHolding({
    account_id: testAccount.id,
    investment_id: investment1.id,
    quantity: 100,
    average_cost: 5.0,
  });

  // Holding2: starts at zero (for first-buy scenario)
  holding2 = createHolding({
    account_id: testAccount.id,
    investment_id: investment2.id,
    quantity: 0,
    average_cost: 0,
  });
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Scaling helpers ---

describe("scaleValue / unscaleValue", () => {
  test("scales a decimal value to integer x10000", () => {
    expect(scaleValue(150.25)).toBe(1502500);
    expect(scaleValue(0)).toBe(0);
    expect(scaleValue(1000)).toBe(10000000);
  });

  test("unscales an integer back to decimal", () => {
    expect(unscaleValue(1502500)).toBe(150.25);
    expect(unscaleValue(0)).toBe(0);
  });
});

// --- Buy movements ---

describe("createBuyMovement", () => {
  test("creates a buy movement and updates holding and account", () => {
    const movement = createBuyMovement({
      holding_id: holding1.id,
      movement_date: "2026-02-10",
      quantity: 50,
      total_consideration: 300,
      deductible_costs: 10,
      notes: "Bought 50 shares",
    });

    expect(movement).not.toBeNull();
    expect(movement.id).toBeGreaterThan(0);
    expect(movement.holding_id).toBe(holding1.id);
    expect(movement.movement_type).toBe("buy");
    expect(movement.movement_date).toBe("2026-02-10");
    expect(movement.quantity).toBe(50);
    expect(movement.movement_value).toBe(300);
    expect(movement.deductible_costs).toBe(10);
    expect(movement.notes).toBe("Bought 50 shares");

    // Book cost = total_consideration - deductible_costs = 300 - 10 = 290
    expect(movement.book_cost).toBe(290);

    // Holding should be updated: qty = 100 + 50 = 150
    const updatedHolding = getHoldingById(holding1.id);
    expect(updatedHolding.quantity).toBe(150);

    // Average cost = (100*5 + 290) / 150 = 790/150 = 5.2667
    expect(updatedHolding.average_cost).toBeCloseTo(5.2667, 3);

    // Account cash should be reduced by total_consideration: 50000 - 300 = 49700
    const updatedAccount = getAccountById(testAccount.id);
    expect(updatedAccount.cash_balance).toBe(49700);
  });

  test("buy with zero deductible costs", () => {
    const movement = createBuyMovement({
      holding_id: holding1.id,
      movement_date: "2026-02-11",
      quantity: 50,
      total_consideration: 350,
      deductible_costs: 0,
    });

    expect(movement.book_cost).toBe(350);
    expect(movement.deductible_costs).toBe(0);

    // Holding qty: 150 + 50 = 200
    const updatedHolding = getHoldingById(holding1.id);
    expect(updatedHolding.quantity).toBe(200);

    // Avg cost: (150 * 5.2667 + 350) / 200
    // = (790.005 + 350) / 200 = 1140.005 / 200 = 5.7000
    // (slight rounding from previous step)
    expect(updatedHolding.average_cost).toBeCloseTo(5.7, 1);
  });

  test("buy into zero-quantity holding (first buy)", () => {
    const movement = createBuyMovement({
      holding_id: holding2.id,
      movement_date: "2026-02-10",
      quantity: 1634.969,
      total_consideration: 7800,
      deductible_costs: 0,
    });

    expect(movement.quantity).toBeCloseTo(1634.969, 3);
    expect(movement.book_cost).toBe(7800);

    const updatedHolding = getHoldingById(holding2.id);
    expect(updatedHolding.quantity).toBeCloseTo(1634.969, 3);
    // Avg cost = 7800 / 1634.969 = 4.7707
    expect(updatedHolding.average_cost).toBeCloseTo(4.7707, 3);
  });

  test("fails if total consideration exceeds cash balance", () => {
    // Get current cash balance
    const account = getAccountById(testAccount.id);

    expect(() => {
      createBuyMovement({
        holding_id: holding1.id,
        movement_date: "2026-02-11",
        quantity: 100,
        total_consideration: account.cash_balance + 1,
      });
    }).toThrow("Insufficient cash balance");
  });

  test("fails if holding not found", () => {
    expect(() => {
      createBuyMovement({
        holding_id: 99999,
        movement_date: "2026-02-11",
        quantity: 10,
        total_consideration: 100,
      });
    }).toThrow("Holding not found");
  });

  test("deductible costs are stored in the movement record", () => {
    const movements = getMovementsByHoldingId(holding1.id);
    const firstBuy = movements.find((m) => m.notes === "Bought 50 shares");
    expect(firstBuy).not.toBeNull();
    expect(firstBuy.deductible_costs).toBe(10);
  });
});

// --- Sell movements ---

describe("createSellMovement", () => {
  test("creates a sell movement, reduces quantity, adds cash (avg cost unchanged)", () => {
    // Record pre-sell state
    const preSellHolding = getHoldingById(holding1.id);
    const preSellAccount = getAccountById(testAccount.id);
    const preSellAvgCost = preSellHolding.average_cost;

    const movement = createSellMovement({
      holding_id: holding1.id,
      movement_date: "2026-02-11",
      quantity: 30,
      total_consideration: 200,
      deductible_costs: 5.50,
      notes: "Sold 30 shares",
    });

    expect(movement).not.toBeNull();
    expect(movement.movement_type).toBe("sell");
    expect(movement.quantity).toBe(30);
    expect(movement.movement_value).toBe(200);
    expect(movement.deductible_costs).toBe(5.5);
    expect(movement.notes).toBe("Sold 30 shares");

    // Book cost = sell qty x avg cost = 30 * preSellAvgCost
    expect(movement.book_cost).toBeCloseTo(30 * preSellAvgCost, 2);

    // Holding quantity reduced: pre - 30
    const updatedHolding = getHoldingById(holding1.id);
    expect(updatedHolding.quantity).toBe(preSellHolding.quantity - 30);

    // Average cost must NOT change on a sell
    expect(updatedHolding.average_cost).toBeCloseTo(preSellAvgCost, 4);

    // Account cash increased by total_consideration
    const updatedAccount = getAccountById(testAccount.id);
    expect(updatedAccount.cash_balance).toBe(preSellAccount.cash_balance + 200);
  });

  test("sell with zero deductible costs", () => {
    const preSellHolding = getHoldingById(holding1.id);

    const movement = createSellMovement({
      holding_id: holding1.id,
      movement_date: "2026-02-11",
      quantity: 20,
      total_consideration: 150,
      deductible_costs: 0,
    });

    expect(movement.deductible_costs).toBe(0);

    const updatedHolding = getHoldingById(holding1.id);
    expect(updatedHolding.quantity).toBe(preSellHolding.quantity - 20);
  });

  test("fails if sell quantity exceeds holding quantity", () => {
    const holding = getHoldingById(holding1.id);

    expect(() => {
      createSellMovement({
        holding_id: holding1.id,
        movement_date: "2026-02-11",
        quantity: holding.quantity + 1,
        total_consideration: 1000,
      });
    }).toThrow("Insufficient holding quantity");
  });

  test("full quantity sell leaves holding with qty=0 (no divide-by-zero)", () => {
    const holding = getHoldingById(holding1.id);
    const currentQty = holding.quantity;
    const currentAvgCost = holding.average_cost;

    const movement = createSellMovement({
      holding_id: holding1.id,
      movement_date: "2026-02-11",
      quantity: currentQty,
      total_consideration: currentQty * 6,
    });

    expect(movement).not.toBeNull();
    expect(movement.book_cost).toBeCloseTo(currentQty * currentAvgCost, 2);

    // Holding should have zero quantity
    const updatedHolding = getHoldingById(holding1.id);
    expect(updatedHolding.quantity).toBe(0);
    // Average cost is preserved (not zeroed out)
    expect(updatedHolding.average_cost).toBeCloseTo(currentAvgCost, 4);
  });

  test("fails if holding not found", () => {
    expect(() => {
      createSellMovement({
        holding_id: 99999,
        movement_date: "2026-02-11",
        quantity: 10,
        total_consideration: 100,
      });
    }).toThrow("Holding not found");
  });
});

// --- Get movements ---

describe("getMovementsByHoldingId", () => {
  test("returns movements ordered by date desc, id desc", () => {
    const movements = getMovementsByHoldingId(holding1.id);
    expect(movements.length).toBeGreaterThan(0);

    // Check ordering: newest first
    for (let i = 0; i < movements.length - 1; i++) {
      const a = movements[i];
      const b = movements[i + 1];
      if (a.movement_date === b.movement_date) {
        expect(a.id).toBeGreaterThan(b.id);
      } else {
        expect(a.movement_date >= b.movement_date).toBe(true);
      }
    }
  });

  test("respects the limit parameter", () => {
    const movements = getMovementsByHoldingId(holding1.id, 2);
    expect(movements.length).toBeLessThanOrEqual(2);
  });

  test("returns empty array for holding with no movements", () => {
    // Create a fresh holding with no movements
    const freshAccount = createAccount({
      user_id: testUser.id,
      account_type: "trading",
      account_ref: "TRADE1",
      cash_balance: 10000,
    });
    const freshHolding = createHolding({
      account_id: freshAccount.id,
      investment_id: investment1.id,
      quantity: 100,
      average_cost: 2.0,
    });

    const movements = getMovementsByHoldingId(freshHolding.id);
    expect(movements).toEqual([]);
  });
});

describe("getMovementById", () => {
  test("returns a specific movement with all fields", () => {
    const movements = getMovementsByHoldingId(holding1.id);
    const first = movements[0];
    const fetched = getMovementById(first.id);

    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(first.id);
    expect(fetched.holding_id).toBe(first.holding_id);
    expect(fetched.movement_type).toBe(first.movement_type);
    expect(fetched.movement_date).toBe(first.movement_date);
    expect(fetched.quantity).toBe(first.quantity);
    expect(fetched.movement_value).toBe(first.movement_value);
    expect(fetched.book_cost).toBe(first.book_cost);
    expect(fetched.deductible_costs).toBe(first.deductible_costs);
  });

  test("returns null for non-existent ID", () => {
    const result = getMovementById(99999);
    expect(result).toBeNull();
  });
});
