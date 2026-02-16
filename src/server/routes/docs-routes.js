/**
 * @description API routes for the documentation subsystem.
 * Handles listing, viewing, editing, uploading, deleting, and searching
 * markdown documentation pages stored in the docs/ directory.
 */

import { Router } from "../router.js";
import { readdir, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { marked } from "marked";
import { DOCS_DIR, DOCS_MEDIA_DIR } from "../../shared/constants.js";
import { getDocsConfig } from "../config.js";
import { getStyleConfig, getFontLinks, STYLE_REGISTRY } from "../services/style-registry.js";
import { parseFrontMatter, ensureUnpublishedFrontMatter, isLapsed } from "../services/docs-frontmatter.js";
import { getDatabase } from "../db/connection.js";
import { initSearchIndex, reindexAllPages, searchPages, getSearchMeta } from "../services/docs-search.js";
import { spellCheckContent, getCustomDictionary, addCustomWord } from "../services/spellcheck-service.js";

/** @type {string[]} Allowed file extensions for markdown uploads */
var ALLOWED_MARKDOWN_EXTENSIONS = [".md"];

/** @type {string[]} Allowed file extensions for image uploads */
var ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

/**
 * @description Get the file extension (lowercase) from a filename.
 * @param {string} filename - The filename to extract extension from
 * @returns {string} Lowercase extension including the dot, or empty string
 */
function getFileExtension(filename) {
  var lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * @description Sanitise a filename by removing problematic characters.
 * Replaces spaces with dashes, removes special characters, and lowercases.
 * @param {string} filename - The original filename
 * @returns {string} Sanitised filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[/\\]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * @description Get the category style config, falling back to "github".
 * @param {string} category - Category name
 * @returns {Object} Style configuration object
 */
function getCategoryStyle(category) {
  var docsConfig = getDocsConfig();
  var catConfig = docsConfig.categories[category];
  if (catConfig && catConfig.style) {
    return getStyleConfig(catConfig.style);
  }
  return getStyleConfig("github");
}

// =============================================================================
// Router setup
// =============================================================================

var docsRouter = new Router();

// GET /api/docs/config — returns docs categories and available styles
docsRouter.get("/api/docs/config", function () {
  var docsConfig = getDocsConfig();
  return new Response(
    JSON.stringify({
      categories: docsConfig.categories,
      styles: STYLE_REGISTRY,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// GET /api/docs/list/:category — list all pages in a category
docsRouter.get("/api/docs/list/:category", async function (request, params) {
  var category = params.category;

  if (category.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var dirPath = "./" + DOCS_DIR + "/" + category;
  var files;

  try {
    files = await readdir(dirPath);
  } catch (e) {
    return new Response(JSON.stringify({ pages: [], category: category }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  var pages = [];
  var now = new Date();

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (!file.endsWith(".md")) continue;

    try {
      var content = await Bun.file(join(dirPath, file)).text();
      var parsed = parseFrontMatter(content);
      var meta = parsed.attributes;

      if (!meta.title) continue;

      meta.filename = file;
      meta.slug = file.replace(".md", "");

      // Skip lapsed pages in listing (but not unpublished — show those for editing)
      if (meta.lapse && now > new Date(meta.lapse)) continue;

      pages.push(meta);
    } catch (err) {
      // Skip files that can't be read
    }
  }

  // Sort: sticky pages first, then by created date descending
  pages.sort(function (a, b) {
    var aSticky = a.sticky === "true" || a.sticky === true;
    var bSticky = b.sticky === "true" || b.sticky === true;
    if (aSticky && !bSticky) return -1;
    if (!aSticky && bSticky) return 1;
    return new Date(b.created || 0) - new Date(a.created || 0);
  });

  return new Response(JSON.stringify({ pages: pages, category: category }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// GET /api/docs/content/:category/:slug — rendered HTML + meta + style
docsRouter.get("/api/docs/content/:category/:slug", async function (request, params) {
  var category = params.category;
  var slug = params.slug;

  if (category.includes("..") || slug.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var mdPath = "./" + DOCS_DIR + "/" + category + "/" + slug + ".md";
  var mdFile = Bun.file(mdPath);

  if (!(await mdFile.exists())) {
    return new Response(JSON.stringify({ error: "Page not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  var text = await mdFile.text();
  var parsed = parseFrontMatter(text);
  var meta = parsed.attributes;
  var htmlContent = marked.parse(parsed.body);

  // Check lapse
  if (isLapsed(meta.lapse)) {
    return new Response(JSON.stringify({ error: "This document has expired" }), {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Determine effective style
  var categoryStyleConfig = getCategoryStyle(category);
  var effectiveStyleName = meta.style || categoryStyleConfig.name;
  var styleConfig = getStyleConfig(effectiveStyleName);

  // Parse read-mode
  var readModeValue = meta["read-mode"];
  meta.readMode = readModeValue === true || readModeValue === "true";

  return new Response(
    JSON.stringify({
      meta: meta,
      html: htmlContent,
      style: styleConfig,
      fontLinks: getFontLinks(styleConfig),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// GET /api/docs/raw/:category/:slug — raw markdown for editing
docsRouter.get("/api/docs/raw/:category/:slug", async function (request, params) {
  var category = params.category;
  var slug = params.slug;

  if (category.includes("..") || slug.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var mdPath = "./" + DOCS_DIR + "/" + category + "/" + slug + ".md";
  var mdFile = Bun.file(mdPath);

  if (!(await mdFile.exists())) {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  var content = await mdFile.text();
  var parsed = parseFrontMatter(content);

  return new Response(
    JSON.stringify({
      raw: content,
      meta: parsed.attributes,
      body: parsed.body,
      category: category,
      slug: slug,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// PUT /api/docs/raw/:category/:slug — save edited markdown
docsRouter.put("/api/docs/raw/:category/:slug", async function (request, params) {
  var category = params.category;
  var slug = params.slug;

  if (category.includes("..") || slug.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body.content !== "string") {
    return new Response(JSON.stringify({ error: "Content must be a string" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var mdPath = "./" + DOCS_DIR + "/" + category + "/" + slug + ".md";
  await Bun.write(mdPath, body.content);

  return new Response(
    JSON.stringify({
      success: true,
      message: "File saved successfully",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// POST /api/docs/upload/:category — upload a new markdown file
docsRouter.post("/api/docs/upload/:category", async function (request, params) {
  var category = params.category;

  if (!category || category.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var ext = getFileExtension(file.name);
  if (!ALLOWED_MARKDOWN_EXTENSIONS.includes(ext)) {
    return new Response(
      JSON.stringify({
        error: "Invalid file type. Allowed: " + ALLOWED_MARKDOWN_EXTENSIONS.join(", "),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  var sanitizedName = sanitizeFilename(file.name);
  if (!sanitizedName || sanitizedName === ".md") {
    return new Response(JSON.stringify({ error: "Invalid filename" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var targetDir = "./" + DOCS_DIR + "/" + category;
  var targetPath = targetDir + "/" + sanitizedName;

  await mkdir(targetDir, { recursive: true });

  var targetFile = Bun.file(targetPath);
  if (await targetFile.exists()) {
    return new Response(
      JSON.stringify({
        error: '"' + sanitizedName + '" already exists in ' + category,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  var content = await file.text();
  var styleConfig = getCategoryStyle(category);
  content = ensureUnpublishedFrontMatter(content, styleConfig.name);

  await Bun.write(targetPath, content);

  return new Response(
    JSON.stringify({
      success: true,
      message: 'File "' + sanitizedName + '" uploaded successfully',
      filename: sanitizedName,
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// POST /api/docs/media/:category — upload an image file
docsRouter.post("/api/docs/media/:category", async function (request, params) {
  var category = params.category;

  if (!category || category.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid category" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: "No file provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var ext = getFileExtension(file.name);
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    return new Response(
      JSON.stringify({
        error: "Invalid file type. Allowed: " + ALLOWED_IMAGE_EXTENSIONS.join(", "),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  var sanitizedName = sanitizeFilename(file.name);
  if (!sanitizedName || sanitizedName === ext) {
    return new Response(JSON.stringify({ error: "Invalid filename" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var targetDir = "./" + DOCS_MEDIA_DIR + "/" + category;
  var targetPath = targetDir + "/" + sanitizedName;

  await mkdir(targetDir, { recursive: true });

  var targetFile = Bun.file(targetPath);
  if (await targetFile.exists()) {
    return new Response(
      JSON.stringify({
        error: '"' + sanitizedName + '" already exists in ' + category,
      }),
      {
        status: 409,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  var buffer = await file.arrayBuffer();
  await Bun.write(targetPath, buffer);

  var markdownPath = "/docs/media/" + category + "/" + sanitizedName;

  return new Response(
    JSON.stringify({
      success: true,
      message: 'Image "' + sanitizedName + '" uploaded successfully',
      filename: sanitizedName,
      markdownUsage: "![" + sanitizedName + "](" + markdownPath + ")",
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// DELETE /api/docs/:category/:slug — delete a page
docsRouter.delete("/api/docs/:category/:slug", async function (request, params) {
  var category = params.category;
  var slug = params.slug;

  if (category.includes("..") || slug.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var mdPath = resolve(DOCS_DIR, category, slug + ".md");

  // Verify the path is within the docs directory
  var docsRoot = resolve(DOCS_DIR);
  if (!mdPath.startsWith(docsRoot)) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  var mdFile = Bun.file(mdPath);
  if (!(await mdFile.exists())) {
    return new Response(JSON.stringify({ error: "File not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  await unlink(mdPath);

  return new Response(
    JSON.stringify({
      success: true,
      message: "Page deleted successfully",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});

// GET /api/docs/search?q=term — full-text search
docsRouter.get("/api/docs/search", function (request) {
  var url = new URL(request.url);
  var query = url.searchParams.get("q") || "";
  var limitParam = url.searchParams.get("limit");
  var limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : undefined;

  var db = getDatabase();
  var results = searchPages(db, query, { limit: limit });

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /api/docs/reindex — rebuild search index
docsRouter.post("/api/docs/reindex", async function () {
  var db = getDatabase();
  var docsConfig = getDocsConfig();
  var result = await reindexAllPages(db, docsConfig.categories);

  if (result.success) {
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } else {
    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// GET /api/docs/search-meta — search index metadata
docsRouter.get("/api/docs/search-meta", function () {
  var db = getDatabase();
  var meta = getSearchMeta(db);
  return new Response(JSON.stringify(meta), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// POST /api/docs/spellcheck — spellcheck markdown content
docsRouter.post("/api/docs/spellcheck", async function (request) {
  try {
    var body = await request.json();
    var content = body.content;

    if (typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    var db = getDatabase();
    var customWords = getCustomDictionary(db);
    var errors = await spellCheckContent(content, customWords);

    return new Response(JSON.stringify({ errors: errors }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Spellcheck failed", detail: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// POST /api/docs/dictionary — add a word to the custom dictionary
docsRouter.post("/api/docs/dictionary", async function (request) {
  try {
    var body = await request.json();
    var word = body.word;

    if (typeof word !== "string" || word.trim().length === 0) {
      return new Response(JSON.stringify({ error: "word is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    var db = getDatabase();
    addCustomWord(db, word.trim());

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to add word", detail: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/**
 * @description Handle all docs API routes. Delegates to the docs router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleDocsRoute(method, path, request) {
  return await docsRouter.match(method, path, request);
}
