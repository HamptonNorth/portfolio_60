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

  test("GET /api/accounts/:id/cash-transactions returns empty array initially", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/cash-transactions`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
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
    expect(data.length).toBe(2);
    // Most recent first
    expect(data[0].transaction_date).toBe("2026-01-20");
    expect(data[1].transaction_date).toBe("2026-01-15");
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

  test("DELETE /api/cash-transactions/:id reverses deposit balance", async () => {
    // Before: balance is 11500, deposit was 2000
    const response = await fetch(`${BASE_URL}/api/cash-transactions/${depositTxId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Transaction deleted");

    // Balance should decrease by 2000: 11500 - 2000 = 9500
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(9500);
  });

  test("DELETE /api/cash-transactions/:id reverses withdrawal balance", async () => {
    // Before: balance is 9500, withdrawal was 500
    const response = await fetch(`${BASE_URL}/api/cash-transactions/${withdrawalTxId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);

    // Balance should increase by 500: 9500 + 500 = 10000
    const accountRes = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}`);
    const account = await accountRes.json();
    expect(account.cash_balance).toBe(10000);
  });

  test("DELETE /api/cash-transactions/:id returns 404 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/cash-transactions/9999`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
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
    expect(data.deposits_this_year).toBe(4500);
    expect(data.remaining).toBe(15500);
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
});
