import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * @description Integration tests for the docs API routes.
 * Starts the server on a unique port and tests each endpoint.
 */

var PORT = 1445;
var BASE_URL = "http://localhost:" + PORT;
var serverProcess;
var testDocsDir = resolve("docs");

beforeAll(async function () {
  // Create test docs directories and sample files
  mkdirSync(join(testDocsDir, "guide"), { recursive: true });
  mkdirSync(join(testDocsDir, "notes"), { recursive: true });

  writeFileSync(
    join(testDocsDir, "guide", "test-page.md"),
    "---\ntitle: Test Page\nsummary: A test document\ncreated: 2026-01-15\npublished: y\n---\n\n# Test Content\n\nThis is a test page for the docs subsystem.\n"
  );

  writeFileSync(
    join(testDocsDir, "guide", "draft-page.md"),
    "---\ntitle: Draft Document\nsummary: This is unpublished\ncreated: 2026-01-20\npublished: n\n---\n\nDraft content.\n"
  );

  writeFileSync(
    join(testDocsDir, "guide", "expired-page.md"),
    "---\ntitle: Expired Doc\nsummary: This has lapsed\ncreated: 2025-01-01\npublished: y\nlapse: 2025-06-01\n---\n\nExpired content.\n"
  );

  // Start the server
  serverProcess = Bun.spawn(["bun", "run", "src/server/index.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready
  var ready = false;
  for (var i = 0; i < 30; i++) {
    try {
      var res = await fetch(BASE_URL + "/api/docs/config");
      if (res.ok) {
        ready = true;
        break;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(function (r) { setTimeout(r, 200); });
  }

  if (!ready) {
    throw new Error("Server failed to start on port " + PORT);
  }
});

afterAll(function () {
  if (serverProcess) {
    serverProcess.kill();
  }

  // Clean up test files
  try {
    rmSync(join(testDocsDir, "guide", "test-page.md"), { force: true });
    rmSync(join(testDocsDir, "guide", "draft-page.md"), { force: true });
    rmSync(join(testDocsDir, "guide", "expired-page.md"), { force: true });
    rmSync(join(testDocsDir, "guide", "uploaded-test.md"), { force: true });
  } catch (e) {
    // Best effort cleanup
  }
});

describe("GET /api/docs/config", function () {
  test("returns categories and styles", async function () {
    var res = await fetch(BASE_URL + "/api/docs/config");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.categories).toBeDefined();
    expect(data.categories.guide).toBeDefined();
    expect(data.categories.guide.label).toBe("User Guide");
    expect(data.categories.notes).toBeDefined();
    expect(data.styles).toBeDefined();
    expect(data.styles.github).toBeDefined();
    expect(data.styles.modest).toBeDefined();
  });
});

describe("GET /api/docs/list/:category", function () {
  test("lists published pages in a category", async function () {
    var res = await fetch(BASE_URL + "/api/docs/list/guide");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.category).toBe("guide");
    expect(Array.isArray(data.pages)).toBe(true);

    // Should have test-page and draft-page, but not expired-page
    var titles = data.pages.map(function (p) { return p.title; });
    expect(titles).toContain("Test Page");
    expect(titles).toContain("Draft Document");
    expect(titles).not.toContain("Expired Doc");
  });

  test("returns empty array for nonexistent category", async function () {
    var res = await fetch(BASE_URL + "/api/docs/list/nonexistent");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.pages).toHaveLength(0);
  });

  test("rejects path traversal", async function () {
    var res = await fetch(BASE_URL + "/api/docs/list/..%2Fsrc");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/docs/content/:category/:slug", function () {
  test("returns rendered HTML and style config for a published page", async function () {
    var res = await fetch(BASE_URL + "/api/docs/content/guide/test-page");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.meta).toBeDefined();
    expect(data.meta.title).toBe("Test Page");
    expect(data.html).toContain("Test Content");
    expect(data.html).toContain("<h1>");
    expect(data.style).toBeDefined();
    expect(data.style.name).toBeDefined();
  });

  test("returns 410 for lapsed page", async function () {
    var res = await fetch(BASE_URL + "/api/docs/content/guide/expired-page");
    expect(res.status).toBe(410);
  });

  test("returns 404 for nonexistent page", async function () {
    var res = await fetch(BASE_URL + "/api/docs/content/guide/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/docs/raw/:category/:slug", function () {
  test("returns raw markdown content", async function () {
    var res = await fetch(BASE_URL + "/api/docs/raw/guide/test-page");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.raw).toContain("---");
    expect(data.raw).toContain("title: Test Page");
    expect(data.meta.title).toBe("Test Page");
    expect(data.body).toContain("Test Content");
    expect(data.category).toBe("guide");
    expect(data.slug).toBe("test-page");
  });

  test("returns 404 for nonexistent page", async function () {
    var res = await fetch(BASE_URL + "/api/docs/raw/guide/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/docs/raw/:category/:slug", function () {
  test("saves edited markdown content", async function () {
    var newContent = "---\ntitle: Test Page Updated\nsummary: Updated summary\ncreated: 2026-01-15\npublished: y\n---\n\n# Updated Content\n\nThis content was updated.\n";

    var res = await fetch(BASE_URL + "/api/docs/raw/guide/test-page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.success).toBe(true);

    // Verify the update by reading back
    var readRes = await fetch(BASE_URL + "/api/docs/raw/guide/test-page");
    var readData = await readRes.json();
    expect(readData.meta.title).toBe("Test Page Updated");

    // Restore original content
    var originalContent = "---\ntitle: Test Page\nsummary: A test document\ncreated: 2026-01-15\npublished: y\n---\n\n# Test Content\n\nThis is a test page for the docs subsystem.\n";
    await fetch(BASE_URL + "/api/docs/raw/guide/test-page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: originalContent }),
    });
  });

  test("rejects non-string content", async function () {
    var res = await fetch(BASE_URL + "/api/docs/raw/guide/test-page", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: 123 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/docs/upload/:category", function () {
  test("uploads a new markdown file", async function () {
    var content = "---\ntitle: Uploaded Test\nsummary: Uploaded via test\ncreated: 2026-02-15\npublished: y\n---\n\nUploaded content.\n";
    var file = new File([content], "uploaded-test.md", { type: "text/markdown" });
    var formData = new FormData();
    formData.append("file", file);

    var res = await fetch(BASE_URL + "/api/docs/upload/guide", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(201);

    var data = await res.json();
    expect(data.success).toBe(true);
    expect(data.filename).toBe("uploaded-test.md");
  });

  test("rejects duplicate upload", async function () {
    var content = "---\ntitle: Duplicate\n---\n\nContent.";
    var file = new File([content], "uploaded-test.md", { type: "text/markdown" });
    var formData = new FormData();
    formData.append("file", file);

    var res = await fetch(BASE_URL + "/api/docs/upload/guide", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(409);
  });

  test("rejects non-markdown files", async function () {
    var file = new File(["not markdown"], "test.txt", { type: "text/plain" });
    var formData = new FormData();
    formData.append("file", file);

    var res = await fetch(BASE_URL + "/api/docs/upload/guide", {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/docs/:category/:slug", function () {
  test("deletes an existing page", async function () {
    // First ensure the uploaded test file exists
    var checkRes = await fetch(BASE_URL + "/api/docs/raw/guide/uploaded-test");
    if (checkRes.status !== 200) {
      // Upload it first
      var content = "---\ntitle: To Delete\n---\n\nContent.";
      var file = new File([content], "uploaded-test.md", { type: "text/markdown" });
      var formData = new FormData();
      formData.append("file", file);
      await fetch(BASE_URL + "/api/docs/upload/guide", { method: "POST", body: formData });
    }

    var res = await fetch(BASE_URL + "/api/docs/guide/uploaded-test", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.success).toBe(true);

    // Verify it's gone
    var verifyRes = await fetch(BASE_URL + "/api/docs/raw/guide/uploaded-test");
    expect(verifyRes.status).toBe(404);
  });

  test("returns 404 for nonexistent page", async function () {
    var res = await fetch(BASE_URL + "/api/docs/guide/does-not-exist", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/docs/search", function () {
  test("returns search results for valid query", async function () {
    // First reindex to populate the FTS index
    await fetch(BASE_URL + "/api/docs/reindex", { method: "POST" });

    var res = await fetch(BASE_URL + "/api/docs/search?q=test");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.query).toBe("test");
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("returns error for short query", async function () {
    var res = await fetch(BASE_URL + "/api/docs/search?q=ab");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.error).toBeDefined();
  });
});

describe("POST /api/docs/reindex", function () {
  test("rebuilds the search index", async function () {
    var res = await fetch(BASE_URL + "/api/docs/reindex", { method: "POST" });
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.indexed).toBe("number");
    expect(typeof data.categories).toBe("number");
  });
});

describe("GET /api/docs/search-meta", function () {
  test("returns search index metadata", async function () {
    var res = await fetch(BASE_URL + "/api/docs/search-meta");
    expect(res.status).toBe(200);

    var data = await res.json();
    expect(data.lastIndexed).toBeDefined();
    expect(typeof data.documentCount).toBe("number");
  });
});

describe("auth gate", function () {
  test("docs API is accessible without authentication", async function () {
    // The docs routes should be unprotected
    var res = await fetch(BASE_URL + "/api/docs/config");
    expect(res.status).toBe(200);
  });
});
