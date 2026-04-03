import { Cron } from "croner";
import { upsertDailyVisitors } from "../db/daily-visitors-db.js";

/**
 * @description Daily salt for hashing visitor IPs. Regenerated each midnight
 * so that hashes cannot be correlated across days. Never persisted to disk.
 * @type {string}
 */
let dailySalt = generateSalt();

/**
 * @description Set of hashed visitor tokens for en-GB users today.
 * @type {Set<string>}
 */
let enGbSet = new Set();

/**
 * @description Set of hashed visitor tokens for non-en-GB users today.
 * @type {Set<string>}
 */
let otherSet = new Set();

/**
 * @description The current date string (YYYY-MM-DD) that the in-memory
 * Sets correspond to. Used to detect day rollover between cron ticks.
 * @type {string}
 */
let currentDate = todayString();

/**
 * @description The active Croner job instance for midnight flushing,
 * or null if not yet initialised.
 * @type {Cron|null}
 */
let cronJob = null;

/**
 * @description Generate a random salt string for visitor hashing.
 * Uses crypto.randomUUID() for sufficient entropy. The salt is
 * ephemeral (never stored) so cryptographic strength is not required.
 * @returns {string} A random UUID string
 */
function generateSalt() {
  return crypto.randomUUID();
}

/**
 * @description Get today's date as an ISO-8601 string (YYYY-MM-DD).
 * @returns {string} Today's date
 */
function todayString() {
  return new Date().toISOString().split("T")[0];
}

/**
 * @description Track a visitor from an incoming HTTP request. Extracts
 * the client IP and Accept-Language header, hashes the IP with the
 * daily salt, and adds it to the appropriate Set. This function is
 * synchronous and does not access the database.
 * @param {Request} request - The incoming HTTP request
 */
export function trackVisitor(request) {
  // Only track page navigations, not static assets or API calls
  const url = new URL(request.url);
  const path = url.pathname;

  if (path !== "/" && path !== "/index.html" && !path.startsWith("/pages/")) {
    return;
  }

  // Detect day rollover (edge case: server crosses midnight between cron ticks)
  const today = todayString();
  if (today !== currentDate) {
    flushVisitorCounts();
  }

  // Extract client IP from Cloudflare or proxy headers
  const ip = request.headers.get("cf-connecting-ip")
    || extractFirstForwardedIp(request.headers.get("x-forwarded-for"))
    || "unknown";

  // Hash the IP with today's salt — non-cryptographic, ephemeral, GDPR-safe
  const token = String(Bun.hash(ip + ":" + dailySalt));

  // Check Accept-Language for en-GB (primary language)
  const acceptLang = (request.headers.get("accept-language") || "").toLowerCase();
  if (acceptLang.startsWith("en-gb")) {
    enGbSet.add(token);
  } else {
    otherSet.add(token);
  }
}

/**
 * @description Extract the first IP address from an X-Forwarded-For header
 * value. The header may contain a comma-separated list of IPs; the first
 * is the original client IP.
 * @param {string|null} header - The X-Forwarded-For header value
 * @returns {string|null} The first IP, or null if the header is absent
 */
function extractFirstForwardedIp(header) {
  if (!header) {
    return null;
  }
  const first = header.split(",")[0].trim();
  return first || null;
}

/**
 * @description Flush the current in-memory visitor counts to the database,
 * then reset the Sets and rotate the daily salt. Called at midnight by the
 * Croner job, and on graceful shutdown.
 */
export function flushVisitorCounts() {
  const enGbCount = enGbSet.size;
  const otherCount = otherSet.size;

  // Only write if there were any visitors
  if (enGbCount > 0 || otherCount > 0) {
    upsertDailyVisitors(currentDate, enGbCount, otherCount);
    console.log(
      "[Visitors] Flushed " + currentDate + ": " +
      enGbCount + " en-GB, " + otherCount + " other"
    );
  }

  // Reset for the new day
  enGbSet = new Set();
  otherSet = new Set();
  dailySalt = generateSalt();
  currentDate = todayString();
}

/**
 * @description Initialise the visitor tracker. Creates a Croner job that
 * fires at midnight each day to flush counts to the database.
 */
export function initVisitorTracker() {
  cronJob = new Cron("0 0 * * *", function () {
    flushVisitorCounts();
  });
  console.log("[Visitors] Tracker initialised — flushing daily at midnight");
}

/**
 * @description Stop the visitor tracker. Flushes any partial-day counts
 * to the database and stops the Croner job. Call this during graceful
 * shutdown before closing the database.
 */
export function stopVisitorTracker() {
  flushVisitorCounts();
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}
