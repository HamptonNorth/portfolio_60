/**
 * @description Full-text search service for the docs subsystem.
 * Uses SQLite FTS5 with weighted content regions and BM25 ranking.
 * Indexes markdown pages by extracting headings, bold text, links,
 * code, blockquotes, and body content into separate weighted columns.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DOCS_DIR } from "../../shared/constants.js";
import { parseFrontMatter } from "./docs-frontmatter.js";

/** @type {number} Maximum results returned from a search */
export const SEARCH_MAX_RESULTS = 25;

/** @type {number} Minimum query length required */
export const SEARCH_MIN_QUERY_LENGTH = 3;

/** @type {number} Characters of context on each side of a match in snippets */
var SEARCH_CONTEXT_CHARS = 60;

/**
 * @description Content weight configuration for BM25 ranking.
 * Higher weight = more important in search results.
 * @type {Object.<string, number>}
 */
var WEIGHTS = {
  title: 10,
  description: 8,
  h1: 6,
  h2: 5,
  h3: 4,
  h4_h6: 2,
  bold: 2,
  link_text: 2,
  blockquote: 1.5,
  body: 1,
  code: 0.5,
};

/**
 * @description Initialise the search index tables in the database.
 * Creates the FTS5 virtual table and metadata table if they don't exist.
 * @param {import("bun:sqlite").Database} db - Database instance
 */
export function initSearchIndex(db) {
  db.run(
    "CREATE VIRTUAL TABLE IF NOT EXISTS docs_search USING fts5(" +
      "category UNINDEXED, slug UNINDEXED, published UNINDEXED, lapse_date UNINDEXED, " +
      "title, description, h1_content, h2_content, h3_content, h4_h6_content, " +
      "bold_content, link_text, blockquote_content, body_text, code_content, " +
      "tokenize='porter unicode61'" +
    ")"
  );

  db.run(
    "CREATE TABLE IF NOT EXISTS docs_search_meta (" +
      "key TEXT PRIMARY KEY, value TEXT" +
    ")"
  );
}

/**
 * @description Extract weighted content regions from markdown body.
 * Parses headings, bold text, links, blockquotes, code blocks, and
 * remaining body text into separate arrays for weighted indexing.
 * @param {string} markdown - Markdown body content (without front matter)
 * @returns {Object} Content regions grouped by type
 */
