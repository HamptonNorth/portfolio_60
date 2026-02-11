import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for portfolio-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1444;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-portfolio-routes.db");

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

/**
 * @description Helper to make API requests.
 * @param {string} path - The API path
 * @param {Object} [options] - Fetch options
 * @returns {Promise<{status: number, data: any}>} Status and parsed JSON body
 */
async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  return { status: response.status, data };
}

describe("Portfolio Routes", function () {
  let userId;

  test("setup — create a user with an account", async function () {
    const userRes = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        initials: "RC",
        first_name: "Robert",
        last_name: "Collins",
        ni_number: "",
        utr: "",
        provider: "ii",
        trading_ref: "",
        isa_ref: "",
        sipp_ref: "",
      }),
    });
    userId = userRes.data.id;
    expect(userId).toBeGreaterThan(0);

    // Create an account
    const acctRes = await api(`/api/users/${userId}/accounts`, {
      method: "POST",
      body: JSON.stringify({
        account_type: "sipp",
        account_ref: "S12345",
        cash_balance: 10000,
        warn_cash: 5000,
      }),
    });
    expect(acctRes.status).toBe(201);
  });

  describe("GET /api/portfolio/summary/:userId", function () {
    test("returns 200 with correct structure", async function () {
      const res = await api(`/api/portfolio/summary/${userId}`);
      expect(res.status).toBe(200);
      expect(res.data.user).toBeDefined();
      expect(res.data.user.id).toBe(userId);
      expect(res.data.user.first_name).toBe("Robert");
      expect(res.data.valuation_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(res.data.accounts)).toBe(true);
      expect(res.data.totals).toBeDefined();
    });

    test("returns account with correct cash values", async function () {
      const res = await api(`/api/portfolio/summary/${userId}`);
      expect(res.data.accounts.length).toBe(1);
      const sipp = res.data.accounts[0];
      expect(sipp.account_type).toBe("sipp");
      expect(sipp.cash_balance).toBe(10000);
      expect(sipp.warn_cash).toBe(5000);
      expect(sipp.cash_warning).toBe(false); // 10000 >= 5000
    });

    test("returns totals with cash only (no holdings)", async function () {
      const res = await api(`/api/portfolio/summary/${userId}`);
      expect(res.data.totals.investments).toBe(0);
      expect(res.data.totals.cash).toBe(10000);
      expect(res.data.totals.grand_total).toBe(10000);
    });

    test("returns 404 for non-existent user", async function () {
      const res = await api("/api/portfolio/summary/99999");
      expect(res.status).toBe(404);
      expect(res.data.error).toBe("User not found");
    });

    test("returns 400 for invalid user ID", async function () {
      const res = await api("/api/portfolio/summary/abc");
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("Invalid user ID");
    });

    test("returns 400 for negative user ID", async function () {
      const res = await api("/api/portfolio/summary/-1");
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("Invalid user ID");
    });
  });

  describe("GET /api/portfolio/summary", function () {
    test("returns 200 with array of summaries", async function () {
      const res = await api("/api/portfolio/summary");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(1);
    });

    test("each summary has required fields", async function () {
      const res = await api("/api/portfolio/summary");
      const summary = res.data[0];
      expect(summary.user).toBeDefined();
      expect(summary.user.id).toBeDefined();
      expect(summary.user.first_name).toBeDefined();
      expect(summary.valuation_date).toBeDefined();
      expect(Array.isArray(summary.accounts)).toBe(true);
      expect(summary.totals.investments).toBeDefined();
      expect(summary.totals.cash).toBeDefined();
      expect(summary.totals.grand_total).toBeDefined();
    });
  });
});
