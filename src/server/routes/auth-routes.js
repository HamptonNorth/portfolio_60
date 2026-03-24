import { isFirstRun, getAuthStatus, setAuthStatus, hashPassphrase, verifyPassphrase, loadHashFromEnv, saveHashToEnv, checkLockout, recordFailedAttempt, resetFailedAttempts } from "../auth.js";
import { databaseExists, createDatabase, getDatabase } from "../db/connection.js";
import { isTestMode, isDemoMode, activateTestMode, deactivateTestMode, isTestDatabaseFresh, setDemoMode, testReferenceExists } from "../test-mode.js";
import { getDocsConfig } from "../config.js";
import { reindexAllPages } from "../services/docs-search.js";

/**
 * @description Classify a passphrase as a special mode trigger.
 * Returns "demo" for read-only demo mode, "test" for read-only test mode
 * (creates DB if needed), "test-write" for write-enabled test mode,
 * or null for a normal passphrase.
 * @param {string} passphrase - The passphrase to check
 * @returns {string|null} Mode string or null
 */
function classifyPassphrase(passphrase) {
  if (typeof passphrase !== "string") return null;
  var lower = passphrase.toLowerCase();
  if (lower === "demo") return "demo";
  if (lower === "test") return "test";
  if (passphrase === "test$rnc") return "test-write";
  return null;
}

/**
 * @description Handle activation of a special mode (demo, test, or test-write).
 * Returns a Response if activation succeeds or fails, or null if not a special passphrase.
 * @param {string} passphrase - The raw passphrase value
 * @returns {Response|null} Response if handled, null if not a special passphrase
 */
