import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { DATA_DIR } from "../shared/server-constants.js";

/**
 * @description Path to the .env file. Uses the DATA_DIR base directory so that
 * in Flatpak mode the .env file is written to the writable data location
 * (~/.config/portfolio_60/.env) rather than the read-only app bundle.
 * @type {string}
 */
const ENV_PATH = resolve(join(DATA_DIR, ".env"));

/**
 * @description In-memory flag tracking whether the user has authenticated
 * this session. Resets on server restart (by design for a desktop app).
 * @type {boolean}
 */
let isAuthenticated = false;

/**
 * @description Maximum number of failed passphrase attempts before lockout.
 * @type {number}
 */
const MAX_FAILED_ATTEMPTS = 5;

/**
 * @description Lockout duration in milliseconds (4 hours).
 * @type {number}
 */
const LOCKOUT_DURATION_MS = 4 * 60 * 60 * 1000;

/**
 * @description Tracks failed verification attempts for brute-force protection.
 * Resets on successful auth or server restart.
 * @type {{ count: number, lockedUntil: number | null }}
 */
const failedAttempts = { count: 0, lockedUntil: null };

/**
 * @description Check if this is the first run (no passphrase hash stored).
 * Reads the .env file and checks for a non-empty APP_PASSPHRASE_HASH value.
 * @returns {boolean} True if no hash has been set yet
 */
export function isFirstRun() {
  const hash = loadHashFromEnv();
  return !hash || hash.trim() === "";
}

/**
 * @description Get the current authentication status.
 * @returns {boolean} True if the user has authenticated this session
 */
export function getAuthStatus() {
  return isAuthenticated;
}

/**
 * @description Set the authentication status.
 * @param {boolean} status - The new authentication status
 */
export function setAuthStatus(status) {
  isAuthenticated = status;
}

/**
 * @description Hash a plaintext passphrase using Bun's built-in argon2id.
 * @param {string} plaintext - The passphrase to hash
 * @returns {Promise<string>} The hashed passphrase string
 */
export async function hashPassphrase(plaintext) {
  return await Bun.password.hash(plaintext);
}

/**
 * @description Verify a plaintext passphrase against a stored hash.
 * Uses Bun's built-in password verification which supports argon2id and bcrypt.
 * @param {string} plaintext - The passphrase to verify
 * @param {string} hash - The stored hash to verify against
 * @returns {Promise<boolean>} True if the passphrase matches the hash
 */
export async function verifyPassphrase(plaintext, hash) {
  return await Bun.password.verify(plaintext, hash);
}

/**
 * @description Load a value from the .env file by key name.
 * Reads the file line by line looking for KEY=value.
 * Returns an empty string if the file doesn't exist or the key is not found.
 * @param {string} key - The environment variable name to look for
 * @returns {string} The value, or empty string if not found
 */
export function loadEnvValue(key) {
  if (!existsSync(ENV_PATH)) {
    return "";
  }

  const content = readFileSync(ENV_PATH, "utf-8");
  const lines = content.split("\n");
  const prefix = key + "=";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.substring(prefix.length);
    }
  }

  return "";
}

/**
 * @description Load the passphrase hash from the .env file.
 * Reads the file line by line looking for APP_PASSPHRASE_HASH=<value>.
 * Returns an empty string if the file doesn't exist or the key is not found.
 * @returns {string} The stored hash, or empty string if not found
 */
export function loadHashFromEnv() {
  return loadEnvValue("APP_PASSPHRASE_HASH");
}

/**
 * @description Save a passphrase hash to the .env file.
 * If the file exists, updates the APP_PASSPHRASE_HASH line.
 * If the file doesn't exist, creates it with the hash.
 * @param {string} hash - The hash string to save
 */
/**
 * @description Check whether the verify endpoint is currently locked out
 * due to too many failed attempts.
 * @returns {{ locked: boolean, remainingMs: number }} locked is true if
 *   currently in lockout period; remainingMs is milliseconds until unlock
 */
export function checkLockout() {
  if (failedAttempts.lockedUntil === null) {
    return { locked: false, remainingMs: 0 };
  }
  const now = Date.now();
  if (now >= failedAttempts.lockedUntil) {
    // Lockout has expired — reset
    failedAttempts.count = 0;
    failedAttempts.lockedUntil = null;
    return { locked: false, remainingMs: 0 };
  }
  return { locked: true, remainingMs: failedAttempts.lockedUntil - now };
}

/**
 * @description Record a failed passphrase attempt. If the failure count
 * reaches MAX_FAILED_ATTEMPTS, starts a lockout period.
 */
export function recordFailedAttempt() {
  failedAttempts.count += 1;
  if (failedAttempts.count >= MAX_FAILED_ATTEMPTS) {
    failedAttempts.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
}

/**
 * @description Reset the failed-attempt counter (called on successful auth).
 */
export function resetFailedAttempts() {
  failedAttempts.count = 0;
  failedAttempts.lockedUntil = null;
}

/**
 * @description Get the current number of failed attempts (for testing/diagnostics).
 * @returns {number}
 */
export function getFailedAttemptCount() {
  return failedAttempts.count;
}

export function saveHashToEnv(hash) {
  if (!existsSync(ENV_PATH)) {
    // Create a new .env file with the hash
    writeFileSync(ENV_PATH, `APP_PASSPHRASE_HASH=${hash}\n`, "utf-8");
    return;
  }

  // Read the existing file and update or append the hash line
  const content = readFileSync(ENV_PATH, "utf-8");
  const lines = content.split("\n");
  let found = false;

  const updatedLines = lines.map(function (line) {
    if (line.trim().startsWith("APP_PASSPHRASE_HASH=")) {
      found = true;
      return `APP_PASSPHRASE_HASH=${hash}`;
    }
    return line;
  });

  if (!found) {
    updatedLines.push(`APP_PASSPHRASE_HASH=${hash}`);
  }

  writeFileSync(ENV_PATH, updatedLines.join("\n"), "utf-8");
}
