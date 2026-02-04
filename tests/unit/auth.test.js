import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isFirstRun, hashPassphrase, verifyPassphrase, loadHashFromEnv, saveHashToEnv, getAuthStatus, setAuthStatus } from "../../src/server/auth.js";

/**
 * @description Path to the .env file used in tests.
 * Tests run from the project root so this resolves to the project .env file.
 * We back it up and restore it around each test.
 * @type {string}
 */
const ENV_PATH = resolve(".env");

/**
 * @description Backup of the original .env content, or null if it didn't exist
 * @type {string|null}
 */
let envBackup = null;

beforeEach(() => {
  // Back up the existing .env content if present
  if (existsSync(ENV_PATH)) {
    envBackup = readFileSync(ENV_PATH, "utf-8");
    unlinkSync(ENV_PATH);
  } else {
    envBackup = null;
  }
  // Reset auth status
  setAuthStatus(false);
});

afterEach(() => {
  // Remove test .env
  if (existsSync(ENV_PATH)) {
    unlinkSync(ENV_PATH);
  }
  // Restore original .env if it existed
  if (envBackup !== null) {
    writeFileSync(ENV_PATH, envBackup, "utf-8");
  }
});

describe("Auth - isFirstRun", () => {
  test("returns true when no .env file exists", () => {
    expect(isFirstRun()).toBe(true);
  });

  test("returns true when .env exists but APP_PASSPHRASE_HASH is empty", () => {
    writeFileSync(ENV_PATH, "APP_PASSPHRASE_HASH=\n", "utf-8");
    expect(isFirstRun()).toBe(true);
  });

  test("returns false when APP_PASSPHRASE_HASH has a value", () => {
    writeFileSync(ENV_PATH, "APP_PASSPHRASE_HASH=somehashvalue\n", "utf-8");
    expect(isFirstRun()).toBe(false);
  });
});

describe("Auth - hashPassphrase and verifyPassphrase", () => {
  test("hashPassphrase returns a non-empty string", async () => {
    const hash = await hashPassphrase("testpassphrase");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("verifyPassphrase returns true for correct passphrase", async () => {
    const hash = await hashPassphrase("correctpassphrase");
    const result = await verifyPassphrase("correctpassphrase", hash);
    expect(result).toBe(true);
  });

  test("verifyPassphrase returns false for incorrect passphrase", async () => {
    const hash = await hashPassphrase("correctpassphrase");
    const result = await verifyPassphrase("wrongpassphrase", hash);
    expect(result).toBe(false);
  });
});

describe("Auth - loadHashFromEnv and saveHashToEnv", () => {
  test("loadHashFromEnv returns empty string when no .env file", () => {
    expect(loadHashFromEnv()).toBe("");
  });

  test("saveHashToEnv creates .env file with hash", () => {
    saveHashToEnv("testhash123");
    expect(existsSync(ENV_PATH)).toBe(true);
    expect(loadHashFromEnv()).toBe("testhash123");
  });

  test("saveHashToEnv updates existing hash in .env file", () => {
    writeFileSync(ENV_PATH, "APP_PASSPHRASE_HASH=oldhash\nOTHER_VAR=keepme\n", "utf-8");
    saveHashToEnv("newhash456");
    expect(loadHashFromEnv()).toBe("newhash456");

    // Verify other variables are preserved
    const fileContent = readFileSync(ENV_PATH, "utf-8");
    expect(fileContent).toContain("OTHER_VAR=keepme");
  });
});

describe("Auth - getAuthStatus and setAuthStatus", () => {
  test("getAuthStatus returns false by default", () => {
    expect(getAuthStatus()).toBe(false);
  });

  test("setAuthStatus changes the auth status", () => {
    setAuthStatus(true);
    expect(getAuthStatus()).toBe(true);

    setAuthStatus(false);
    expect(getAuthStatus()).toBe(false);
  });
});
