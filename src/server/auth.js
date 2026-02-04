import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Path to the .env file in the project root
 * @type {string}
 */
const ENV_PATH = resolve(".env");

/**
 * @description In-memory flag tracking whether the user has authenticated
 * this session. Resets on server restart (by design for a desktop app).
 * @type {boolean}
 */
let isAuthenticated = false;

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
 * @description Load the passphrase hash from the .env file.
 * Reads the file line by line looking for APP_PASSPHRASE_HASH=<value>.
 * Returns an empty string if the file doesn't exist or the key is not found.
 * @returns {string} The stored hash, or empty string if not found
 */
export function loadHashFromEnv() {
  if (!existsSync(ENV_PATH)) {
    return "";
  }

  const content = readFileSync(ENV_PATH, "utf-8");
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("APP_PASSPHRASE_HASH=")) {
      return trimmed.substring("APP_PASSPHRASE_HASH=".length);
    }
  }

  return "";
}

/**
 * @description Save a passphrase hash to the .env file.
 * If the file exists, updates the APP_PASSPHRASE_HASH line.
 * If the file doesn't exist, creates it with the hash.
 * @param {string} hash - The hash string to save
 */
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
