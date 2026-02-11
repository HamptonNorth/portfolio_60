import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for holdings-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1443;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-holdings-routes.db");

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

describe("Holdings Routes - CRUD", () => {
  let testUserId;
  let testAccountId;
  let testInvestmentId;
  let testInvestment2Id;
  let createdHoldingId;

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

  test("create test account", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "12345",
        cash_balance: 23765.50,
        warn_cash: 25000,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    testAccountId = account.id;
  });

  test("create test investments", async () => {
    // Get currencies and types for creating investments
    const currResponse = await fetch(`${BASE_URL}/api/currencies`);
    const currencies = await currResponse.json();
    const gbp = currencies.find((c) => c.code === "GBP");

    const typeResponse = await fetch(`${BASE_URL}/api/investment-types`);
    const types = await typeResponse.json();
    const shareType = types.find((t) => t.short_description === "SHARE");

    // Create first investment
    let response = await fetch(`${BASE_URL}/api/investments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currencies_id: gbp.id,
        investment_type_id: shareType.id,
        description: "Raspberry Pi Holdings",
        public_id: "LSE:RPI",
      }),
    });
    expect(response.status).toBe(201);
    const inv1 = await response.json();
    testInvestmentId = inv1.id;

    // Create second investment
    response = await fetch(`${BASE_URL}/api/investments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currencies_id: gbp.id,
        investment_type_id: shareType.id,
        description: "Rathbone Global Opps",
      }),
    });
    expect(response.status).toBe(201);
    const inv2 = await response.json();
    testInvestment2Id = inv2.id;
  });

  test("GET /api/accounts/:accountId/holdings returns empty array initially", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });

  test("GET /api/accounts/:accountId/holdings returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/holdings`);
    expect(response.status).toBe(404);
  });

  test("POST /api/accounts/:accountId/holdings creates a holding", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestmentId,
        quantity: 365,
        average_cost: 0.955,
      }),
    });
    expect(response.status).toBe(201);
    const holding = await response.json();
    expect(holding.id).toBeGreaterThan(0);
    expect(holding.investment_id).toBe(testInvestmentId);
    expect(holding.quantity).toBe(365);
    expect(holding.average_cost).toBe(0.955);
    expect(holding.investment_description).toBe("Raspberry Pi Holdings");
    expect(holding.currency_code).toBe("GBP");
    createdHoldingId = holding.id;
  });

  test("POST creates a second holding", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestment2Id,
        quantity: 661.152,
        average_cost: 130.40,
      }),
    });
    expect(response.status).toBe(201);
    const holding = await response.json();
    expect(holding.quantity).toBe(661.152);
  });

  test("POST with duplicate investment returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestmentId,
        quantity: 100,
        average_cost: 1.00,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("already held");
  });

  test("POST with missing investment_id returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity: 100,
        average_cost: 1.00,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Investment is required");
  });

  test("POST for non-existent account returns 404", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestmentId,
        quantity: 100,
        average_cost: 1.00,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("POST with negative quantity returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: 9999,
        quantity: -10,
        average_cost: 1.00,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Quantity");
  });

  test("GET /api/accounts/:accountId/holdings returns all holdings", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`);
    expect(response.status).toBe(200);
    const holdings = await response.json();
    expect(holdings.length).toBe(2);
  });

  test("GET /api/holdings/:id returns the holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${createdHoldingId}`);
    expect(response.status).toBe(200);
    const holding = await response.json();
    expect(holding.id).toBe(createdHoldingId);
    expect(holding.investment_description).toBe("Raspberry Pi Holdings");
  });

  test("GET /api/holdings/:id returns 404 for non-existent holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/9999`);
    expect(response.status).toBe(404);
  });

  test("PUT /api/holdings/:id updates the holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${createdHoldingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity: 400,
        average_cost: 1.10,
      }),
    });
    expect(response.status).toBe(200);
    const holding = await response.json();
    expect(holding.quantity).toBe(400);
    expect(holding.average_cost).toBe(1.1);
  });

  test("PUT /api/holdings/:id returns 404 for non-existent holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/9999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity: 100,
        average_cost: 1.00,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("DELETE /api/holdings/:id deletes the holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${createdHoldingId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Holding deleted");
  });

  test("DELETE /api/holdings/:id returns 404 for non-existent holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/9999`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });

  test("remaining holdings still accessible", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`);
    expect(response.status).toBe(200);
    const holdings = await response.json();
    expect(holdings.length).toBe(1);
  });
});
