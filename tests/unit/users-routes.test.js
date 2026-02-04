import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Port for users-routes.test.js — unique per test file.
 * @type {number}
 */
const TEST_PORT = 1432;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const ENV_PATH = resolve(".env");

/**
 * @description Isolated test database path — avoids touching the user's real database.
 * @type {string}
 */
const TEST_DB_PATH = resolve("data/test-users-routes.db");

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
    await new Promise((resolve) => setTimeout(resolve, 200));
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

describe("Users Routes - CRUD", () => {
  let createdUserId;

  test("GET /api/users returns empty array initially", async () => {
    const response = await fetch(`${BASE_URL}/api/users`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual([]);
  });

  test("POST /api/users creates a user", async () => {
    const response = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "JDS",
        first_name: "John",
        last_name: "Smith",
        provider: "ii",
        ni_number: "AB123456C",
      }),
    });
    expect(response.status).toBe(201);
    const user = await response.json();
    expect(user.id).toBeGreaterThan(0);
    expect(user.initials).toBe("JDS");
    expect(user.first_name).toBe("John");
    createdUserId = user.id;
  });

  test("POST /api/users with missing required fields returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initials: "X" }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Validation failed");
  });

  test("POST /api/users with field too long returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "TOOLONG",
        first_name: "Test",
        last_name: "User",
        provider: "ii",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Initials");
  });

  test("GET /api/users returns the created user", async () => {
    const response = await fetch(`${BASE_URL}/api/users`);
    expect(response.status).toBe(200);
    const users = await response.json();
    expect(users.length).toBe(1);
    expect(users[0].initials).toBe("JDS");
  });

  test("GET /api/users/:id returns the user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${createdUserId}`);
    expect(response.status).toBe(200);
    const user = await response.json();
    expect(user.id).toBe(createdUserId);
    expect(user.first_name).toBe("John");
  });

  test("GET /api/users/:id returns 404 for non-existent user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/9999`);
    expect(response.status).toBe(404);
  });

  test("PUT /api/users/:id updates the user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${createdUserId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "JDS",
        first_name: "Jonathan",
        last_name: "Smith",
        provider: "hl",
      }),
    });
    expect(response.status).toBe(200);
    const user = await response.json();
    expect(user.first_name).toBe("Jonathan");
    expect(user.provider).toBe("hl");
  });

  test("PUT /api/users/:id returns 404 for non-existent user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/9999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "XX",
        first_name: "No",
        last_name: "One",
        provider: "ii",
      }),
    });
    expect(response.status).toBe(404);
  });

  test("POST /api/users with invalid provider returns 400", async () => {
    const response = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initials: "XX",
        first_name: "Test",
        last_name: "User",
        provider: "zz",
      }),
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.detail).toContain("Provider must be one of");
  });

  test("DELETE /api/users/:id deletes the user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/${createdUserId}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.message).toBe("User deleted");
  });

  test("DELETE /api/users/:id returns 404 for non-existent user", async () => {
    const response = await fetch(`${BASE_URL}/api/users/9999`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
});
