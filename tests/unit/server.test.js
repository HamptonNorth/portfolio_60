import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for server.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1430;

/**
 * @description Base URL for the test server
 * @type {string}
 */
const BASE_URL = `http://localhost:${TEST_PORT}`;

/**
 * @description Test passphrase used for authentication during tests
 * @type {string}
 */
const TEST_PASSPHRASE = "testpass1234";

/**
 * @description Path to the .env file
 * @type {string}
 */
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path — avoids touching the user's real database.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/portfolio_60_test/test-server.db");

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
      const response = await fetch(BASE_URL + "/api/auth/status");
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

  // Authenticate (also creates test database)
  await fetch(BASE_URL + "/api/auth/set-passphrase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase: TEST_PASSPHRASE }),
  });

  await fetch(BASE_URL + "/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase: TEST_PASSPHRASE }),
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

describe("Server - static file serving", () => {
  test("GET / returns 200 with HTML content", async () => {
    const response = await fetch(BASE_URL + "/");
    expect(response.status).toBe(200);

    const contentType = response.headers.get("Content-Type");
    expect(contentType).toContain("text/html");

    const text = await response.text();
    expect(text).toContain("Portfolio 60");
    expect(text).toContain('lang="en-GB"');
  });

  test("GET /index.html returns same as GET /", async () => {
    const response = await fetch(BASE_URL + "/index.html");
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain("Portfolio 60");
  });

  test("GET /css/output.css returns CSS with correct Content-Type", async () => {
    const response = await fetch(BASE_URL + "/css/output.css");
    expect(response.status).toBe(200);

    const contentType = response.headers.get("Content-Type");
    expect(contentType).toContain("text/css");
  });

  test("GET /js/app.js returns JavaScript with correct Content-Type", async () => {
    const response = await fetch(BASE_URL + "/js/app.js");
    expect(response.status).toBe(200);

    const contentType = response.headers.get("Content-Type");
    expect(contentType).toContain("text/javascript");

    const text = await response.text();
    expect(text).toContain("highlightActiveNav");
  });

  test("GET /pages/users.html returns the users page", async () => {
    const response = await fetch(BASE_URL + "/pages/users.html");
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain("Users");
  });

  test("GET /pages/passphrase.html returns the passphrase page", async () => {
    const response = await fetch(BASE_URL + "/pages/passphrase.html");
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain("Portfolio 60");
  });
});

describe("Server - 404 handling", () => {
  test("GET /nonexistent returns 404", async () => {
    const response = await fetch(BASE_URL + "/nonexistent");
    expect(response.status).toBe(404);
  });

  test("GET /css/nonexistent.css returns 404", async () => {
    const response = await fetch(BASE_URL + "/css/nonexistent.css");
    expect(response.status).toBe(404);
  });

  test("GET /pages/nonexistent.html returns 404", async () => {
    const response = await fetch(BASE_URL + "/pages/nonexistent.html");
    expect(response.status).toBe(404);
  });
});

describe("Server - API placeholder", () => {
  test("GET /api/anything returns 501 not implemented", async () => {
    const response = await fetch(BASE_URL + "/api/anything");
    expect(response.status).toBe(501);

    const data = await response.json();
    expect(data.error).toBe("Not implemented");
  });
});

describe("Server - security", () => {
  test("directory traversal attempts are blocked", async () => {
    const response = await fetch(BASE_URL + "/css/../../package.json");
    // Should either return 404 or 403, not the file contents
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
