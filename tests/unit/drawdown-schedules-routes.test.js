import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for drawdown-schedules-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1446;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-drawdown-schedules-routes.db");

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

describe("Drawdown Schedules Routes", () => {
  let testUserId;
  let sippAccountId;
  let tradingAccountId;
  let createdScheduleId;

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

  test("create SIPP account", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "SIPP-001",
        cash_balance: 50000,
        warn_cash: 5000,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    sippAccountId = account.id;
  });

  test("create trading account", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${testUserId}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_type: "trading",
        account_ref: "TRADE-001",
        cash_balance: 1000,
        warn_cash: 0,
      }),
    });
    expect(response.status).toBe(201);
    const account = await response.json();
    tradingAccountId = account.id;
  });

  // --- List schedules (empty) ---

  test("GET /api/accounts/:id/drawdown-schedules returns empty array initially", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });

  test("GET /api/accounts/:id/drawdown-schedules returns 404 for non-existent account", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/drawdown-schedules`);
    expect(response.status).toBe(404);
  });

  // --- Create schedule ---

  test("POST creates a monthly drawdown schedule for SIPP", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 15,
        from_date: "2026-04-15",
        to_date: "2027-03-20",
        amount: 1200,
        notes: "Monthly pension",
      }),
    });
    expect(response.status).toBe(201);
    const schedule = await response.json();
    expect(schedule.id).toBeGreaterThan(0);
    expect(schedule.frequency).toBe("monthly");
    expect(schedule.trigger_day).toBe(15);
    // Dates normalised to first of month
    expect(schedule.from_date).toBe("2026-04-01");
    expect(schedule.to_date).toBe("2027-03-01");
    expect(schedule.amount).toBe(1200);
    expect(schedule.notes).toBe("Monthly pension");
    expect(schedule.active).toBe(1);
    createdScheduleId = schedule.id;
  });

  // --- SIPP-only validation ---

  test("POST to non-SIPP account returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${tradingAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Not a SIPP account");
  });

  // --- Validation errors ---

  test("POST with invalid frequency returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "weekly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Frequency");
  });

  test("POST with trigger_day out of range returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 31,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Trigger day");
  });

  test("POST with to_date before from_date returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2027-01-01",
        to_date: "2026-01-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("To date must be after");
  });

  test("POST with missing amount returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Amount");
  });

  test("POST to non-existent account returns 404", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/9999/drawdown-schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(404);
  });

  // --- Read schedules ---

  test("GET /api/accounts/:id/drawdown-schedules returns the schedule", async () => {
    const response = await fetch(`${BASE_URL}/api/accounts/${sippAccountId}/drawdown-schedules`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBe(1);
    expect(data[0].frequency).toBe("monthly");
  });

  test("GET /api/drawdown-schedules/:id returns the schedule", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`);
    expect(response.status).toBe(200);
    const schedule = await response.json();
    expect(schedule.id).toBe(createdScheduleId);
    expect(schedule.frequency).toBe("monthly");
  });

  test("GET /api/drawdown-schedules/:id returns 404 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/9999`);
    expect(response.status).toBe(404);
  });

  // --- Update schedule ---

  test("PUT /api/drawdown-schedules/:id updates the schedule", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "quarterly",
        trigger_day: 1,
        from_date: "2026-04-01",
        to_date: "2027-04-01",
        amount: 3600,
        notes: "Quarterly pension",
        active: 1,
      }),
    });
    expect(response.status).toBe(200);
    const schedule = await response.json();
    expect(schedule.frequency).toBe("quarterly");
    expect(schedule.trigger_day).toBe(1);
    expect(schedule.amount).toBe(3600);
    expect(schedule.notes).toBe("Quarterly pension");
  });

  test("PUT can pause a schedule", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "quarterly",
        trigger_day: 1,
        from_date: "2026-04-01",
        to_date: "2027-04-01",
        amount: 3600,
        active: 0,
      }),
    });
    expect(response.status).toBe(200);
    const schedule = await response.json();
    expect(schedule.active).toBe(0);
  });

  test("PUT /api/drawdown-schedules/:id returns 404 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/9999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "monthly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(404);
  });

  test("PUT with invalid data returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "weekly",
        trigger_day: 1,
        from_date: "2026-01-01",
        to_date: "2026-12-01",
        amount: 100,
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Frequency");
  });

  // --- Delete schedule ---

  test("DELETE /api/drawdown-schedules/:id deletes the schedule", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("Schedule deleted");

    // Verify it's gone
    const getRes = await fetch(`${BASE_URL}/api/drawdown-schedules/${createdScheduleId}`);
    expect(getRes.status).toBe(404);
  });

  test("DELETE /api/drawdown-schedules/:id returns 404 for non-existent", async () => {
    const response = await fetch(`${BASE_URL}/api/drawdown-schedules/9999`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});
