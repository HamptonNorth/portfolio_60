import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getAllSiteConfigs, findSiteConfig } from "../../shared/scraper-sites.js";

/**
 * @description Cached config data, loaded once from disk.
 * @type {Object|null}
 */
let configCache = null;

/**
 * @description Cached build time, loaded once from disk.
 * @type {string|null}
 */
let buildTimeCache = null;

/**
 * @description Load and cache the application config from config.json.
 * @returns {Object} The parsed config object
 */
function getConfig() {
  if (!configCache) {
    const configPath = resolve("src/shared/config.json");
    const raw = readFileSync(configPath, "utf-8");
    configCache = JSON.parse(raw);
  }
  return configCache;
}

/**
 * @description Get the list of allowed provider codes.
 * @returns {string[]} Array of lowercase provider codes
 */
export function getAllowedProviderCodes() {
  const config = getConfig();
  return config.allowed_providers.map((p) => p.code.toLowerCase());
}

/**
 * @description Get the build time from the build-time.txt file.
 * Returns "Development" if the file doesn't exist.
 * @returns {string} Build timestamp or "Development"
 */
function getBuildTime() {
  if (buildTimeCache === null) {
    const buildTimePath = resolve("src/shared/build-time.txt");
    if (existsSync(buildTimePath)) {
      buildTimeCache = readFileSync(buildTimePath, "utf-8").trim();
    } else {
      buildTimeCache = "Development";
    }
  }
  return buildTimeCache;
}

/**
 * @description Handle config API routes.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @returns {Response|null} Response if matched, null otherwise
 */
export function handleConfigRoute(method, path) {
  if (method === "GET" && path === "/api/config/providers") {
    const config = getConfig();
    return new Response(JSON.stringify(config.allowed_providers), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (method === "GET" && path === "/api/config/build-time") {
    const buildTime = getBuildTime();
    return new Response(JSON.stringify({ buildTime: buildTime }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/config/scraper-sites — list all known scraper site configurations
  if (method === "GET" && path === "/api/config/scraper-sites") {
    const sites = getAllSiteConfigs();
    return new Response(JSON.stringify(sites), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/config/scraper-sites/match — check if a URL matches a known site
  if (method === "POST" && path === "/api/config/scraper-sites/match") {
    // This will be handled async below
    return null;
  }

  return null;
}

/**
 * @description Handle async config API routes (for POST requests with body).
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleConfigRouteAsync(method, path, request) {
  // POST /api/config/scraper-sites/match — check if a URL matches a known site
  if (method === "POST" && path === "/api/config/scraper-sites/match") {
    try {
      const body = await request.json();
      const url = body.url;

      if (!url) {
        return new Response(JSON.stringify({ error: "URL is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const siteConfig = findSiteConfig(url);

      if (siteConfig) {
        return new Response(
          JSON.stringify({
            matched: true,
            site: siteConfig,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      } else {
        return new Response(
          JSON.stringify({
            matched: false,
            site: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid request", detail: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }

  return null;
}
