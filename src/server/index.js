import { SERVER_PORT, getDocsMediaDir } from "../shared/server-constants.js";
import { resolve, join } from "node:path";
import { readdir } from "node:fs/promises";
import { checkAuth, checkDemoBlock } from "./middleware/auth-middleware.js";
import { handleAuthRoute } from "./routes/auth-routes.js";
import { handleDbRoute } from "./routes/db-routes.js";
import { handleUsersRoute } from "./routes/users-routes.js";
import { handleConfigRoute, handleConfigRouteAsync } from "./routes/config-routes.js";
import { handleInvestmentsRoute } from "./routes/investments-routes.js";
import { handleCurrenciesRoute } from "./routes/currencies-routes.js";
import { handleGlobalEventsRoute } from "./routes/global-events-routes.js";
import { handleFetchRoute } from "./routes/fetch-routes.js";
import { handleBackupRoute } from "./routes/backup-routes.js";
import { handleBenchmarksRoute } from "./routes/benchmarks-routes.js";
import { handleBackfillRoute } from "./routes/backfill-routes.js";
import { handleAccountsRoute } from "./routes/accounts-routes.js";
import { handleHoldingsRoute } from "./routes/holdings-routes.js";
import { handlePortfolioRoute } from "./routes/portfolio-routes.js";
import { handleCashTransactionsRoute } from "./routes/cash-transactions-routes.js";
import { handleDrawdownSchedulesRoute } from "./routes/drawdown-schedules-routes.js";
import { handleHoldingMovementsRoute } from "./routes/holding-movements-routes.js";
import { handleDocsRoute } from "./routes/docs-routes.js";
import { handleOtherAssetsRoute } from "./routes/other-assets-routes.js";
import { handleReportsRoute } from "./routes/reports-routes.js";
import { handlePortfolioDetailRoute } from "./routes/portfolio-detail-routes.js";
import { handleAnalysisRoute } from "./routes/analysis-routes.js";
import { handleTestSetupRoute } from "./routes/test-setup-routes.js";
import { initScheduledFetcher, stopScheduledFetcher } from "./services/scheduled-fetcher.js";
import { processDrawdowns } from "./services/drawdown-processor.js";
import { databaseExists, closeDatabase } from "./db/connection.js";
import { getFetchServerConfig, getDocsConfig, getListsDir } from "./config.js";
import { pushConfigToFetchServer } from "./services/fetch-server-push.js";
import { syncFromFetchServer } from "./services/fetch-server-sync.js";
import { reindexAllPages } from "./services/docs-search.js";
import { getDatabase } from "./db/connection.js";

/**
 * @description The port the server listens on.
 * Uses the PORT environment variable if set (e.g. for testing on 1429),
 * otherwise falls back to SERVER_PORT (1420) from constants.
 * @type {number}
 */
const port = parseInt(process.env.PORT, 10) || SERVER_PORT;

/**
 * @description The hostname/IP address the server binds to.
 * Uses the HOST environment variable if set. Defaults to "0.0.0.0" (all
 * interfaces). Set to "127.0.0.1" to restrict access to localhost only —
 * useful when the instance should not be reachable from the network.
 * @type {string}
 */
