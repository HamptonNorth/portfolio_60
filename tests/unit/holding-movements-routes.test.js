import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for holding-movements-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1446;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-holding-movements-routes.db");

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

describe("Holding Movements Routes", () => {
  let testUserId;
  let testAccountId;
  let testInvestmentId;
  let testInvestment2Id;
  let holdingId;
  let holding2Id;
  let createdMovementId;

  test("set up test data: user, account, investments, holdings", async () => {
    // Create user
    let response = await fetch(`${BASE_URL}/api/users`, {
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

    // Create account with cash
    response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "isa",
        account_ref: "5565928",
        cash_balance: 50000,
        warn_cash: 5000,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    testAccountId = account.id;

    // Get currencies and types
    const currResponse = await fetch(`${BASE_URL}/api/currencies`);
    const currencies = await currResponse.json();
    const gbp = currencies.find((c) => c.code === "GBP");

    const typeResponse = await fetch(`${BASE_URL}/api/investment-types`);
    const types = await typeResponse.json();
    const shareType = types.find((t) => t.short_description === "SHARE");

    // Create investments
    response = await fetch(`${BASE_URL}/api/investments`, {
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
    testInvestmentId = (await response.json()).id;

    response = await fetch(`${BASE_URL}/api/investments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currencies_id: gbp.id,
        investment_type_id: shareType.id,
        description: "Stewart Inv APAC Leaders",
      }),
    });
    expect(response.status).toBe(201);
    testInvestment2Id = (await response.json()).id;

    // Create holding with existing position (100 shares @ 5.00)
    response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestmentId,
        quantity: 100,
        average_cost: 5.0,
      }),
    });
    expect(response.status).toBe(201);
    holdingId = (await response.json()).id;

    // Create holding with zero quantity (for first-buy test)
    response = await fetch(`${BASE_URL}/api/accounts/${testAccountId}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investment_id: testInvestment2Id,
        quantity: 0,
        average_cost: 0,
      }),
    });
    expect(response.status).toBe(201);
    holding2Id = (await response.json()).id;
  });

  // --- Buy movements ---

  test("POST buy movement: success with deductible costs", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "2026-02-10",
        quantity: 50,
        total_consideration: 300,
        deductible_costs: 10,
        notes: "Bought 50 shares",
      }),
    });
    expect(response.status).toBe(201);
    const data = await response.json();

    // Check movement
    expect(data.movement.movement_type).toBe("buy");
    expect(data.movement.quantity).toBe(50);
    expect(data.movement.movement_value).toBe(300);
    expect(data.movement.book_cost).toBe(290); // 300 - 10
    expect(data.movement.deductible_costs).toBe(10);
    expect(data.movement.notes).toBe("Bought 50 shares");
    createdMovementId = data.movement.id;

    // Check updated holding
    expect(data.holding.quantity).toBe(150); // 100 + 50
    expect(data.holding.average_cost).toBeCloseTo(5.2667, 3);

    // Check updated account
    expect(data.account.cash_balance).toBe(49700); // 50000 - 300
  });

  test("POST buy movement: insufficient cash returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "2026-02-11",
        quantity: 100,
        total_consideration: 999999,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Insufficient cash");
  });

  test("POST buy movement: validation errors (missing fields)", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Validation failed");
    expect(data.detail).toContain("Movement type is required");
    expect(data.detail).toContain("Date is required");
    expect(data.detail).toContain("Quantity is required");
    expect(data.detail).toContain("Total consideration is required");
  });

  test("POST buy movement: invalid date format returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "11/02/2026",
        quantity: 10,
        total_consideration: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Date must be in YYYY-MM-DD format");
  });

  test("POST buy movement: negative quantity returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "2026-02-11",
        quantity: -10,
        total_consideration: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Quantity must be greater than zero");
  });

  test("POST buy movement: invalid movement type returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "transfer",
        movement_date: "2026-02-11",
        quantity: 10,
        total_consideration: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Movement type must be either 'buy' or 'sell'");
  });

  test("POST buy movement: holding not found returns 404", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/99999/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "buy",
        movement_date: "2026-02-11",
        quantity: 10,
        total_consideration: 100,
      }),
    });
    expect(response.status).toBe(404);
  });

  // --- Sell movements ---

  test("POST sell movement: success", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "sell",
        movement_date: "2026-02-11",
        quantity: 30,
        total_consideration: 200,
        deductible_costs: 5.5,
        notes: "Sold 30 shares",
      }),
    });
    expect(response.status).toBe(201);
    const data = await response.json();

    expect(data.movement.movement_type).toBe("sell");
    expect(data.movement.quantity).toBe(30);
    expect(data.movement.movement_value).toBe(200);
    expect(data.movement.deductible_costs).toBe(5.5);

    // Holding quantity reduced: 150 - 30 = 120
    expect(data.holding.quantity).toBe(120);

    // Cash increased by net proceeds (consideration - deductible costs)
    expect(data.account.cash_balance).toBe(49894.5); // 49700 + (200 - 5.5)
  });

  test("POST sell movement: insufficient quantity returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movement_type: "sell",
        movement_date: "2026-02-11",
        quantity: 99999,
        total_consideration: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Insufficient quantity");
  });

  // --- GET movements ---

  test("GET /api/holdings/:holdingId/movements returns movements", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements`);
    expect(response.status).toBe(200);
    const movements = await response.json();
    expect(movements.length).toBe(2); // 1 buy + 1 sell
    // Newest first
    expect(movements[0].movement_type).toBe("sell");
    expect(movements[1].movement_type).toBe("buy");
  });

  test("GET /api/holdings/:holdingId/movements returns 404 for non-existent holding", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/99999/movements`);
    expect(response.status).toBe(404);
  });

  test("GET /api/holdings/:holdingId/movements with limit parameter", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holdingId}/movements?limit=1`);
    expect(response.status).toBe(200);
    const movements = await response.json();
    expect(movements.length).toBe(1);
  });

  test("GET /api/holding-movements/:id returns a single movement", async () => {
    const response = await fetch(`${BASE_URL}/api/holding-movements/${createdMovementId}`);
    expect(response.status).toBe(200);
    const movement = await response.json();
    expect(movement.id).toBe(createdMovementId);
    expect(movement.movement_type).toBe("buy");
  });

  test("GET /api/holding-movements/:id returns 404 for non-existent movement", async () => {
    const response = await fetch(`${BASE_URL}/api/holding-movements/99999`);
    expect(response.status).toBe(404);
  });

  // --- Empty holding movements ---

  test("GET movements for holding with no movements returns empty array", async () => {
    const response = await fetch(`${BASE_URL}/api/holdings/${holding2Id}/movements`);
    expect(response.status).toBe(200);
    const movements = await response.json();
    expect(movements).toEqual([]);
  });
});
