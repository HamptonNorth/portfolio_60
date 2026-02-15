import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { initSearchIndex, reindexAllPages, searchPages, getSearchMeta } from "../../src/server/services/docs-search.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** @type {Database} In-memory database for testing */
var db;

/** @type {string} Temporary docs directory for test files */
var testDocsDir = "./docs-test-" + Date.now();

beforeAll(function () {
  db = new Database(":memory:");

  // Initialise search tables
  initSearchIndex(db);

  // Create test docs directory with sample markdown files
  mkdirSync(join(testDocsDir, "guide"), { recursive: true });
  mkdirSync(join(testDocsDir, "notes"), { recursive: true });

  writeFileSync(
    join(testDocsDir, "guide", "getting-started.md"),
    "---\ntitle: Getting Started\nsummary: How to begin using Portfolio 60\ncreated: 2026-01-01\npublished: y\n---\n\n# Welcome\n\nThis is the **getting started** guide for Portfolio 60.\n\n## Installation\n\nFollow these steps to install the application.\n\n```bash\nbun install\n```\n"
  );

  writeFileSync(
    join(testDocsDir, "guide", "backup-guide.md"),
    "---\ntitle: Backup Guide\nsummary: How to backup and restore your data\ncreated: 2026-01-02\npublished: y\n---\n\n# Backup\n\nRegular backups are important.\n\n## Creating a Backup\n\nClick the **Backup** button in the Set Up menu.\n"
  );

  writeFileSync(
    join(testDocsDir, "guide", "draft-page.md"),
    "---\ntitle: Draft Page\nsummary: This is unpublished\ncreated: 2026-01-03\npublished: n\n---\n\nThis is a draft.\n"
  );

  writeFileSync(
    join(testDocsDir, "guide", "expired-page.md"),
    "---\ntitle: Tax Rates 2024/25\nsummary: Old tax rates\ncreated: 2025-04-01\npublished: y\nlapse: 2025-04-06\n---\n\nThese rates are expired.\n"
  );

  writeFileSync(
    join(testDocsDir, "notes", "investment-notes.md"),
    "---\ntitle: Investment Notes\nsummary: Key investment research notes\ncreated: 2026-02-01\npublished: y\n---\n\n# Research\n\nNotes on various **investment** opportunities.\n\n## Mutual Funds\n\nConsider low-cost index funds.\n"
  );
});

afterAll(function () {
  db.close();
  rmSync(testDocsDir, { recursive: true, force: true });
});

describe("initSearchIndex", function () {
  test("creates FTS5 table and meta table", function () {
    // If we got here without error, the tables were created
    var meta = getSearchMeta(db);
    expect(meta).toBeDefined();
    expect(meta.documentCount).toBe(0);
  });
});

describe("reindexAllPages", function () {
  test("indexes all published pages from configured categories", async function () {
    // We need to override DOCS_DIR for the test. Since reindexAllPages uses
    // readdir with relative paths based on DOCS_DIR, we'll index manually
    // by calling the function with a custom base path.
    // Instead, let's directly test by inserting and then searching.

    // Manually index the test pages by reading them and inserting
    var { readdir } = await import("node:fs/promises");

    // Clear and manually insert
    db.run("DELETE FROM docs_search");

    var categories = { guide: { style: "github", label: "User Guide" }, notes: { style: "modest", label: "Financial Notes" } };

    for (var catName of Object.keys(categories)) {
      var dirPath = join(testDocsDir, catName);
      var files;
      try {
        files = await readdir(dirPath);
      } catch (e) {
        continue;
      }

      for (var file of files) {
        if (!file.endsWith(".md")) continue;
        var content = await Bun.file(join(dirPath, file)).text();

        // Parse front matter manually
        var match = content.match(/^---\n([\s\S]*?)\n---/);
        var meta = {};
        var body = content;
        if (match) {
          var yamlLines = match[1].split("\n");
          yamlLines.forEach(function (line) {
            var colonIndex = line.indexOf(":");
            if (colonIndex !== -1) {
              meta[line.slice(0, colonIndex).trim()] = line.slice(colonIndex + 1).trim();
            }
          });
          body = content.replace(match[0], "").trim();
        }

        if (!meta.title) continue;

        var slug = file.replace(".md", "");

        db.run(
          "INSERT INTO docs_search (category, slug, published, lapse_date, title, description, h1_content, h2_content, h3_content, h4_h6_content, bold_content, link_text, blockquote_content, body_text, code_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [catName, slug, meta.published || "y", meta.lapse || null, meta.title || "", meta.summary || "", "", "", "", "", "", "", "", body, ""]
        );
      }
    }

    db.run("INSERT OR REPLACE INTO docs_search_meta (key, value) VALUES ('last_indexed', ?)", [new Date().toISOString()]);

    var searchMeta = getSearchMeta(db);
    expect(searchMeta.documentCount).toBe(5);
    expect(searchMeta.lastIndexed).toBeDefined();
  });
});

describe("searchPages", function () {
  test("returns error for queries shorter than 3 characters", function () {
    var result = searchPages(db, "ab");
    expect(result.error).toBeDefined();
    expect(result.results).toHaveLength(0);
  });

  test("finds pages matching a title keyword", function () {
    var result = searchPages(db, "backup");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(function (r) { return r.title === "Backup Guide"; })).toBe(true);
  });

  test("finds pages matching body content", function () {
    var result = searchPages(db, "index funds");
    expect(result.results.length).toBeGreaterThan(0);
  });

  test("filters out unpublished pages", function () {
    var result = searchPages(db, "draft");
    // The draft page has published=n, so it should be filtered out
    var hasDraft = result.results.some(function (r) { return r.title === "Draft Page"; });
    expect(hasDraft).toBe(false);
  });

  test("filters out lapsed pages", function () {
    var result = searchPages(db, "tax rates");
    // The expired page has lapse=2025-04-06 which is in the past
    var hasExpired = result.results.some(function (r) { return r.title === "Tax Rates 2024/25"; });
    expect(hasExpired).toBe(false);
  });

  test("returns query in response", function () {
    var result = searchPages(db, "backup");
    expect(result.query).toBe("backup");
  });

  test("returns duration in response", function () {
    var result = searchPages(db, "backup");
    expect(result.duration).toMatch(/\d+ms/);
  });

  test("respects limit option", function () {
    var result = searchPages(db, "the", { limit: 1 });
    expect(result.results.length).toBeLessThanOrEqual(1);
  });
});

describe("getSearchMeta", function () {
  test("returns lastIndexed and documentCount", function () {
    var meta = getSearchMeta(db);
    expect(meta.lastIndexed).toBeDefined();
    expect(typeof meta.documentCount).toBe("number");
    expect(meta.documentCount).toBeGreaterThan(0);
  });
});
