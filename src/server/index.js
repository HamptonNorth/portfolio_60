import { SERVER_PORT } from "../shared/constants.js";
import { resolve, join } from "node:path";
import { checkAuth } from "./middleware/auth-middleware.js";
import { handleAuthRoute } from "./routes/auth-routes.js";
import { handleDbRoute } from "./routes/db-routes.js";
import { handleUsersRoute } from "./routes/users-routes.js";
import { handleConfigRoute } from "./routes/config-routes.js";
import { handleInvestmentsRoute } from "./routes/investments-routes.js";
import { handleCurrenciesRoute } from "./routes/currencies-routes.js";
import { handleGlobalEventsRoute } from "./routes/global-events-routes.js";
import { handleScraperRoute } from "./routes/scraper-routes.js";
import { handleBackupRoute } from "./routes/backup-routes.js";

/**
 * @description The port the server listens on.
 * Uses the PORT environment variable if set (e.g. for testing on 1429),
 * otherwise falls back to SERVER_PORT (1420) from constants.
 * @type {number}
 */
const port = parseInt(process.env.PORT, 10) || SERVER_PORT;

/**
 * @description Root directory for serving static UI files
 * @type {string}
 */
const UI_ROOT = resolve("src/ui");

/**
 * @description Determine the MIME type for a file based on its extension.
 * Falls back to "application/octet-stream" for unknown types.
 * @param {string} filePath - The file path to check
 * @returns {string} The MIME type string
 */
function getMimeType(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  const mimeTypes = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * @description Serve a static file from the UI directory.
 * Returns the file with the correct Content-Type header, or a 404 response.
 * @param {string} relativePath - The path relative to the UI root (e.g. "/css/output.css")
 * @returns {Promise<Response>} The HTTP response
 */
async function serveStaticFile(relativePath) {
  // Prevent directory traversal attacks
  const safePath = relativePath.replace(/\.\./g, "");
  const fullPath = join(UI_ROOT, safePath);

  // Ensure the resolved path is still within UI_ROOT
  if (!fullPath.startsWith(UI_ROOT)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(fullPath);
  const exists = await file.exists();

  if (!exists) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file, {
    headers: { "Content-Type": getMimeType(fullPath) },
  });
}

/**
 * @description Main HTTP server for Portfolio 60.
 * Handles static file serving for the UI and routes API requests.
 */
const server = Bun.serve({
  port: port,

  /**
   * @description Handle incoming HTTP requests.
   * Routes to static files or API handlers based on the URL path.
   * @param {Request} request - The incoming HTTP request
   * @returns {Promise<Response>} The HTTP response
   */
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- Auth gate ---
    // Check if the route requires authentication and redirect if not authenticated.
    // Unprotected routes (auth API, scraper API, static assets) pass through.
    const authResponse = checkAuth(path);
    if (authResponse) {
      return authResponse;
    }

    // --- Static file routes ---

    // Home page
    if (path === "/" || path === "/index.html") {
      return serveStaticFile("/index.html");
    }

    // CSS files
    if (path.startsWith("/css/")) {
      return serveStaticFile(path);
    }

    // JavaScript files
    if (path.startsWith("/js/")) {
      return serveStaticFile(path);
    }

    // Image files
    if (path.startsWith("/images/")) {
      return serveStaticFile(path);
    }

    // Page HTML files
    if (path.startsWith("/pages/")) {
      return serveStaticFile(path);
    }

    // --- API routes ---

    // Auth routes (set passphrase, verify, status)
    if (path.startsWith("/api/auth/")) {
      const authResult = await handleAuthRoute(method, path, request);
      if (authResult) {
        return authResult;
      }
    }

    // Database routes (status, create)
    if (path.startsWith("/api/db/")) {
      const dbResult = handleDbRoute(method, path);
      if (dbResult) {
        return dbResult;
      }
    }

    // Config routes (providers list, etc.)
    if (path.startsWith("/api/config/")) {
      const configResult = handleConfigRoute(method, path);
      if (configResult) {
        return configResult;
      }
    }

    // Users routes (CRUD)
    if (path.startsWith("/api/users")) {
      const usersResult = await handleUsersRoute(method, path, request);
      if (usersResult) {
        return usersResult;
      }
    }

    // Currency routes (CRUD)
    if (path.startsWith("/api/currencies")) {
      const currenciesResult = await handleCurrenciesRoute(method, path, request);
      if (currenciesResult) {
        return currenciesResult;
      }
    }

    // Investment routes (CRUD + investment types)
    if (path.startsWith("/api/investments") || path.startsWith("/api/investment-types")) {
      const investmentsResult = await handleInvestmentsRoute(method, path, request);
      if (investmentsResult) {
        return investmentsResult;
      }
    }

    // Global events routes (CRUD)
    if (path.startsWith("/api/global-events")) {
      const globalEventsResult = await handleGlobalEventsRoute(method, path, request);
      if (globalEventsResult) {
        return globalEventsResult;
      }
    }

    // Scraper routes (unprotected — no passphrase required)
    if (path.startsWith("/api/scraper/")) {
      const scraperResult = await handleScraperRoute(method, path, request);
      if (scraperResult) {
        return scraperResult;
      }
    }

    // Backup routes (backup, restore, list, delete)
    if (path.startsWith("/api/backup")) {
      const backupResult = await handleBackupRoute(method, path, request);
      if (backupResult) {
        return backupResult;
      }
    }

    // Placeholder for future API routes
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Not implemented" }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- Fallback: 404 ---
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Portfolio 60 server running on http://localhost:${server.port}`);