function extractContentRegions(markdown) {
  var regions = {
    h1: [],
    h2: [],
    h3: [],
    h4_h6: [],
    bold: [],
    link_text: [],
    blockquote: [],
    code: [],
    body: [],
  };

  var remaining = markdown;

  // Extract code blocks first (to avoid parsing markdown inside them)
  remaining = remaining.replace(/```[\s\S]*?```/g, function (match) {
    var lines = match.split("\n");
    var codeContent = lines.slice(1, -1).join(" ");
    if (codeContent.trim()) {
      regions.code.push(codeContent.trim());
    }
    return "";
  });

  // Inline code
  remaining = remaining.replace(/`([^`]+)`/g, function (match, code) {
    if (code.trim()) {
      regions.code.push(code.trim());
    }
    return "";
  });

  // Blockquotes
  remaining = remaining.replace(/^>\s*(.+)$/gm, function (match, content) {
    if (content.trim()) {
      regions.blockquote.push(content.trim());
    }
    return "";
  });

  // H1
  remaining = remaining.replace(/^#\s+(.+)$/gm, function (match, content) {
    if (content.trim()) {
      regions.h1.push(content.trim());
    }
    return "";
  });

  // H2
  remaining = remaining.replace(/^##\s+(.+)$/gm, function (match, content) {
    if (content.trim()) {
      regions.h2.push(content.trim());
    }
    return "";
  });

  // H3
  remaining = remaining.replace(/^###\s+(.+)$/gm, function (match, content) {
    if (content.trim()) {
      regions.h3.push(content.trim());
    }
    return "";
  });

  // H4-H6
  remaining = remaining.replace(/^#{4,6}\s+(.+)$/gm, function (match, content) {
    if (content.trim()) {
      regions.h4_h6.push(content.trim());
    }
    return "";
  });

  // Bold text — **bold** and __bold__
  remaining = remaining.replace(/\*\*([^*]+)\*\*/g, function (match, content) {
    if (content.trim()) {
      regions.bold.push(content.trim());
    }
    return content;
  });

  remaining = remaining.replace(/__([^_]+)__/g, function (match, content) {
    if (content.trim()) {
      regions.bold.push(content.trim());
    }
    return content;
  });

  // Link text — [text](url)
  remaining = remaining.replace(/\[([^\]]+)\]\([^)]+\)/g, function (match, text) {
    if (text.trim()) {
      regions.link_text.push(text.trim());
    }
    return text;
  });

  // Clean remaining content for body text
  remaining = remaining
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (remaining) {
    regions.body.push(remaining);
  }

  return regions;
}

/**
 * @description Index a single markdown file into the search database.
 * @param {import("bun:sqlite").Database} db - Database instance
 * @param {string} category - Category name
 * @param {string} slug - File slug (filename without .md)
 * @param {string} content - Raw file content including front matter
 * @returns {boolean} True if the page was indexed, false if skipped
 */
function indexPage(db, category, slug, content) {
  var parsed = parseFrontMatter(content);
  var meta = parsed.attributes;
  var body = parsed.body;

  if (!meta.title) {
    return false;
  }

  var regions = extractContentRegions(body);

  var insertStmt = db.prepare(
    "INSERT INTO docs_search (" +
      "category, slug, published, lapse_date, " +
      "title, description, h1_content, h2_content, h3_content, h4_h6_content, " +
      "bold_content, link_text, blockquote_content, body_text, code_content" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  insertStmt.run(
    category,
    slug,
    meta.published || "y",
    meta.lapse || null,
    meta.title || "",
    meta.summary || meta.description || "",
    regions.h1.join(" "),
    regions.h2.join(" "),
    regions.h3.join(" "),
    regions.h4_h6.join(" "),
    regions.bold.join(" "),
    regions.link_text.join(" "),
    regions.blockquote.join(" "),
    regions.body.join(" "),
    regions.code.join(" ")
  );

  return true;
}

/**
 * @description Reindex all markdown pages across all configured categories.
 * Clears the existing index and rebuilds from scratch.
 * @param {import("bun:sqlite").Database} db - Database instance
 * @param {Object.<string, {style: string, label: string}>} categories - Category config
 * @returns {Promise<{success: boolean, indexed: number, categories: number, duration: string, error?: string}>}
 */
export async function reindexAllPages(db, categories) {
  var startTime = Date.now();
  var indexedCount = 0;
  var categoriesProcessed = 0;

  try {
    var categoryNames = Object.keys(categories);

    if (categoryNames.length === 0) {
      return {
        success: false,
        error: "No doc categories configured",
        indexed: 0,
        categories: 0,
        duration: "0ms",
      };
    }

    // Clear existing index
    db.run("DELETE FROM docs_search");

    for (var i = 0; i < categoryNames.length; i++) {
      var category = categoryNames[i];
      var dirPath = "./" + DOCS_DIR + "/" + category;

      try {
        var files = await readdir(dirPath);
        categoriesProcessed++;

        for (var j = 0; j < files.length; j++) {
          var file = files[j];
          if (!file.endsWith(".md")) continue;

          try {
            var filePath = join(dirPath, file);
            var content = await Bun.file(filePath).text();
            var slug = file.replace(".md", "");

            if (indexPage(db, category, slug, content)) {
              indexedCount++;
            }
          } catch (fileErr) {
            console.error("[Docs Search] Error indexing " + category + "/" + file + ":", fileErr.message);
          }
        }
      } catch (dirErr) {
        // Directory doesn't exist yet — skip silently
      }
    }

    // Update metadata
    var now = new Date().toISOString();
    db.run("INSERT OR REPLACE INTO docs_search_meta (key, value) VALUES ('last_indexed', ?)", [now]);

    var duration = Date.now() - startTime;
    console.log("[Docs Search] Indexed " + indexedCount + " pages from " + categoriesProcessed + " categories in " + duration + "ms");

    return {
      success: true,
      indexed: indexedCount,
      categories: categoriesProcessed,
      duration: duration + "ms",
    };
  } catch (err) {
    console.error("[Docs Search] Reindex failed:", err);
    return {
      success: false,
      error: err.message,
      indexed: indexedCount,
      categories: categoriesProcessed,
      duration: (Date.now() - startTime) + "ms",
    };
  }
}

/**
 * @description Escape special regex characters in a string.
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @description Generate a text snippet with highlighted match.
 * Finds the first prefix-match of the query within the text and
 * returns a snippet with surrounding context and <mark> tags.
 * @param {string} text - Full text to search within
 * @param {string} query - Search query
 * @param {number} [contextChars] - Characters of context on each side
 * @returns {string|null} Snippet with <mark> tags, or null if no match
 */
function generateSnippet(text, query, contextChars) {
  if (!text || !query) return null;
  if (contextChars === undefined) contextChars = SEARCH_CONTEXT_CHARS;

  var wordBoundaryRegex = new RegExp("(^|\\s)(" + escapeRegex(query.toLowerCase()) + "\\w*)", "i");
  var match = text.match(wordBoundaryRegex);

  if (!match) return null;

  var matchIndex = match.index + (match[1] ? 1 : 0);
  var matchedWord = match[2];

  var start = Math.max(0, matchIndex - contextChars);
  var end = Math.min(text.length, matchIndex + matchedWord.length + contextChars);

  var snippet = text.slice(start, end);

  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";

  var highlightRegex = new RegExp("(^|\\s)(" + escapeRegex(query.toLowerCase()) + ")(\\w*)", "gi");
  snippet = snippet.replace(highlightRegex, "$1<mark>$2</mark>$3");

  return snippet;
}

/**
 * @description Search indexed pages with weighted BM25 ranking.
 * Filters out lapsed pages automatically.
 * @param {import("bun:sqlite").Database} db - Database instance
 * @param {string} query - Search query (minimum 3 characters)
 * @param {Object} [options] - Search options
 * @param {number} [options.limit] - Maximum results (default SEARCH_MAX_RESULTS)
 * @returns {{query: string, results: Array, total: number, duration: string, error?: string}}
 */
export function searchPages(db, query, options) {
  var startTime = Date.now();
  var limit = (options && options.limit) || SEARCH_MAX_RESULTS;

  if (!query || query.trim().length < SEARCH_MIN_QUERY_LENGTH) {
    return {
      query: query || "",
      results: [],
      total: 0,
      duration: "0ms",
      error: "Query must be at least " + SEARCH_MIN_QUERY_LENGTH + " characters",
    };
  }

  var cleanQuery = query.trim();

  try {
    // Build FTS5 query with prefix matching
    var ftsQuery = cleanQuery
      .split(/\s+/)
      .map(function (term) {
        var escaped = term.replace(/"/g, '""');
        return '"' + escaped + '"*';
      })
      .join(" ");

    // BM25 weights in column order:
    // category(0), slug(0), published(0), lapse_date(0),
    // title(10), description(8), h1(6), h2(5), h3(4), h4_h6(2),
    // bold(2), link_text(2), blockquote(1.5), body(1), code(0.5)
    var bm25Weights = "0, 0, 0, 0, " +
      WEIGHTS.title + ", " + WEIGHTS.description + ", " +
      WEIGHTS.h1 + ", " + WEIGHTS.h2 + ", " + WEIGHTS.h3 + ", " + WEIGHTS.h4_h6 + ", " +
      WEIGHTS.bold + ", " + WEIGHTS.link_text + ", " + WEIGHTS.blockquote + ", " +
      WEIGHTS.body + ", " + WEIGHTS.code;

    var searchSql =
      "SELECT category, slug, title, description, published, lapse_date, " +
      "h1_content, h2_content, body_text, " +
      "bm25(docs_search, " + bm25Weights + ") as score " +
      "FROM docs_search WHERE docs_search MATCH ? ORDER BY score LIMIT ?";

    var rawResults = db.query(searchSql).all(ftsQuery, limit * 2);

    // Filter out unpublished and lapsed pages
    var now = new Date();
    var filteredResults = rawResults.filter(function (row) {
      if (row.published === "n") return false;
      if (row.lapse_date && now > new Date(row.lapse_date)) return false;
      return true;
    });

    var limitedResults = filteredResults.slice(0, limit);

    // Format results with snippets
    var results = limitedResults.map(function (row) {
      var matches = [];

      var titleSnippet = generateSnippet(row.title, cleanQuery);
      if (titleSnippet) matches.push({ region: "title", fragment: titleSnippet });

      var descSnippet = generateSnippet(row.description, cleanQuery);
      if (descSnippet) matches.push({ region: "description", fragment: descSnippet });

      var h1Snippet = generateSnippet(row.h1_content, cleanQuery);
      if (h1Snippet) matches.push({ region: "heading", fragment: h1Snippet });

      var h2Snippet = generateSnippet(row.h2_content, cleanQuery);
      if (h2Snippet) matches.push({ region: "heading", fragment: h2Snippet });

      var bodySnippet = generateSnippet(row.body_text, cleanQuery);
      if (bodySnippet) matches.push({ region: "body", fragment: bodySnippet });

      if (matches.length === 0 && row.description) {
        matches.push({
          region: "description",
          fragment: row.description.length > 60 ? row.description.slice(0, 60) + "..." : row.description,
        });
      }

      return {
        category: row.category,
        slug: row.slug,
        title: row.title,
        description: row.description || "",
        score: Math.abs(row.score),
        isUnpublished: row.published === "n",
        matches: matches.slice(0, 2),
      };
    });

    var duration = Date.now() - startTime;

    return {
      query: cleanQuery,
      results: results,
      total: results.length,
      duration: duration + "ms",
    };
  } catch (err) {
    console.error("[Docs Search] Search failed:", err);
    return {
      query: cleanQuery,
      results: [],
      total: 0,
      duration: (Date.now() - startTime) + "ms",
      error: err.message,
    };
  }
}

/**
 * @description Get search index metadata (last indexed time, document count).
 * @param {import("bun:sqlite").Database} db - Database instance
 * @returns {{ lastIndexed: string|null, documentCount: number }}
 */
export function getSearchMeta(db) {
  try {
    var lastIndexed = db.query("SELECT value FROM docs_search_meta WHERE key = 'last_indexed'").get();
    var countResult = db.query("SELECT COUNT(*) as count FROM docs_search").get();

    return {
      lastIndexed: lastIndexed ? lastIndexed.value : null,
      documentCount: countResult ? countResult.count : 0,
    };
  } catch (err) {
    return {
      lastIndexed: null,
      documentCount: 0,
      error: err.message,
    };
  }
}