const hostname = process.env.HOST || "0.0.0.0";

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
  hostname: hostname,
  idleTimeout: 0, // disabled globally — SSE fetching streams are long-lived; per-request server.timeout(req, 0) also applied for stream endpoints

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
    // Unprotected routes (auth API, fetch API, static assets) pass through.
    const authResponse = checkAuth(path);
    if (authResponse) {
      return authResponse;
    }

    // --- Demo mode write block ---
    // In demo mode, block all non-GET requests (except auth routes).
    const demoResponse = checkDemoBlock(method, path);
    if (demoResponse) {
      return demoResponse;
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

    // Markdown style CSS files (for docs subsystem)
    if (path.startsWith("/css/md-styles/")) {
      return serveStaticFile(path);
    }

    // Docs media files (uploaded images) — served from docs/media/ on disk
    // Falls back to project-root docs/media/ for bundled assets (e.g. thumbnails)
    if (path.startsWith("/docs/media/")) {
      const safePath = path.replace(/\.\./g, "");
      const mediaPath = safePath.replace(/^\/docs\/media\//, "");
      const mediaRoot = resolve(getDocsMediaDir());
      const fullMediaPath = join(mediaRoot, mediaPath);
      if (!fullMediaPath.startsWith(mediaRoot)) {
        return new Response("Forbidden", { status: 403 });
      }
      const mediaFile = Bun.file(fullMediaPath);
      if (await mediaFile.exists()) {
        return new Response(mediaFile, {
          headers: { "Content-Type": getMimeType(fullMediaPath) },
        });
      }
      // Fallback: check project-root docs/media/ for bundled assets
      const projectMediaRoot = resolve("docs/media");
      const projectMediaPath = join(projectMediaRoot, mediaPath);
      if (projectMediaPath.startsWith(projectMediaRoot)) {
        const projectMediaFile = Bun.file(projectMediaPath);
        if (await projectMediaFile.exists()) {
          return new Response(projectMediaFile, {
            headers: { "Content-Type": getMimeType(projectMediaPath) },
          });
        }
      }
      return new Response("Not found", { status: 404 });
    }

    // Lists PDF files — served from docs/lists/ on disk
    if (path.startsWith("/docs/lists/")) {
      const safeListPath = path.replace(/\.\./g, "");
      const listFilePath = safeListPath.replace(/^\/docs\/lists\//, "");
      const listsRoot = resolve(getListsDir());
      const fullListPath = join(listsRoot, listFilePath);
      if (!fullListPath.startsWith(listsRoot)) {
        return new Response("Forbidden", { status: 403 });
      }
      const listFile = Bun.file(fullListPath);
      if (!(await listFile.exists())) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(listFile, {
        headers: { "Content-Type": "application/pdf" },
      });
    }

    // Page HTML files
    if (path.startsWith("/pages/")) {
      return serveStaticFile(path);
    }

    // --- API routes ---

    // Home page thumbnail listing (unprotected — used on welcome page)
    // Uses project root docs/media/ — these are bundled assets, not user data
    if (method === "GET" && path === "/api/home/thumbnails") {
      const thumbDir = resolve("docs/media");
      try {
        const files = await readdir(thumbDir);
        const thumbs = files
          .filter(function (f) { return /^thumb-\d+\.jpg$/i.test(f); })
          .sort();
        return Response.json(thumbs);
      } catch (_err) {
        return Response.json([]);
      }
    }

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
      // Try sync handler first
      const configResult = handleConfigRoute(method, path);
      if (configResult) {
        return configResult;
      }
      // Then try async handler (for POST requests with body)
      const configResultAsync = await handleConfigRouteAsync(method, path, request);
      if (configResultAsync) {
        return configResultAsync;
      }
    }

    // Analysis routes (league table, risk/return, top/bottom)
    if (path.startsWith("/api/analysis/")) {
      const analysisResult = await handleAnalysisRoute(method, path, request);
      if (analysisResult) {
        return analysisResult;
      }
    }

    // Portfolio routes (detail must be checked before summary since both start with /api/portfolio)
    if (path.startsWith("/api/portfolio/detail")) {
      const detailResult = await handlePortfolioDetailRoute(method, path, request);
      if (detailResult) {
        return detailResult;
      }
    }

    if (path.startsWith("/api/portfolio")) {
      const portfolioResult = await handlePortfolioRoute(method, path, request);
      if (portfolioResult) {
        return portfolioResult;
      }
    }

    // Accounts routes (nested under users and standalone)
    // Must be checked before users routes since /api/users/:id/accounts starts with /api/users
    if (path.startsWith("/api/users") && path.includes("/accounts")) {
      const accountsResult = await handleAccountsRoute(method, path, request);
      if (accountsResult) {
        return accountsResult;
      }
    }

    if (path.startsWith("/api/accounts")) {
      // Cash transaction routes (nested under accounts)
      if (path.includes("/cash-transactions")) {
        const cashTxResult = await handleCashTransactionsRoute(method, path, request);
        if (cashTxResult) {
          return cashTxResult;
        }
      }

      // Drawdown schedule routes (nested under accounts)
      if (path.includes("/drawdown-schedules")) {
        const drawdownResult = await handleDrawdownSchedulesRoute(method, path, request);
        if (drawdownResult) {
          return drawdownResult;
        }
      }

      // ISA allowance route (nested under accounts)
      if (path.includes("/isa-allowance")) {
        const isaResult = await handleCashTransactionsRoute(method, path, request);
        if (isaResult) {
          return isaResult;
        }
      }

      // Holdings routes (nested under accounts)
      if (path.includes("/holdings")) {
        const holdingsResult = await handleHoldingsRoute(method, path, request);
        if (holdingsResult) {
          return holdingsResult;
        }
      }

      // Standalone accounts routes
      const accountsResult = await handleAccountsRoute(method, path, request);
      if (accountsResult) {
        return accountsResult;
      }
    }

    // Cash transaction routes (standalone)
    if (path.startsWith("/api/cash-transactions")) {
      const cashTxResult = await handleCashTransactionsRoute(method, path, request);
      if (cashTxResult) {
        return cashTxResult;
      }
    }

    // Drawdown schedule routes (standalone)
    if (path.startsWith("/api/drawdown-schedules")) {
      const drawdownResult = await handleDrawdownSchedulesRoute(method, path, request);
      if (drawdownResult) {
        return drawdownResult;
      }
    }

    // Holding movement routes (standalone)
    if (path.startsWith("/api/holding-movements")) {
      const movementsResult = await handleHoldingMovementsRoute(method, path, request);
      if (movementsResult) {
        return movementsResult;
      }
    }

    // Holdings routes (standalone) — must check for /movements sub-path first
    if (path.startsWith("/api/holdings")) {
      // Holding movements nested under holdings
      if (path.includes("/movements")) {
        const movementsResult = await handleHoldingMovementsRoute(method, path, request);
        if (movementsResult) {
          return movementsResult;
        }
      }

      const holdingsResult = await handleHoldingsRoute(method, path, request);
      if (holdingsResult) {
        return holdingsResult;
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

    // Other assets routes (CRUD + summary)
    if (path.startsWith("/api/other-assets")) {
      const otherAssetsResult = await handleOtherAssetsRoute(method, path, request);
      if (otherAssetsResult) {
        return otherAssetsResult;
      }
    }

    // Views (HTML composite reports) and Reports (PDF reports)
    if (path.startsWith("/api/views") || path.startsWith("/api/reports")) {
      const reportsResult = await handleReportsRoute(method, path, request);
      if (reportsResult) {
        return reportsResult;
      }
    }

    // Global events routes (CRUD)
    if (path.startsWith("/api/global-events")) {
      const globalEventsResult = await handleGlobalEventsRoute(method, path, request);
      if (globalEventsResult) {
        return globalEventsResult;
      }
    }

    // Benchmarks routes (CRUD)
    if (path.startsWith("/api/benchmarks")) {
      const benchmarksResult = await handleBenchmarksRoute(method, path, request);
      if (benchmarksResult) {
        return benchmarksResult;
      }
    }

    // Docs routes (documentation subsystem — unprotected)
    if (path.startsWith("/api/docs/") || path.startsWith("/api/docs?")) {
      const docsResult = await handleDocsRoute(method, path, request);
      if (docsResult) {
        return docsResult;
      }
    }

    // Fetch routes (unprotected — no passphrase required)
    if (path.startsWith("/api/fetch/")) {
      // Disable per-request idle timeout for SSE stream endpoints so Bun
      // does not close the connection while the server is busy fetching.
      if (path.endsWith("/stream")) {
        server.timeout(request, 0);
      }
      const fetchResult = await handleFetchRoute(method, path, request);
      if (fetchResult) {
        return fetchResult;
      }
    }

    // Test setup stream (SSE — runs fetch + history seed for fresh test databases)
    if (path.startsWith("/api/test-setup/")) {
      if (path.endsWith("/stream")) {
        server.timeout(request, 0);
      }
      const testSetupResult = await handleTestSetupRoute(method, path, request);
      if (testSetupResult) {
        return testSetupResult;
      }
    }

    // Backfill routes (unprotected — no passphrase required)
    if (path.startsWith("/api/backfill/")) {
      const backfillResult = await handleBackfillRoute(method, path, request);
      if (backfillResult) {
        return backfillResult;
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

console.log(`Portfolio 60 server running on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${server.port}`);

// Process any due drawdowns (only if database already exists — skipped on fresh installs)
if (databaseExists()) {
  try {
    processDrawdowns();
  } catch (err) {
    console.warn("[Drawdown] Failed to process drawdowns on startup:", err.message);
  }
}

// Initialise scheduled fetching (after server is ready)
initScheduledFetcher();

// Index documentation for search (runs in background, non-blocking)
if (databaseExists()) {
  const docsConfig = getDocsConfig();
  if (docsConfig.categories && Object.keys(docsConfig.categories).length > 0) {
    reindexAllPages(getDatabase(), docsConfig.categories).then(function (result) {
      if (result.success) {
        console.log("[Docs] Search index built: " + result.indexed + " documents in " + result.duration);
      }
    }).catch(function (err) {
      console.warn("[Docs] Search index build failed:", err.message);
    });
  }
}

// Fetch server sync: push config and pull latest data on startup
const fetchServerConfig = getFetchServerConfig();
if (fetchServerConfig.enabled && fetchServerConfig.url) {
  // Push config (fire-and-forget — logs warning on failure)
  pushConfigToFetchServer().catch(function () {});

  // Sync latest data if configured
  if (fetchServerConfig.syncOnStartup) {
    syncFromFetchServer().then(function (result) {
      if (result.success) {
        console.log("[FetchServer] Startup sync complete — data as of " + result.fetchedAt);
      } else if (result.error) {
        console.warn("[FetchServer] Startup sync: " + result.error);
      }
    }).catch(function (err) {
      console.warn("[FetchServer] Startup sync failed:", err.message);
    });
  }
}

// Graceful shutdown: checkpoint WAL and stop the scheduler before exiting
process.on("SIGINT", function () {
  stopScheduledFetcher();
  closeDatabase();
  process.exit(0);
});
