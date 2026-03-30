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
import { createHolding, getHoldingById, getActiveHoldingRaw, getHoldingsByAccountId } from "../../src/server/db/holdings-db.js";
import { createBuyMovement, createSellMovement, createSplitMovement, createReplacementMovement, getMovementById, getMovementsByHoldingId, scaleValue, unscaleValue } from "../../src/server/db/holding-movements-db.js";
import { getCashTransactionsByAccountId } from "../../src/server/db/cash-transactions-db.js";
import { upsertPrice, getPricesInRange, getLatestPrice } from "../../src/server/db/prices-db.js";
import { getInvestmentById, getManuallyPricedInvestments } from "../../src/server/db/investments-db.js";

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

/**
 * @description Helper to get the current active holding for investment1.
 * After SCD2 operations the holding ID changes, so we look it up by account+investment.
 * @returns {Object} The active holding (raw/scaled)
 */
function getActiveHolding1() {
  return getActiveHoldingRaw(testAccount.id, investment1.id);
}

/**
 * @description Helper to get the current active holding for investment2.
 * @returns {Object} The active holding (raw/scaled)
 */
function getActiveHolding2() {
  return getActiveHoldingRaw(testAccount.id, investment2.id);
}

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
  test("creates a buy movement and updates holding (same-day = in-place update)", () => {
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

    // Same-day: holding updated in place (same ID, still active)
    const activeHolding = getActiveHolding1();
    expect(activeHolding).not.toBeNull();
    expect(activeHolding.id).toBe(holding1.id);
    const updatedHolding = getHoldingById(activeHolding.id);
    expect(updatedHolding.quantity).toBe(150);
    expect(updatedHolding.effective_to).toBeNull();

    // Average cost = (100*5 + 290) / 150 = 790/150 = 5.2667
    expect(updatedHolding.average_cost).toBeCloseTo(5.2667, 3);

    // Account cash should be reduced by total_consideration: 50000 - 300 = 49700
    const updatedAccount = getAccountById(testAccount.id);
    expect(updatedAccount.cash_balance).toBe(49700);

    // Update holding1 reference for subsequent tests
    holding1 = updatedHolding;
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

    // New active holding qty: 150 + 50 = 200
    const activeHolding = getActiveHolding1();
    const updatedHolding = getHoldingById(activeHolding.id);
    expect(updatedHolding.quantity).toBe(200);

    // Avg cost: (150 * 5.2667 + 350) / 200
    expect(updatedHolding.average_cost).toBeCloseTo(5.7, 1);

    holding1 = updatedHolding;
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

    const activeHolding = getActiveHolding2();
    const updatedHolding = getHoldingById(activeHolding.id);
    expect(updatedHolding.quantity).toBeCloseTo(1634.969, 3);
    // Avg cost = 7800 / 1634.969 = 4.7707
    expect(updatedHolding.average_cost).toBeCloseTo(4.7707, 3);

    holding2 = updatedHolding;
  });

  test("fails if total consideration exceeds cash balance", () => {
    const activeHolding = getActiveHolding1();
    const account = getAccountById(testAccount.id);

    expect(() => {
      createBuyMovement({
        holding_id: activeHolding.id,
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
    const activeHolding = getActiveHolding1();
    const movements = getMovementsByHoldingId(activeHolding.id);
    const firstBuy = movements.find((m) => m.notes === "Bought 50 shares");
    expect(firstBuy).not.toBeNull();
    expect(firstBuy.deductible_costs).toBe(10);
  });
});

// --- Sell movements ---

describe("createSellMovement", () => {
  test("creates a sell movement, reduces quantity, adds cash (avg cost unchanged)", () => {
    // Record pre-sell state
    const activeHolding = getActiveHolding1();
    const preSellHolding = getHoldingById(activeHolding.id);
    const preSellAccount = getAccountById(testAccount.id);
    const preSellAvgCost = preSellHolding.average_cost;

    const movement = createSellMovement({
      holding_id: activeHolding.id,
      movement_date: "2026-02-11",
      quantity: 30,
      total_consideration: 200,
      deductible_costs: 5.5,
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

    // New active holding should have reduced quantity
    const newActive = getActiveHolding1();
    const updatedHolding = getHoldingById(newActive.id);
    expect(updatedHolding.quantity).toBe(preSellHolding.quantity - 30);

    // Average cost must NOT change on a sell
    expect(updatedHolding.average_cost).toBeCloseTo(preSellAvgCost, 4);

    // Account cash increased by net proceeds (total_consideration - deductible_costs)
    const updatedAccount = getAccountById(testAccount.id);
    expect(updatedAccount.cash_balance).toBe(preSellAccount.cash_balance + 200 - 5.5);

    holding1 = updatedHolding;
  });

  test("sell with zero deductible costs", () => {
    const activeHolding = getActiveHolding1();
    const preSellHolding = getHoldingById(activeHolding.id);

    const movement = createSellMovement({
      holding_id: activeHolding.id,
      movement_date: "2026-02-11",
      quantity: 20,
      total_consideration: 150,
      deductible_costs: 0,
    });

    expect(movement.deductible_costs).toBe(0);

    const newActive = getActiveHolding1();
    const updatedHolding = getHoldingById(newActive.id);
    expect(updatedHolding.quantity).toBe(preSellHolding.quantity - 20);

    holding1 = updatedHolding;
  });

  test("fails if sell quantity exceeds holding quantity", () => {
    const activeHolding = getActiveHolding1();
    const holding = getHoldingById(activeHolding.id);

    expect(() => {
      createSellMovement({
        holding_id: activeHolding.id,
        movement_date: "2026-02-11",
        quantity: holding.quantity + 1,
        total_consideration: 1000,
      });
    }).toThrow("Insufficient holding quantity");
  });

  test("full quantity sell closes holding with no new row", () => {
    const activeHolding = getActiveHolding1();
    const holding = getHoldingById(activeHolding.id);
    const currentQty = holding.quantity;
    const currentAvgCost = holding.average_cost;

    const movement = createSellMovement({
      holding_id: activeHolding.id,
      movement_date: "2026-02-11",
      quantity: currentQty,
      total_consideration: currentQty * 6,
    });

    expect(movement).not.toBeNull();
    expect(movement.book_cost).toBeCloseTo(currentQty * currentAvgCost, 2);

    // No active holding should remain for this investment
    const newActive = getActiveHolding1();
    expect(newActive).toBeNull();

    // Old holding should be closed
    const oldHolding = getHoldingById(activeHolding.id);
    expect(oldHolding.effective_to).not.toBeNull();
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

// --- Cash transaction auto-creation ---

describe("buy/sell movements create matching cash_transactions", () => {
  /** @type {Object} Fresh account for isolated cash transaction tests */
  let cashTestAccount;
  /** @type {Object} Fresh holding for testing */
  let cashTestHolding;

  beforeAll(() => {
    cashTestAccount = createAccount({
      user_id: testUser.id,
      account_type: "sipp",
      account_ref: "SIPP001",
      cash_balance: 20000,
      warn_cash: 1000,
    });
    cashTestHolding = createHolding({
      account_id: cashTestAccount.id,
      investment_id: investment1.id,
      quantity: 500,
      average_cost: 3.0,
    });
  });

  /** @description Helper to get the current active holding for this test group */
  function getActiveCashTestHolding() {
    const raw = getActiveHoldingRaw(cashTestAccount.id, investment1.id);
    return raw ? getHoldingById(raw.id) : null;
  }

  test("buy movement creates a cash_transaction with type 'buy'", () => {
    const preTx = getCashTransactionsByAccountId(cashTestAccount.id);
    const active = getActiveCashTestHolding();

    createBuyMovement({
      holding_id: active.id,
      movement_date: "2026-02-12",
      quantity: 10,
      total_consideration: 60,
      deductible_costs: 0,
      notes: "Test buy note",
    });

    const postTx = getCashTransactionsByAccountId(cashTestAccount.id);
    expect(postTx.length).toBe(preTx.length + 1);

    const buyTx = postTx.find((t) => t.transaction_type === "buy");
    expect(buyTx).not.toBeNull();
    expect(buyTx.amount).toBe(60);
    expect(buyTx.transaction_date).toBe("2026-02-12");
    expect(buyTx.holding_movement_id).toBeGreaterThan(0);
    expect(buyTx.notes).toContain("Buy: Raspberry Pi Holdings");
    expect(buyTx.notes).toContain("Test buy note");
  });

  test("sell movement creates a cash_transaction with type 'sell'", () => {
    const preTx = getCashTransactionsByAccountId(cashTestAccount.id);
    const active = getActiveCashTestHolding();

    createSellMovement({
      holding_id: active.id,
      movement_date: "2026-02-12",
      quantity: 5,
      total_consideration: 40,
      deductible_costs: 0,
      notes: "Test sell note",
    });

    const postTx = getCashTransactionsByAccountId(cashTestAccount.id);
    expect(postTx.length).toBe(preTx.length + 1);

    const sellTx = postTx.find((t) => t.transaction_type === "sell" && t.notes.includes("Test sell note"));
    expect(sellTx).not.toBeNull();
    expect(sellTx.amount).toBe(40);
    expect(sellTx.transaction_date).toBe("2026-02-12");
    expect(sellTx.holding_movement_id).toBeGreaterThan(0);
    expect(sellTx.notes).toContain("Sell: Raspberry Pi Holdings");
  });

  test("buy cash_transaction does not double-deduct from account balance", () => {
    const preAccount = getAccountById(cashTestAccount.id);
    const active = getActiveCashTestHolding();

    createBuyMovement({
      holding_id: active.id,
      movement_date: "2026-02-13",
      quantity: 10,
      total_consideration: 50,
      deductible_costs: 0,
    });

    const postAccount = getAccountById(cashTestAccount.id);
    // Balance should decrease by exactly 50, not 100 (double deduction)
    expect(postAccount.cash_balance).toBe(preAccount.cash_balance - 50);
  });

  test("cash_transaction notes without user notes omits separator", () => {
    const preCount = getCashTransactionsByAccountId(cashTestAccount.id).length;
    const active = getActiveCashTestHolding();

    createBuyMovement({
      holding_id: active.id,
      movement_date: "2026-02-13",
      quantity: 5,
      total_consideration: 25,
      deductible_costs: 0,
    });

    const txList = getCashTransactionsByAccountId(cashTestAccount.id);
    expect(txList.length).toBe(preCount + 1);
    const buyTx = txList.find((t) => t.transaction_type === "buy" && t.amount === 25);
    expect(buyTx).toBeDefined();
    expect(buyTx.notes).toBe("Buy: Raspberry Pi Holdings");
    expect(buyTx.notes).not.toContain("—");
  });
});

describe("getMovementsByHoldingId (SCD2-aware)", () => {
  test("returns movements across all SCD2 rows for the same investment", () => {
    // investment2 has had movements — get any holding ID for it
    const active = getActiveHolding2();
    if (active) {
      const movements = getMovementsByHoldingId(active.id);
      expect(movements.length).toBeGreaterThan(0);
    }
  });

  test("respects the limit parameter", () => {
    const active = getActiveHolding2();
    if (active) {
      const movements = getMovementsByHoldingId(active.id, 1);
      expect(movements.length).toBeLessThanOrEqual(1);
    }
  });

  test("returns empty array for holding with no movements", () => {
    // Create a fresh holding with no movements
    const freshUser = createUser({
      initials: "FH",
      first_name: "Fresh",
      last_name: "Holder",
      provider: "ii",
    });
    const freshAccount = createAccount({
      user_id: freshUser.id,
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
    const active = getActiveHolding2();
    const movements = getMovementsByHoldingId(active.id);
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

// --- Stock Split (adjustment) movements ---

describe("createSplitMovement", () => {
  /** @type {Object} Fresh account for isolated split tests */
  let splitAccount;
  /** @type {Object} Holding for split testing */
  let splitHolding;
  /** @type {Object} Separate user for split tests */
  let splitUser;
  /** @type {Object} Investment for split tests */
  let splitInvestment;

  /** @description Helper to get the active holding for split tests */
  function getActiveSplitHolding() {
    const raw = getActiveHoldingRaw(splitAccount.id, splitInvestment.id);
    return raw ? getHoldingById(raw.id) : null;
  }

  beforeAll(() => {
    splitUser = createUser({
      initials: "SP",
      first_name: "Split",
      last_name: "Tester",
      provider: "ii",
    });
    splitAccount = createAccount({
      user_id: splitUser.id,
      account_type: "trading",
      account_ref: "SPLIT01",
      cash_balance: 10000,
      warn_cash: 500,
    });

    // Use investment1 for split tests
    splitInvestment = investment1;

    splitHolding = createHolding({
      account_id: splitAccount.id,
      investment_id: splitInvestment.id,
      quantity: 35,
      average_cost: 248.0,
    });
  });

  test("forward split: quantity increases, avg cost decreases, book cost constant", () => {
    const active = getActiveSplitHolding();
    const preSplitBookCost = active.quantity * active.average_cost;
    const preSplitAccount = getAccountById(splitAccount.id);

    const movement = createSplitMovement({
      holding_id: active.id,
      movement_date: "2026-01-15",
      new_quantity: 3500,
      notes: "Stock split 1:100",
    });

    expect(movement).not.toBeNull();
    expect(movement.movement_type).toBe("adjustment");
    expect(movement.movement_date).toBe("2026-01-15");
    expect(movement.quantity).toBe(3500);
    expect(movement.movement_value).toBe(0);
    expect(movement.notes).toBe("Stock split 1:100");

    // Holding updated (new SCD2 row)
    const updatedHolding = getActiveSplitHolding();
    expect(updatedHolding.quantity).toBe(3500);
    expect(updatedHolding.average_cost).toBeCloseTo(2.48, 2);

    // Book cost remains constant
    const postSplitBookCost = updatedHolding.quantity * updatedHolding.average_cost;
    expect(postSplitBookCost).toBeCloseTo(preSplitBookCost, 1);

    // revised_avg_cost in the movement record
    expect(movement.revised_avg_cost).toBeCloseTo(2.48, 2);

    // Cash balance must NOT change
    const postSplitAccount = getAccountById(splitAccount.id);
    expect(postSplitAccount.cash_balance).toBe(preSplitAccount.cash_balance);
  });

  test("reverse split: quantity decreases, avg cost increases, book cost constant", () => {
    const active = getActiveSplitHolding();
    const preSplitBookCost = active.quantity * active.average_cost;

    const movement = createSplitMovement({
      holding_id: active.id,
      movement_date: "2026-02-01",
      new_quantity: 350,
      notes: "Reverse split 10:1",
    });

    expect(movement.movement_type).toBe("adjustment");
    expect(movement.quantity).toBe(350);

    const updatedHolding = getActiveSplitHolding();
    expect(updatedHolding.quantity).toBe(350);
    expect(updatedHolding.average_cost).toBeCloseTo(24.8, 1);

    // Book cost constant
    const postSplitBookCost = updatedHolding.quantity * updatedHolding.average_cost;
    expect(postSplitBookCost).toBeCloseTo(preSplitBookCost, 1);
  });

  test("split does not create a cash_transaction", () => {
    const preTx = getCashTransactionsByAccountId(splitAccount.id);
    const active = getActiveSplitHolding();

    createSplitMovement({
      holding_id: active.id,
      movement_date: "2026-02-02",
      new_quantity: 700,
    });

    const postTx = getCashTransactionsByAccountId(splitAccount.id);
    expect(postTx.length).toBe(preTx.length);
  });

  test("fails if new quantity is zero", () => {
    const active = getActiveSplitHolding();
    expect(() => {
      createSplitMovement({
        holding_id: active.id,
        movement_date: "2026-02-03",
        new_quantity: 0,
      });
    }).toThrow("New quantity must be greater than zero");
  });

  test("fails if new quantity is negative", () => {
    const active = getActiveSplitHolding();
    expect(() => {
      createSplitMovement({
        holding_id: active.id,
        movement_date: "2026-02-03",
        new_quantity: -10,
      });
    }).toThrow("New quantity must be greater than zero");
  });

  test("fails if new quantity equals current quantity", () => {
    const active = getActiveSplitHolding();

    expect(() => {
      createSplitMovement({
        holding_id: active.id,
        movement_date: "2026-02-03",
        new_quantity: active.quantity,
      });
    }).toThrow("New quantity is the same as the current quantity");
  });

  test("fails if holding not found", () => {
    expect(() => {
      createSplitMovement({
        holding_id: 99999,
        movement_date: "2026-02-03",
        new_quantity: 100,
      });
    }).toThrow("Holding not found");
  });

  test("notes are optional (defaults to null)", () => {
    const active = getActiveSplitHolding();

    const movement = createSplitMovement({
      holding_id: active.id,
      movement_date: "2026-02-04",
      new_quantity: 1400,
    });

    expect(movement.notes).toBeNull();
  });
});

// ─── Replacement (Corporate Action) ────────────────────────────────────────────

describe("Replacement movements", () => {
  /** @type {Object} Replacement investment */
  let replacementInvestment;
  /** @type {Object} Holding to be replaced */
  let replacementHolding;

  /**
   * @description Set up a fresh holding and replacement investment for each test.
   * Also seeds price history on the original investment for prorating tests.
   */
  function setupReplacementScenario() {
    const types = getAllInvestmentTypes();
    const currencies = getAllCurrencies();
    const shareType = types.find((t) => t.short_description === "SHARE");
    const fundType = types.find((t) => t.short_description === "MF");
    const gbp = currencies.find((c) => c.code === "GBP");

    // Create the "old" investment with some price history
    const oldInvestment = createInvestment({
      currencies_id: gbp.id,
      investment_type_id: shareType.id,
      description: "Smithson Inv Trust Ord " + Date.now(),
      public_id: "LSE:SSON",
    });

    // Seed price history for the old investment (priceMinorUnit = pence)
    upsertPrice(oldInvestment.id, "2026-01-15", "16:30:00", 1000); // £10.00 = 1000p
    upsertPrice(oldInvestment.id, "2026-01-16", "16:30:00", 1020); // £10.20 = 1020p
    upsertPrice(oldInvestment.id, "2026-02-27", "16:30:00", 1050); // £10.50 = 1050p

    // Create a holding: 100 shares at £10 avg cost = £1000 book cost
    replacementHolding = createHolding({
      account_id: testAccount.id,
      investment_id: oldInvestment.id,
      quantity: 100,
      average_cost: 10.0,
    });

    // Create the replacement investment
    replacementInvestment = createInvestment({
      currencies_id: gbp.id,
      investment_type_id: (fundType || shareType).id,
      description: "Smithson Eq Fund S GBP Acc " + Date.now(),
      public_id: "GB00BLBNK282",
    });

    return { oldInvestment, replacementHolding, replacementInvestment };
  }

  test("creates movement record with type 'replacement'", () => {
    const scenario = setupReplacementScenario();

    const result = createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
      notes: "Fund restructure",
    });

    expect(result.movement).not.toBeNull();
    expect(result.movement.movement_type).toBe("replacement");
    expect(result.movement.notes).toBe("Fund restructure");
  });

  test("closes original holding via SCD2", () => {
    const scenario = setupReplacementScenario();

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    // Original holding should be closed (effective_to set)
    const oldHolding = getActiveHoldingRaw(testAccount.id, scenario.oldInvestment.id);
    expect(oldHolding).toBeNull(); // No longer active
  });

  test("creates new holding for replacement investment", () => {
    const scenario = setupReplacementScenario();

    const result = createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    // New holding should exist and be active
    const newHolding = getActiveHoldingRaw(testAccount.id, scenario.replacementInvestment.id);
    expect(newHolding).not.toBeNull();
    expect(newHolding.effective_to).toBeNull();
    expect(newHolding.effective_from).toBe("2026-02-28");
    // Quantity: 200 × 10000
    expect(newHolding.quantity).toBe(200 * 10000);
  });

  test("preserves book cost across replacement", () => {
    const scenario = setupReplacementScenario();

    // Original: 100 shares × £10 = £1000 book cost
    // New: 200 units → avg cost should be £1000 / 200 = £5

    const result = createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    expect(result.movement.book_cost).toBeCloseTo(1000, 2);
    expect(result.movement.revised_avg_cost).toBeCloseTo(5.0, 4);

    const newHolding = getActiveHoldingRaw(testAccount.id, scenario.replacementInvestment.id);
    // avg cost = £5.00 → scaled = 5 × 10000 = 50000
    expect(newHolding.average_cost).toBe(50000);
  });

  test("prorates historical prices correctly", () => {
    const scenario = setupReplacementScenario();

    // Old: 100 shares, prices £10.00, £10.20, £10.50
    // New: 200 units → ratio = 100/200 = 0.5
    // Prorated: £5.00, £5.10, £5.25

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    const prices = getPricesInRange(scenario.replacementInvestment.id, "2026-01-01", "2026-03-01");
    // Should have 3 prorated prices + 1 execution date price = 4
    expect(prices.length).toBe(4);

    // Check prorated values (prices are in pence, unscaled from DB)
    const jan15 = prices.find((p) => p.price_date === "2026-01-15");
    expect(jan15.price).toBeCloseTo(500, 0); // £5.00 in pence = 500

    const jan16 = prices.find((p) => p.price_date === "2026-01-16");
    expect(jan16.price).toBeCloseTo(510, 0); // £5.10 in pence = 510

    const feb27 = prices.find((p) => p.price_date === "2026-02-27");
    expect(feb27.price).toBeCloseTo(525, 0); // £5.25 in pence = 525

    // Execution date price
    const feb28 = prices.find((p) => p.price_date === "2026-02-28");
    expect(feb28.price).toBeCloseTo(500, 0); // £5.00 in pence = 500
  });

  test("skips price prorating when prices already exist (multi-account)", () => {
    const scenario = setupReplacementScenario();

    // First replacement writes prorated prices
    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    // Create a second holding in a different account for the same old investment
    const secondAccount = createAccount({
      user_id: testUser.id,
      account_type: "trading",
      account_ref: "M" + String(Date.now()).slice(-14),
      cash_balance: 10000,
      warn_cash: 500,
    });

    // Create a new "old" investment (same as original but fresh holding)
    const secondHolding = createHolding({
      account_id: secondAccount.id,
      investment_id: scenario.oldInvestment.id,
      quantity: 50,
      average_cost: 10.0,
    });

    // Second replacement should skip prorating (prices already exist)
    createReplacementMovement({
      holding_id: secondHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 100,
      new_price: 5.0,
    });

    // Prices should still be the same (not doubled)
    const prices = getPricesInRange(scenario.replacementInvestment.id, "2026-01-01", "2026-02-28");
    // 3 prorated + 1 execution = 4 (unchanged)
    expect(prices.length).toBe(4);
  });

  test("sets auto_fetch = 0 on old investment", () => {
    const scenario = setupReplacementScenario();

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    const oldInv = getInvestmentById(scenario.oldInvestment.id);
    expect(oldInv.auto_fetch).toBe(0);
  });

  test("sets replaced = 1 on old investment", () => {
    const scenario = setupReplacementScenario();

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    const oldInv = getInvestmentById(scenario.oldInvestment.id);
    expect(oldInv.replaced).toBe(1);
  });

  test("replaced investment excluded from manually-priced list", () => {
    const scenario = setupReplacementScenario();

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    const manuallyPriced = getManuallyPricedInvestments();
    const found = manuallyPriced.find((inv) => inv.id === scenario.oldInvestment.id);
    expect(found).toBeUndefined();
  });

  test("writes notes to both investments", () => {
    const scenario = setupReplacementScenario();

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
      notes: "Restructure — see https://example.com",
    });

    const oldInv = getInvestmentById(scenario.oldInvestment.id);
    const newInv = getInvestmentById(scenario.replacementInvestment.id);
    expect(oldInv.notes).toBe("Restructure — see https://example.com");
    expect(newInv.notes).toBe("Restructure — see https://example.com");
  });

  test("rejects if holding not found", () => {
    const scenario = setupReplacementScenario();

    expect(() => {
      createReplacementMovement({
        holding_id: 99999,
        movement_date: "2026-02-28",
        new_investment_id: scenario.replacementInvestment.id,
        new_quantity: 200,
        new_price: 5.0,
      });
    }).toThrow("Holding not found");
  });

  test("rejects if new investment is same as original", () => {
    const scenario = setupReplacementScenario();

    expect(() => {
      createReplacementMovement({
        holding_id: scenario.replacementHolding.id,
        movement_date: "2026-02-28",
        new_investment_id: scenario.oldInvestment.id,
        new_quantity: 200,
        new_price: 5.0,
      });
    }).toThrow("Replacement investment must be different from the current investment");
  });

  test("rejects if new investment does not exist", () => {
    const scenario = setupReplacementScenario();

    expect(() => {
      createReplacementMovement({
        holding_id: scenario.replacementHolding.id,
        movement_date: "2026-02-28",
        new_investment_id: 99999,
        new_quantity: 200,
        new_price: 5.0,
      });
    }).toThrow("Replacement investment not found");
  });

  test("rejects if new quantity is zero or negative", () => {
    const scenario = setupReplacementScenario();

    expect(() => {
      createReplacementMovement({
        holding_id: scenario.replacementHolding.id,
        movement_date: "2026-02-28",
        new_investment_id: scenario.replacementInvestment.id,
        new_quantity: 0,
        new_price: 5.0,
      });
    }).toThrow("New quantity must be greater than zero");
  });

  test("no cash balance change", () => {
    const scenario = setupReplacementScenario();
    const accountBefore = getAccountById(testAccount.id);

    createReplacementMovement({
      holding_id: scenario.replacementHolding.id,
      movement_date: "2026-02-28",
      new_investment_id: scenario.replacementInvestment.id,
      new_quantity: 200,
      new_price: 5.0,
    });

    const accountAfter = getAccountById(testAccount.id);
    expect(accountAfter.cash_balance).toBe(accountBefore.cash_balance);
  });
});