function handleSpecialPassphrase(passphrase) {
  var mode = classifyPassphrase(passphrase);
  if (!mode) return null;

  // "demo" and "test" (both read-only) require the test DB to already exist
  if ((mode === "demo" || mode === "test") && !testReferenceExists()) {
    return new Response(
      JSON.stringify({
        error: "Demo database not found",
        detail: "The demo database has not been created yet. Enter the developer test passphrase to create it first.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Activate test mode (creates DB if needed for "test" and "test-write")
  if (!activateTestMode()) {
    return new Response(
      JSON.stringify({
        error: "Test mode failed",
        detail: "Could not create or activate the test database.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Set demo (read-only) flag for "demo" and "test" modes
  var isReadOnly = mode === "demo" || mode === "test";
  setDemoMode(isReadOnly);

  // Reindex docs search for the new database/docs directory (fire-and-forget)
  var docsConfig = getDocsConfig();
  if (docsConfig.categories && Object.keys(docsConfig.categories).length > 0) {
    reindexAllPages(getDatabase(), docsConfig.categories).catch(function () {});
  }

  setAuthStatus(true);
  var fresh = isTestDatabaseFresh();
  var message;
  if (fresh) {
    message = "Test mode activated. New database created — run Fetch All to populate prices.";
  } else if (isReadOnly) {
    message = "Demo mode activated — read-only";
  } else {
    message = "Test mode activated (write-enabled)";
  }

  return new Response(
    JSON.stringify({
      success: true,
      testMode: true,
      demoMode: isReadOnly,
      freshDatabase: fresh,
      message: message,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * @description Handle authentication API routes.
 * All auth routes are unprotected (accessible without passphrase)
 * because they are the mechanism for gaining access.
 * @param {string} method - The HTTP method (GET, POST, etc.)
 * @param {string} path - The URL pathname
 * @param {Request} request - The incoming HTTP request
 * @returns {Promise<Response|null>} A Response if the route matched, or null
 */
export async function handleAuthRoute(method, path, request) {
  // GET /api/auth/status — returns current auth state
  if (method === "GET" && path === "/api/auth/status") {
    return new Response(
      JSON.stringify({
        isFirstRun: isFirstRun(),
        isAuthenticated: getAuthStatus(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // GET /api/auth/test-mode — returns whether the current session is in test or demo mode
  if (method === "GET" && path === "/api/auth/test-mode") {
    return new Response(
      JSON.stringify({
        testMode: isTestMode(),
        demoMode: isDemoMode(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // POST /api/auth/set-passphrase — set the passphrase on first run
  if (method === "POST" && path === "/api/auth/set-passphrase") {
    // Only allow setting passphrase if none has been set yet
    if (!isFirstRun()) {
      return new Response(
        JSON.stringify({
          error: "Passphrase already set",
          detail: "A passphrase has already been configured. Use the verify endpoint to authenticate.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const passphrase = body.passphrase;

    // Special mode bypass — demo, test, or test-write without setting a hash
    var specialResponse = handleSpecialPassphrase(passphrase);
    if (specialResponse) return specialResponse;

    if (!passphrase || typeof passphrase !== "string" || passphrase.length < 8) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          detail: "Passphrase must be at least 8 characters long",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Hash and save the passphrase
    const hash = await hashPassphrase(passphrase);
    saveHashToEnv(hash);
    setAuthStatus(true);

    // On first run, also create the database if it doesn't exist yet
    let dbCreated = false;
    if (!databaseExists()) {
      try {
        createDatabase();
        dbCreated = true;
      } catch (dbErr) {
        return new Response(
          JSON.stringify({
            error: "Passphrase set but database creation failed",
            detail: dbErr.message,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Passphrase set successfully",
        databaseCreated: dbCreated,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // POST /api/auth/verify — verify passphrase on subsequent runs
  if (method === "POST" && path === "/api/auth/verify") {
    // Brute-force protection — check lockout before doing anything
    const lockout = checkLockout();
    if (lockout.locked) {
      const remainingMinutes = Math.ceil(lockout.remainingMs / 60000);
      const hours = Math.floor(remainingMinutes / 60);
      const minutes = remainingMinutes % 60;
      const timeText = hours > 0
        ? `${hours} hour${hours !== 1 ? "s" : ""}${minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? "s" : ""}` : ""}`
        : `${minutes} minute${minutes !== 1 ? "s" : ""}`;
      return new Response(
        JSON.stringify({
          success: false,
          error: "Too many failed attempts",
          detail: `Account locked. Try again in ${timeText}.`,
          locked: true,
          remainingMs: lockout.remainingMs,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const passphrase = body.passphrase;
    if (!passphrase || typeof passphrase !== "string") {
      return new Response(JSON.stringify({ error: "Validation failed", detail: "Passphrase is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Special mode bypass — demo, test, or test-write without verifying hash
    var specialResponse = handleSpecialPassphrase(passphrase);
    if (specialResponse) return specialResponse;

    const storedHash = loadHashFromEnv();
    if (!storedHash) {
      return new Response(
        JSON.stringify({
          error: "No passphrase configured",
          detail: "No passphrase has been set. Use the set-passphrase endpoint first.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const isValid = await verifyPassphrase(passphrase, storedHash);

    if (isValid) {
      resetFailedAttempts();
      // If switching from test mode back to live, deactivate test mode first
      if (isTestMode()) {
        deactivateTestMode();
        // Reindex docs search for the live database/docs directory
        var liveDocsConfig = getDocsConfig();
        if (liveDocsConfig.categories && Object.keys(liveDocsConfig.categories).length > 0) {
          reindexAllPages(getDatabase(), liveDocsConfig.categories).catch(function () {});
        }
      }
      setAuthStatus(true);
      return new Response(JSON.stringify({ success: true, message: "Passphrase verified" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    recordFailedAttempt();

    // Check if this failure triggered a lockout
    const newLockout = checkLockout();
    if (newLockout.locked) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Too many failed attempts",
          detail: "Account locked for 4 hours due to repeated incorrect attempts.",
          locked: true,
          remainingMs: newLockout.remainingMs,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: false, error: "Incorrect passphrase" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // POST /api/auth/sign-out — clear authentication, return to passphrase screen
  if (method === "POST" && path === "/api/auth/sign-out") {
    setAuthStatus(false);
    return new Response(
      JSON.stringify({ success: true, message: "Signed out" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // No matching auth route
  return null;
}
