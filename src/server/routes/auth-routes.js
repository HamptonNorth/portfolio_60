import { isFirstRun, getAuthStatus, setAuthStatus, hashPassphrase, verifyPassphrase, loadHashFromEnv, saveHashToEnv } from "../auth.js";
import { databaseExists, createDatabase } from "../db/connection.js";
import { isTestMode, activateTestMode, testReferenceExists } from "../test-mode.js";

/**
 * @description Check if a passphrase value is the test mode trigger.
 * @param {string} passphrase - The passphrase to check
 * @returns {boolean} True if the passphrase is "test" (case-insensitive)
 */
function isTestPassphrase(passphrase) {
  return typeof passphrase === "string" && passphrase.toLowerCase() === "test";
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

  // GET /api/auth/test-mode — returns whether the current session is in test mode
  if (method === "GET" && path === "/api/auth/test-mode") {
    return new Response(
      JSON.stringify({
        testMode: isTestMode(),
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

    // Test mode bypass — enter test mode without setting a hash
    if (isTestPassphrase(passphrase)) {
      if (!testReferenceExists()) {
        return new Response(
          JSON.stringify({
            error: "Test mode not available",
            detail: "No test reference data found. The test database has not been set up yet.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      activateTestMode();
      setAuthStatus(true);
      return new Response(JSON.stringify({ success: true, testMode: true, message: "Test mode activated" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

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

    // Test mode bypass — enter test mode without verifying hash
    if (isTestPassphrase(passphrase)) {
      if (!testReferenceExists()) {
        return new Response(
          JSON.stringify({
            error: "Test mode not available",
            detail: "No test reference data found. The test database has not been set up yet.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      activateTestMode();
      setAuthStatus(true);
      return new Response(JSON.stringify({ success: true, testMode: true, message: "Test mode activated" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

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
      setAuthStatus(true);
      return new Response(JSON.stringify({ success: true, message: "Passphrase verified" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: false, error: "Incorrect passphrase" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // No matching auth route
  return null;
}
