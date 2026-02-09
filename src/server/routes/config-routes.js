import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllSiteConfigs, findSiteConfig, loadConfig, getAllowedProviders, getSchedulingConfig, reloadConfig, getScraperTestingEnabled } from "../config.js";

/**
 * @description Get the list of allowed provider codes.
 * Delegates to the central config loader.
 * @returns {string[]} Array of lowercase provider codes
 */
export function getAllowedProviderCodes() {
  const providers = getAllowedProviders();
  return providers.map(function (p) {
    return p.code.toLowerCase();
  });
}

/**
 * @description Cached build time, loaded once from disk.
 * @type {string|null}
 */
let buildTimeCache = null;

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
 * @description Get a human-readable OS description by reading /etc/os-release.
 * Falls back to process.platform if the file is unavailable.
 * @returns {string} OS description string
 */
function getOsDescription() {
  try {
    const osRelease = readFileSync("/etc/os-release", "utf-8");
    const match = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (match) {
      return match[1];
    }
  } catch {
    // Not on Linux or file not available
  }
  return process.platform;
}

/**
 * @description Handle config API routes.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @returns {Response|null} Response if matched, null otherwise
 */
export function handleConfigRoute(method, path) {
  if (method === "GET" && path === "/api/config/providers") {
    const providers = getAllowedProviders();
    return new Response(JSON.stringify(providers), {
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

  // GET /api/config/raw — return the raw config.json content as a string for editing
  if (method === "GET" && path === "/api/config/raw") {
    try {
      const configPath = resolve("src/shared/config.json");
      const raw = readFileSync(configPath, "utf-8");
      return new Response(JSON.stringify({ content: raw, path: configPath }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to read config", detail: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // GET /api/config/system-info — return system information for the About modal
  if (method === "GET" && path === "/api/config/system-info") {
    const buildTime = getBuildTime();
    const runtime = typeof Bun !== "undefined" ? "Bun v" + Bun.version : "Node.js " + process.version;
    const info = {
      appName: "Portfolio 60",
      version: "0.1.0",
      buildTime: buildTime,
      runtime: runtime,
      platform: process.platform,
      arch: process.arch,
      os: getOsDescription(),
      configPath: resolve("src/shared/config.json"),
      dbPath: resolve("data/portfolio60.db"),
      backupPath: resolve("backups"),
    };
    return new Response(JSON.stringify(info), {
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

  // GET /api/config/scheduling — get scheduling configuration
  if (method === "GET" && path === "/api/config/scheduling") {
    const scheduling = getSchedulingConfig();
    return new Response(JSON.stringify(scheduling), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/config/scraper-testing-enabled — check if scraper testing feature is enabled
  if (method === "GET" && path === "/api/config/scraper-testing-enabled") {
    const enabled = getScraperTestingEnabled();
    return new Response(JSON.stringify({ enabled: enabled }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/config/help/public-id — return the public-id help markdown as HTML
  if (method === "GET" && path === "/api/config/help/public-id") {
    try {
      const helpPath = resolve("src/shared/public-id-help.md");
      const markdown = readFileSync(helpPath, "utf-8");
      const html = convertMarkdownToHtml(markdown);
      return new Response(JSON.stringify({ html: html }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to load help content", detail: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // POST /api/config/scraper-sites/match — check if a URL matches a known site
  if (method === "POST" && path === "/api/config/scraper-sites/match") {
    // This will be handled async below
    return null;
  }

  return null;
}

/**
 * @description Escape HTML special characters for safe rendering.
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped HTML-safe text
 */
function escapeHtmlServer(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @description Convert basic markdown to HTML for help content display.
 * Supports headings (#, ##, ###), bold (**text**), inline code (`text`),
 * code blocks (```), and paragraphs. Reads from an external .md file so the
 * content can be edited outside the application.
 * @param {string} markdown - The markdown text to convert
 * @returns {string} HTML string with Tailwind classes for styling
 */
function convertMarkdownToHtml(markdown) {
  const lines = markdown.split("\n");
  let html = "";
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        html += "</code></pre>";
        inCodeBlock = false;
      } else {
        html += '<pre class="bg-brand-50 border border-brand-200 rounded px-3 py-2 text-sm font-mono overflow-x-auto my-2"><code>';
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html += escapeHtmlServer(line) + "\n";
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    if (line.startsWith("### ")) {
      html += '<h4 class="text-base font-semibold text-brand-800 mt-3 mb-1">' + escapeHtmlServer(line.slice(4)) + "</h4>";
      continue;
    }
    if (line.startsWith("## ")) {
      html += '<h3 class="text-lg font-semibold text-brand-800 mt-4 mb-1">' + escapeHtmlServer(line.slice(3)) + "</h3>";
      continue;
    }
    if (line.startsWith("# ")) {
      html += '<h2 class="text-xl font-semibold text-brand-800 mb-2">' + escapeHtmlServer(line.slice(2)) + "</h2>";
      continue;
    }

    // List items
    if (line.trimStart().startsWith("- ")) {
      const indent = line.length - line.trimStart().length;
      const content = line.trimStart().slice(2);
      let formatted = escapeHtmlServer(content);
      formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      formatted = formatted.replace(/`(.+?)`/g, '<code class="bg-brand-50 px-1 rounded text-sm font-mono">$1</code>');
      const marginClass = indent > 0 ? " ml-4" : "";
      html += '<p class="text-sm text-brand-700 mb-0.5' + marginClass + '">&bull; ' + formatted + "</p>";
      continue;
    }

    let formatted = escapeHtmlServer(line);
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/`(.+?)`/g, '<code class="bg-brand-50 px-1 rounded text-sm font-mono">$1</code>');

    html += '<p class="text-sm text-brand-700 mb-1">' + formatted + "</p>";
  }

  return html;
}

/**
 * @description Handle async config API routes (for POST requests with body).
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleConfigRouteAsync(method, path, request) {
  // PUT /api/config/raw — save edited config.json content
  if (method === "PUT" && path === "/api/config/raw") {
    try {
      const body = await request.json();
      const content = body.content;

      if (typeof content !== "string" || content.trim().length === 0) {
        return new Response(JSON.stringify({ error: "Content is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate that the content is valid JSON
      try {
        JSON.parse(content);
      } catch (parseErr) {
        return new Response(JSON.stringify({ error: "Invalid JSON", detail: parseErr.message }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const configPath = resolve("src/shared/config.json");
      writeFileSync(configPath, content, "utf-8");

      // Reload the cached config so changes take effect immediately
      reloadConfig();

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to save config", detail: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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
