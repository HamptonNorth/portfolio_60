import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for cash-transactions-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1445;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-cash-transactions-routes.db");

let serverProcess;
let envBackup = null;

beforeAll(async () => {
  // Back up existing .env
  if (existsSync(ENV_PATH)) {
    envBackup = readFileSync(ENV_PATH, "utf-8");
  }
  if (existsSync(ENV_PATH)) {
    unlinkSync(ENV_PATH);
  }

  // Clean up any leftover test database
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB_PATH + suffix;
    if (existsSync(f)) unlinkSync(f);
  }

  // Start the server with isolated test database
  serverProcess = Bun.spawn(["bun", "run", "src/server/index.js"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: String(TEST_PORT), DB_PATH: TEST_DB_PATH },
  });

  // Wait for server to be ready
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/status`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("Server did not start");

  // Set passphrase (also creates test database)
  await fetch(`${BASE_URL}/api/auth/set-passphrase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase: "testpass1234" }),
  });
});

afterAll(() => {
  if (serverProcess) serverProcess.kill();

  // Restore .env
  if (existsSync(ENV_PATH)) unlinkSync(ENV_PATH);
  if (envBackup !== null) writeFileSync(ENV_PATH, envBackup, "utf-8");

  // Remove isolated test database
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = TEST_DB_PATH + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

describe("Cash Transactions Routes", () => {
  let testUserId;
  let sippAccountId;
  let isaAccountId;
  let depositTxId;
  let withdrawalTxId;

  // --- Setup: create user and accounts ---

  test("create test user", async () => {
    const response = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "RC",
        first_name: "Robert",
        last_name: "Collins",
        provider: "ii",
      }),
    });
    expect(response.status).toBe(201);
    const user = await response.json();
    testUserId = user.id;
  });

  test("create SIPP account with cash balance", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "SIPP-001",
        cash_balance: 10000,
        warn_cash: 5000,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    sippAccountId = account.id;
  });

  test("create ISA account", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "isa",
        account_ref: "ISA-001",
        cash_balance: 5000,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    isaAccountId = account.id;
  });

  // --- List transactions (empty) ---

  test("GET /api/accounts/:id/cash-transactions returns opening balance initially", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBe(1);
    expect(data[0].transaction_type).toBe("deposit");
    expect(data[0].notes).toBe("Opening balance");
    expect(data[0].amount).toBe(10000);
  });

  test("GET /api/accounts/:id/cash-transactions returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/cash-transactions`);
    expect(response.status).toBe(404);
  });

  // --- Create deposit ---

  test("POST deposit increases cash balance", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "2026-01-15",
        amount: 2000,
        notes: "Pension contribution",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.id).toBeGreaterThan(0);
    expect(tx.transaction_type).toBe("deposit");
    expect(tx.amount).toBe(2000);
    expect(tx.notes).toBe("Pension contribution");
    depositTxId = tx.id;

    // Verify cash balance increased: 10000 + 2000 = 12000
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(12000);
  });

  // --- Create withdrawal ---

  test("POST withdrawal decreases cash balance", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "withdrawal",
        transaction_date: "2026-01-20",
        amount: 500,
        notes: "Transfer out",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.transaction_type).toBe("withdrawal");
    expect(tx.amount).toBe(500);
    withdrawalTxId = tx.id;

    // Verify cash balance decreased: 12000 - 500 = 11500
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(11500);
  });

  // --- Withdrawal exceeds balance ---

  test("POST withdrawal exceeding balance returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "withdrawal",
        transaction_date: "2026-01-25",
        amount: 99999,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Insufficient cash");
    expect(data.detail).toContain("exceeds available balance");
  });

  // --- Validation errors ---

  test("POST with invalid transaction_type returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "transfer",
        transaction_date: "2026-01-25",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Transaction type");
  });

  test("POST with missing amount returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "2026-01-25",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Amount");
  });

  test("POST with zero amount returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "2026-01-25",
        amount: 0,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("greater than zero");
  });

  test("POST with invalid date returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "not-a-date",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("YYYY-MM-DD");
  });

  test("POST to non-existent account returns 404", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "2026-01-25",
        amount: 100,
      }),
    });
    expect(response.status).toBe(404);
  });

  // --- Read transactions ---

  test("GET /api/accounts/:id/cash-transactions returns transactions newest first", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`);
    expect(response.status).toBe(200);
    const data = await response.json();
    // Opening balance (today) + deposit (2026-01-15) + withdrawal (2026-01-20) = 3
    expect(data.length).toBe(3);
    // Most recent first: opening balance (today), then 2026-01-20, then 2026-01-15
    expect(data[0].notes).toBe("Opening balance");
    expect(data[1].transaction_date).toBe("2026-01-20");
    expect(data[2].transaction_date).toBe("2026-01-15");
  });

  test("GET /api/accounts/:id/cash-transactions respects limit", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions?limit=1`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBe(1);
  });

  test("GET /api/cash-transactions/:id returns the transaction", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/${depositTxId}`);
    expect(response.status).toBe(200);
    const tx = await response.json();
    expect(tx.id).toBe(depositTxId);
    expect(tx.transaction_type).toBe("deposit");
  });

  test("GET /api/cash-transactions/:id returns 404 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/9999`);
    expect(response.status).toBe(404);
  });

  // --- Delete transactions ---

  test("DELETE /api/cash-transactions/:id returns 400 for deposit (audit trail)", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/${depositTxId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Cannot delete");

    // Balance should remain unchanged at 11500
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(11500);
  });

  test("DELETE /api/cash-transactions/:id returns 400 for withdrawal (audit trail)", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/${withdrawalTxId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Cannot delete");
  });

  test("DELETE /api/cash-transactions/:id returns 400 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/9999`, {
      method: "DELETE",
    });
    expect(response.status).toBe(400);
  });

  // --- ISA allowance ---

  test("GET /api/accounts/:id/isa-allowance returns allowance for ISA account", async () => {
    // Add a deposit to the ISA account within the current tax year
    await fetch(`${BASE_URL}/api/accounts/${isaAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "deposit",
        transaction_date: "2025-06-01",
        amount: 4500,
      }),
    });

    const response = await fetch(`${BASE_URL}/api/accounts/${isaAccountId}/isa-allowance`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.annual_limit).toBe(20000);
    expect(data.tax_year).toMatch(/^\d{4}\/\d{4}$/);
    // 5000 (opening balance) + 4500 (test deposit) = 9500
    expect(data.deposits_this_year).toBe(9500);
    expect(data.remaining).toBe(10500);
  });

  test("GET /api/accounts/:id/isa-allowance returns 400 for non-ISA account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/isa-allowance`);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Not an ISA account");
  });

  test("GET /api/accounts/:id/isa-allowance returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/isa-allowance`);
    expect(response.status).toBe(404);
  });

  // --- Adjustment (fee) transactions ---

  test("POST adjustment (debit) decreases cash balance", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-10",
        amount: 75,
        notes: "Platform fee",
        direction: "debit",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.transaction_type).toBe("adjustment");
    expect(tx.amount).toBe(75);
    expect(tx.notes).toBe("Platform fee");

    // Verify cash balance decreased: 11500 - 75 = 11425
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(11425);
  });

  test("POST adjustment (credit) increases cash balance", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-11",
        amount: 20,
        notes: "Provider refund",
        direction: "credit",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.transaction_type).toBe("adjustment");
    expect(tx.amount).toBe(20);
    expect(tx.notes).toBe("[Credit] Provider refund");

    // Verify cash balance increased: 11425 + 20 = 11445
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(11445);
  });

  test("POST adjustment debit exceeding balance returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-12",
        amount: 999999,
        direction: "debit",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Insufficient cash");
    expect(data.detail).toContain("exceeds available balance");
  });

  test("POST adjustment credit does NOT check balance", async () => {
    // Credit adjustments should always succeed regardless of balance
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-12",
        amount: 5,
        direction: "credit",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.transaction_type).toBe("adjustment");
  });

  test("POST adjustment with invalid direction returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-12",
        amount: 10,
        direction: "sideways",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Direction");
  });

  test("POST adjustment defaults to debit when direction omitted", async () => {
    // Get current balance first
    const beforeRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const beforeAccount = await beforeRes.json();
    const balanceBefore = beforeAccount.cash_balance;

    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transaction_type: "adjustment",
        transaction_date: "2026-02-13",
        amount: 30,
        notes: "Misc fee",
      }),
    });
    expect(response.status).toBe(201);
    const tx = await response.json();
    expect(tx.notes).toBe("Misc fee"); // No [Credit] prefix

    // Balance should decrease by 30
    const afterRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const afterAccount = await afterRes.json();
    expect(afterAccount.cash_balance).toBe(balanceBefore - 30);
  });

  // --- System-created transaction delete protection ---

  test("DELETE returns 400 for buy-type cash transaction", async () => {
    // Create an investment
    const invResponse = await fetch(`${BASE_URL}/api/investments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currencies_id: 1,
        investment_type_id: 1,
        description: "Test Share",
      }),
    });
    const investment = await invResponse.json();

    // Create a holding on the SIPP account
    const holdResponse = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: investment.id,
        quantity: 0,
        average_cost: 0,
      }),
    });
    const holding = await holdResponse.json();

    // Record a buy movement (creates a system 'buy' cash transaction)
    await fetch(`${BASE_URL}/api/holdings/${holding.id}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "2026-02-13",
        quantity: 10,
        total_consideration: 100,
        deductible_costs: 0,
      }),
    });

    // Find the buy cash transaction
    const txResponse = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`);
    const transactions = await txResponse.json();
    const buyTx = transactions.find((t) => t.transaction_type === "buy");
    expect(buyTx).toBeDefined();

    // Attempt to delete it — should be blocked
    const deleteResponse = await fetch(`${BASE_URL}/api/cash-transactions/${buyTx.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(400);
    const deleteData = await deleteResponse.json();
    expect(deleteData.error).toContain("Cannot delete");
  });
});
