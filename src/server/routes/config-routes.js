import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Cached config data, loaded once from disk.
 * @type {Object|null}
 */
let configCache = null;

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

  return null;
}
