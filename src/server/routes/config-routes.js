import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, join, extname } from "node:path";
import { loadConfig, getAllowedProviders, getSchedulingConfig, reloadConfig, getListItems, getListDocuments, saveListItems, saveListDocuments, getListsDir, getConfigFilePath, getWritableConfigPath, getReportsOpenInNewTab, getMergedConfigRaw } from "../config.js";
import { isTestMode } from "../test-mode.js";
import { DB_PATH, BACKUP_DIR, APP_NAME, APP_VERSION } from "../../shared/server-constants.js";

/**
 * @description Create a timestamped backup of a JSON file before overwriting.
 * The backup is written to the same directory as the original file with a
 * timestamp suffix: filename-backup-yyyy-mm-dd-hh-mm.json.
 * @param {string} filePath - Absolute path to the file to back up
 */
function backupJsonFile(filePath) {
  if (!existsSync(filePath)) return;
  const dir = dirname(filePath);
  const base = basename(filePath, ".json");
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "-" + pad(now.getHours()) + "-" + pad(now.getMinutes());
  const backupName = base + "-backup-" + timestamp + ".json";
  const backupPath = join(dir, backupName);
  copyFileSync(filePath, backupPath);
}

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

  // GET /api/config/raw — return the merged user-settings.json content as a string for editing.
  // The merged result includes repo defaults for any keys missing from the user's file,
  // so new config additions are always visible in the editor.
  // Creates a timestamped backup before returning so the user can recover if their edits break things.
  if (method === "GET" && path === "/api/config/raw") {
    try {
      const configPath = getConfigFilePath();
      backupJsonFile(configPath);
      const merged = getMergedConfigRaw();
      return new Response(JSON.stringify({ content: merged, path: configPath }), {
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
      appName: APP_NAME,
      version: APP_VERSION,
      buildTime: buildTime,
      runtime: runtime,
      platform: process.platform,
      arch: process.arch,
      os: getOsDescription(),
      configPath: getConfigFilePath(),
      dbPath: resolve(DB_PATH),
      backupPath: resolve(BACKUP_DIR),
    };
    return new Response(JSON.stringify(info), {
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

  // GET /api/config/reports-new-tab — whether reports should open in a new tab
  if (method === "GET" && path === "/api/config/reports-new-tab") {
    const openInNewTab = getReportsOpenInNewTab();
    return new Response(JSON.stringify({ reportsOpenInNewTab: openInNewTab }), {
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

  // GET /api/config/lists — return spreadsheet items and PDF documents.
  // Uses user-lists-test.json in test/demo mode, user-lists.json otherwise.
  if (method === "GET" && path === "/api/config/lists") {
    const items = getListItems(isTestMode());
    const documents = getListDocuments(isTestMode());
    return new Response(JSON.stringify({ items: items, documents: documents }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
/** @type {number} Maximum PDF upload size in bytes (20 MB) */
const MAX_PDF_SIZE = 20 * 1024 * 1024;

/**
 * @description Build an iframe HTML string from a share link URL.
 * Escapes the URL for safe embedding in an HTML attribute.
 * @param {string} shareLink - The spreadsheet share URL
 * @returns {string} An iframe HTML tag with the URL as the src attribute
 */
function wrapShareLinkAsIframe(shareLink) {
  const escaped = shareLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return '<iframe src="' + escaped + '"></iframe>';
}

/**
 * @description Generate a unique filename by appending (1), (2), etc. if
 * a file with the same name already exists in the target directory.
 * @param {string} dir - Directory to check for existing files
 * @param {string} filename - The desired filename
 * @returns {{ filename: string, isDuplicate: boolean }} The unique filename and whether it was modified
 */
function getUniqueFilename(dir, filename) {
  const ext = extname(filename);
  const base = basename(filename, ext);
  let candidate = filename;
  let counter = 0;

  while (existsSync(join(dir, candidate))) {
    counter++;
    candidate = base + " (" + counter + ")" + ext;
  }

  return { filename: candidate, isDuplicate: counter > 0 };
}

export async function handleConfigRouteAsync(method, path, request) {

  // --- Spreadsheet CRUD ---

  // POST /api/config/lists/spreadsheet — add a new spreadsheet entry
  if (method === "POST" && path === "/api/config/lists/spreadsheet") {
    try {
      const body = await request.json();
      const title = (body.title || "").trim();
      const spreadsheet = (body.spreadsheet || "").trim().toLowerCase();
      const shareLink = (body.shareLink || "").trim();
      const range = (body.range || "").trim();

      if (!title) {
        return new Response(JSON.stringify({ error: "Title is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (spreadsheet !== "google" && spreadsheet !== "microsoft") {
        return new Response(JSON.stringify({ error: "Spreadsheet type must be 'google' or 'microsoft'" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (!shareLink) {
        return new Response(JSON.stringify({ error: "Share link is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const iframe = wrapShareLinkAsIframe(shareLink);
      const testMode = isTestMode();
      const items = getListItems(testMode);
      items.push({ title: title, spreadsheet: spreadsheet, iframe: iframe, range: range });
      saveListItems(testMode, items);

      return new Response(JSON.stringify({ success: true, index: items.length - 1 }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to add spreadsheet", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // PUT /api/config/lists/spreadsheet/:index — edit a spreadsheet entry
  var spreadsheetPutMatch = path.match(/^\/api\/config\/lists\/spreadsheet\/(\d+)$/);
  if (method === "PUT" && spreadsheetPutMatch) {
    try {
      const index = parseInt(spreadsheetPutMatch[1], 10);
      const testMode = isTestMode();
      const items = getListItems(testMode);

      if (index < 0 || index >= items.length) {
        return new Response(JSON.stringify({ error: "Spreadsheet not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      const body = await request.json();
      const title = (body.title || "").trim();
      const spreadsheet = (body.spreadsheet || "").trim().toLowerCase();
      const shareLink = (body.shareLink || "").trim();
      const range = (body.range || "").trim();

      if (!title) {
        return new Response(JSON.stringify({ error: "Title is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (spreadsheet !== "google" && spreadsheet !== "microsoft") {
        return new Response(JSON.stringify({ error: "Spreadsheet type must be 'google' or 'microsoft'" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (!shareLink) {
        return new Response(JSON.stringify({ error: "Share link is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const iframe = wrapShareLinkAsIframe(shareLink);
      items[index] = { title: title, spreadsheet: spreadsheet, iframe: iframe, range: range };
      saveListItems(testMode, items);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to update spreadsheet", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // DELETE /api/config/lists/spreadsheet/:index — delete a spreadsheet entry
  var spreadsheetDeleteMatch = path.match(/^\/api\/config\/lists\/spreadsheet\/(\d+)$/);
  if (method === "DELETE" && spreadsheetDeleteMatch) {
    try {
      const index = parseInt(spreadsheetDeleteMatch[1], 10);
      const testMode = isTestMode();
      const items = getListItems(testMode);

      if (index < 0 || index >= items.length) {
        return new Response(JSON.stringify({ error: "Spreadsheet not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      items.splice(index, 1);
      saveListItems(testMode, items);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to delete spreadsheet", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // --- Document (PDF) CRUD ---

  // POST /api/config/lists/document — upload a PDF document
  if (method === "POST" && path === "/api/config/lists/document") {
    try {
      var formData;
      try {
        formData = await request.formData();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid form data" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const title = (formData.get("title") || "").trim();
      const file = formData.get("file");

      if (!title) {
        return new Response(JSON.stringify({ error: "Title is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (!file || !(file instanceof File)) {
        return new Response(JSON.stringify({ error: "A PDF file is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (extname(file.name).toLowerCase() !== ".pdf") {
        return new Response(JSON.stringify({ error: "Only PDF files are allowed" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      if (file.size > MAX_PDF_SIZE) {
        return new Response(JSON.stringify({ error: "File too large. Maximum size is 20 MB" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const listsDir = getListsDir();
      mkdirSync(listsDir, { recursive: true });

      // Sanitise the original filename: lowercase, replace spaces with dashes, strip unsafe chars
      var sanitised = file.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_.]/g, "");
      if (!sanitised || sanitised === ".pdf") {
        sanitised = "document.pdf";
      }

      const unique = getUniqueFilename(listsDir, sanitised);
      const targetPath = join(listsDir, unique.filename);
      const buffer = await file.arrayBuffer();
      await Bun.write(targetPath, buffer);

      const testMode = isTestMode();
      const documents = getListDocuments(testMode);
      documents.push({ title: title, filename: unique.filename });
      saveListDocuments(testMode, documents);

      return new Response(JSON.stringify({
        success: true,
        index: documents.length - 1,
        filename: unique.filename,
        isDuplicate: unique.isDuplicate,
      }), { status: 201, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to upload document", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // PUT /api/config/lists/document/:index — edit a document title
  var documentPutMatch = path.match(/^\/api\/config\/lists\/document\/(\d+)$/);
  if (method === "PUT" && documentPutMatch) {
    try {
      const index = parseInt(documentPutMatch[1], 10);
      const testMode = isTestMode();
      const documents = getListDocuments(testMode);

      if (index < 0 || index >= documents.length) {
        return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      const body = await request.json();
      const title = (body.title || "").trim();

      if (!title) {
        return new Response(JSON.stringify({ error: "Title is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      documents[index].title = title;
      saveListDocuments(testMode, documents);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to update document", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // DELETE /api/config/lists/document/:index — delete a document entry and its file
  var documentDeleteMatch = path.match(/^\/api\/config\/lists\/document\/(\d+)$/);
  if (method === "DELETE" && documentDeleteMatch) {
    try {
      const index = parseInt(documentDeleteMatch[1], 10);
      const testMode = isTestMode();
      const documents = getListDocuments(testMode);

      if (index < 0 || index >= documents.length) {
        return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      }

      // Remove the PDF file from disk (if it exists)
      const listsDir = getListsDir();
      const filePath = join(listsDir, documents[index].filename);
      const safeFilePath = resolve(filePath);
      if (safeFilePath.startsWith(resolve(listsDir)) && existsSync(safeFilePath)) {
        unlinkSync(safeFilePath);
      }

      documents.splice(index, 1);
      saveListDocuments(testMode, documents);

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to delete document", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  // PUT /api/config/raw — save edited user-settings.json content
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

      const configPath = getWritableConfigPath();
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

  return null;
}
