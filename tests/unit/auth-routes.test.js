import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for auth-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1431;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path — avoids touching the user's real database.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/test-auth-routes.db");

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

  // Start the server with isolated test database
  serverProcess = Bun.spawn(["bun", "run", "src/server/index.js"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PORT: String(TEST_PORT), DB_PATH: TEST_DB_PATH },
  });

  // Wait for the server to be ready
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/status`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("Server did not start within the expected time");
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

describe("Auth Routes - status endpoint", () => {
  test("GET /api/auth/status returns isFirstRun true when no passphrase set", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/status`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.isFirstRun).toBe(true);
    expect(data.isAuthenticated).toBe(false);
  });
});

describe("Auth Routes - set passphrase", () => {
  test("POST /api/auth/set-passphrase with short passphrase returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/set-passphrase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "short" }),
    });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("Validation failed");
  });

  test("POST /api/auth/set-passphrase with valid passphrase succeeds and creates database", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/set-passphrase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "testpassphrase123" }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.databaseCreated).toBe(true);
  });

  test("POST /api/auth/set-passphrase rejects if passphrase already set", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/set-passphrase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "anotherpassphrase" }),
    });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("Passphrase already set");
  });
});

describe("Auth Routes - verify passphrase", () => {
  test("POST /api/auth/verify with correct passphrase succeeds", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "testpassphrase123" }),
    });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test("POST /api/auth/verify with incorrect passphrase returns 401", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "wrongpassphrase" }),
    });
    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.success).toBe(false);
  });
});

describe("Auth Routes - auth gate", () => {
  test("scraper routes are accessible without authentication", async () => {
    const response = await fetch(`${BASE_URL}/api/scraper/anything`, { redirect: "manual" });
    expect(response.status).toBe(501);
  });

  test("auth status endpoint is accessible without authentication", async () => {
    const response = await fetch(`${BASE_URL}/api/auth/status`);
    expect(response.status).toBe(200);
  });

  test("static assets (CSS, JS, images) are accessible without authentication", async () => {
    const cssResponse = await fetch(`${BASE_URL}/css/output.css`, { redirect: "manual" });
    expect(cssResponse.status).toBe(200);

    const jsResponse = await fetch(`${BASE_URL}/js/app.js`, { redirect: "manual" });
    expect(jsResponse.status).toBe(200);
  });
});
