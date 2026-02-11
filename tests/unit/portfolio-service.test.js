// Set isolated DB path BEFORE importing connection.js
process.env.DB_PATH = "data/portfolio_60_test/test-portfolio-service.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import { getAllCurrencies, createCurrency } from "../../src/server/db/currencies-db.js";
import { createInvestment } from "../../src/server/db/investments-db.js";
import { getAllInvestmentTypes } from "../../src/server/db/investment-types-db.js";
import { createAccount } from "../../src/server/db/accounts-db.js";
import { createHolding } from "../../src/server/db/holdings-db.js";
import { upsertPrice } from "../../src/server/db/prices-db.js";
import { upsertRate, scaleRate } from "../../src/server/db/currency-rates-db.js";
import { getPortfolioSummary } from "../../src/server/services/portfolio-service.js";

const testDbPath = getDatabasePath();

/**
 * @description Clean up the isolated test database files.
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

let gbpId;
let usdId;
let shareTypeId;
let userId;
let userId2;
let sippAccountId;
let tradingAccountId;
let gbpInvestmentId;
let usdInvestmentId;
let noPriceInvestmentId;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Get seeded data
  const currencies = getAllCurrencies();
  const gbp = currencies.find((c) => c.code === "GBP");
  gbpId = gbp.id;

  const types = getAllInvestmentTypes();
  const shareType = types.find((t) => t.short_description === "SHARE");
  shareTypeId = shareType.id;

  // Create USD currency
  const usd = createCurrency({ code: "USD", description: "US Dollar" });
  usdId = usd.id;

  // Create users
  const user1 = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    ni_number: "",
    utr: "",
    provider: "ii",
    trading_ref: "",
    isa_ref: "",
    sipp_ref: "",
  });
  userId = user1.id;

  const user2 = createUser({
    initials: "JC",
    first_name: "Jane",
    last_name: "Collins",
    ni_number: "",
    utr: "",
    provider: "ii",
    trading_ref: "",
    isa_ref: "",
    sipp_ref: "",
  });
  userId2 = user2.id;

  // Create investments
  const gbpInv = createInvestment({
    currencies_id: gbpId,
    investment_type_id: shareTypeId,
    description: "Raspberry Pi Holdings",
    public_id: "LSE:RPI",
    investment_url: "",
    selector: "",
  });
  gbpInvestmentId = gbpInv.id;

  const usdInv = createInvestment({
    currencies_id: usdId,
    investment_type_id: shareTypeId,
    description: "Microsoft Corp",
    public_id: "NSQ:MSFT",
    investment_url: "",
    selector: "",
  });
  usdInvestmentId = usdInv.id;

  const noPriceInv = createInvestment({
    currencies_id: gbpId,
    investment_type_id: shareTypeId,
    description: "No Price Investment",
    public_id: "",
    investment_url: "",
    selector: "",
  });
  noPriceInvestmentId = noPriceInv.id;

  // Create accounts for user 1
  const sippAcct = createAccount({
    user_id: userId,
    account_type: "sipp",
    account_ref: "S12345",
    cash_balance: 23765.0,
    warn_cash: 25000.0,
  });
  sippAccountId = sippAcct.id;

  const tradingAcct = createAccount({
    user_id: userId,
    account_type: "trading",
    account_ref: "T7654",
    cash_balance: 500.5,
    warn_cash: 0,
  });
  tradingAccountId = tradingAcct.id;

  // Create holdings
  // SIPP: GBP investment — 365 units at avg cost 0.955
  createHolding({
    account_id: sippAccountId,
    investment_id: gbpInvestmentId,
    quantity: 365,
    average_cost: 0.955,
  });

  // SIPP: No-price investment — 100 units at avg cost 5.00
  createHolding({
    account_id: sippAccountId,
    investment_id: noPriceInvestmentId,
    quantity: 100,
    average_cost: 5.0,
  });

  // Trading: USD investment — 125 units at avg cost 101.00
  createHolding({
    account_id: tradingAccountId,
    investment_id: usdInvestmentId,
    quantity: 125,
    average_cost: 101.0,
  });

  // Insert prices
  // GBP investment: 1.565 pounds → price in pence = 156.5
  upsertPrice(gbpInvestmentId, "2026-02-10", "16:30:00", 156.5);

  // USD investment: 185.77 dollars → price in cents = 18577
  upsertPrice(usdInvestmentId, "2026-02-10", "21:00:00", 18577);

  // Insert USD→GBP exchange rate: 1.369 (1 GBP = 1.369 USD)
  upsertRate(usdId, "2026-02-10", "21:00:00", scaleRate(1.369));
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

describe("Portfolio Service - getPortfolioSummary", function () {
  test("returns null for non-existent user", function () {
    const result = getPortfolioSummary(99999);
    expect(result).toBeNull();
  });

  test("returns correct user details", function () {
    const result = getPortfolioSummary(userId);
    expect(result.user.id).toBe(userId);
    expect(result.user.first_name).toBe("Robert");
    expect(result.user.last_name).toBe("Collins");
  });

  test("returns today's date as valuation_date", function () {
    const result = getPortfolioSummary(userId);
    const today = new Date().toISOString().slice(0, 10);
    expect(result.valuation_date).toBe(today);
  });

  test("returns correct number of accounts", function () {
    const result = getPortfolioSummary(userId);
    expect(result.accounts.length).toBe(2);
  });

  test("returns correct SIPP account details", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    expect(sipp).toBeDefined();
    expect(sipp.account_ref).toBe("S12345");
    expect(sipp.cash_balance).toBe(23765);
    expect(sipp.warn_cash).toBe(25000);
  });

  test("cash_warning is true when cash < warn_cash", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    expect(sipp.cash_warning).toBe(true);
  });

  test("cash_warning is false when warn_cash is 0", function () {
    const result = getPortfolioSummary(userId);
    const trading = result.accounts.find((a) => a.account_type === "trading");
    expect(trading.cash_warning).toBe(false);
  });

  test("calculates GBP holding value correctly", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    const rpiHolding = sipp.holdings.find((h) => h.description === "Raspberry Pi Holdings");

    expect(rpiHolding.currency_code).toBe("GBP");
    expect(rpiHolding.quantity).toBe(365);
    expect(rpiHolding.price).toBeCloseTo(1.565, 3);
    expect(rpiHolding.rate).toBeNull();

    // value_local = 365 * 1.565 = 571.225 → rounded to 571.23
    expect(rpiHolding.value_local).toBeCloseTo(571.23, 1);
    // GBP: value_gbp === value_local
    expect(rpiHolding.value_gbp).toBe(rpiHolding.value_local);
  });

  test("calculates USD holding with currency conversion", function () {
    const result = getPortfolioSummary(userId);
    const trading = result.accounts.find((a) => a.account_type === "trading");
    const msftHolding = trading.holdings.find((h) => h.description === "Microsoft Corp");

    expect(msftHolding.currency_code).toBe("USD");
    expect(msftHolding.quantity).toBe(125);
    expect(msftHolding.price).toBeCloseTo(185.77, 2);
    expect(msftHolding.rate).toBeCloseTo(1.369, 4);

    // value_local = 125 * 185.77 = 23221.25
    expect(msftHolding.value_local).toBeCloseTo(23221.25, 2);
    // value_gbp = 23221.25 / 1.369 ≈ 16962.20
    expect(msftHolding.value_gbp).toBeCloseTo(16962.2, 0);
  });

  test("handles holding with no price data", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    const noPriceHolding = sipp.holdings.find((h) => h.description === "No Price Investment");

    expect(noPriceHolding).toBeDefined();
    expect(noPriceHolding.price).toBe(0);
    expect(noPriceHolding.price_date).toBeNull();
    expect(noPriceHolding.value_local).toBe(0);
    expect(noPriceHolding.value_gbp).toBe(0);
  });

  test("calculates account investments_total correctly", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");

    // SIPP has RPI holding (≈571.23) + No Price holding (0)
    expect(sipp.investments_total).toBeCloseTo(571.23, 1);
  });

  test("calculates account_total correctly (investments + cash)", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");

    expect(sipp.account_total).toBeCloseTo(sipp.investments_total + 23765, 1);
  });

  test("calculates grand totals across all accounts", function () {
    const result = getPortfolioSummary(userId);
    const totals = result.totals;

    // cash = 23765 + 500.50
    expect(totals.cash).toBeCloseTo(24265.5, 2);

    // investments = SIPP investments + Trading investments
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    const trading = result.accounts.find((a) => a.account_type === "trading");
    expect(totals.investments).toBeCloseTo(sipp.investments_total + trading.investments_total, 2);

    // grand_total = investments + cash
    expect(totals.grand_total).toBeCloseTo(totals.investments + totals.cash, 2);
  });

  test("includes holding average_cost", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    const rpi = sipp.holdings.find((h) => h.description === "Raspberry Pi Holdings");
    expect(rpi.average_cost).toBeCloseTo(0.955, 3);
  });

  test("includes holding public_id", function () {
    const result = getPortfolioSummary(userId);
    const sipp = result.accounts.find((a) => a.account_type === "sipp");
    const rpi = sipp.holdings.find((h) => h.description === "Raspberry Pi Holdings");
    expect(rpi.public_id).toBe("LSE:RPI");
  });

  test("includes price_date and rate_date", function () {
    const result = getPortfolioSummary(userId);
    const trading = result.accounts.find((a) => a.account_type === "trading");
    const msft = trading.holdings.find((h) => h.description === "Microsoft Corp");
    expect(msft.price_date).toBe("2026-02-10");
    expect(msft.rate_date).toBe("2026-02-10");
  });

  test("handles user with no accounts", function () {
    const result = getPortfolioSummary(userId2);
    expect(result).not.toBeNull();
    expect(result.accounts.length).toBe(0);
    expect(result.totals.investments).toBe(0);
    expect(result.totals.cash).toBe(0);
    expect(result.totals.grand_total).toBe(0);
  });
});
