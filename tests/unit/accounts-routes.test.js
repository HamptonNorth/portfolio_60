import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for accounts-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1442;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-accounts-routes.db");

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

describe("Accounts Routes - CRUD", () => {
  let testUserId;
  let createdAccountId;

  test("POST /api/users creates a test user", async () => {
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

  test("GET /api/users/:userId/accounts returns empty array initially", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });

  test("GET /api/users/:userId/accounts returns 404 for non-existent user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/9999/accounts`);
    expect(response.status).toBe(404);
  });

  test("POST /api/users/:userId/accounts creates a SIPP account", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "12345",
        cash_balance: 23765.5,
        warn_cash: 25000,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    expect(account.id).toBeGreaterThan(0);
    expect(account.account_type).toBe("sipp");
    expect(account.account_ref).toBe("12345");
    expect(account.cash_balance).toBe(23765.5);
    expect(account.warn_cash).toBe(25000);
    createdAccountId = account.id;
  });

  test("POST /api/users/:userId/accounts with duplicate type returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "99999",
        cash_balance: 0,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("SIPP account");
  });

  test("POST /api/users/:userId/accounts with invalid type returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "pension",
        account_ref: "111",
        cash_balance: 0,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Account type");
  });

  test("POST /api/users/:userId/accounts with missing ref returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "trading",
        cash_balance: 0,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Account reference");
  });

  test("POST /api/users/:userId/accounts for non-existent user returns 404", async () => {
    const response = await fetch(`${BASE_URL}/api/users/9999/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "trading",
        account_ref: "111",
        cash_balance: 0,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("POST creates a second account (trading)", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "trading",
        account_ref: "7654321",
        cash_balance: 27,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    expect(account.account_type).toBe("trading");
  });

  test("GET /api/users/:userId/accounts returns all accounts", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`);
    expect(response.status).toBe(200);
    const accounts = await response.json();
    expect(accounts.length).toBe(2);
  });

  test("GET /api/accounts/:id returns the account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`);
    expect(response.status).toBe(200);
    const account = await response.json();
    expect(account.id).toBe(createdAccountId);
    expect(account.account_type).toBe("sipp");
  });

  test("GET /api/accounts/:id returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999`);
    expect(response.status).toBe(404);
  });

  test("PUT /api/accounts/:id updates the account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_ref: "12345-UPD",
        cash_balance: 30000,
        warn_cash: 20000,
      }),
    });
    expect(response.status).toBe(200);
    const account = await response.json();
    expect(account.account_ref).toBe("12345-UPD");
    expect(account.cash_balance).toBe(30000);
    expect(account.warn_cash).toBe(20000);
  });

  test("PUT /api/accounts/:id returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_ref: "X",
        cash_balance: 0,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("PUT /api/accounts/:id with negative cash returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_ref: "12345",
        cash_balance: -100,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Cash balance");
  });

  test("DELETE /api/accounts/:id rejects without passphrase", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Passphrase is required");
  });

  test("DELETE /api/accounts/:id rejects wrong passphrase", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "wrongpassword" }),
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Incorrect passphrase");
  });

  test("DELETE /api/accounts/:id deletes the account with correct passphrase", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${createdAccountId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "testpass1234" }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Account deleted");
  });

  test("DELETE /api/accounts/:id returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "testpass1234" }),
    });
    expect(response.status).toBe(404);
  });
});
