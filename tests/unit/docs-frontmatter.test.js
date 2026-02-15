import { describe, test, expect } from "bun:test";
import { parseFrontMatter, ensureUnpublishedFrontMatter, isLapsed } from "../../src/server/services/docs-frontmatter.js";

describe("parseFrontMatter", function () {
  test("parses valid front matter with multiple fields", function () {
    var input = "---\ntitle: Test Page\nsummary: A test summary\ncreated: 2026-01-15\npublished: y\n---\n\nBody content here.";
    var result = parseFrontMatter(input);

    expect(result.attributes.title).toBe("Test Page");
    expect(result.attributes.summary).toBe("A test summary");
    expect(result.attributes.created).toBe("2026-01-15");
    expect(result.attributes.published).toBe("y");
    expect(result.body).toBe("Body content here.");
  });

  test("returns empty attributes when no front matter present", function () {
    var input = "# Just a heading\n\nSome body text.";
    var result = parseFrontMatter(input);

    expect(Object.keys(result.attributes)).toHaveLength(0);
    expect(result.body).toBe(input);
  });

  test("handles front matter with colons in values", function () {
    var input = "---\ntitle: Time: 10:30 AM\n---\n\nContent.";
    var result = parseFrontMatter(input);

    expect(result.attributes.title).toBe("Time: 10:30 AM");
  });

  test("handles lapse date field", function () {
    var input = "---\ntitle: Tax Rates 2025/26\nlapse: 2026-04-06\n---\n\nContent.";
    var result = parseFrontMatter(input);

    expect(result.attributes.lapse).toBe("2026-04-06");
  });

  test("handles front matter with only whitespace", function () {
    var input = "---\n \n---\n\nContent only.";
    var result = parseFrontMatter(input);

    expect(Object.keys(result.attributes)).toHaveLength(0);
    expect(result.body).toBe("Content only.");
  });

  test("handles sticky and read-mode fields", function () {
    var input = "---\ntitle: Sticky Page\nsticky: true\nread-mode: true\nstyle: modest\n---\n\nContent.";
    var result = parseFrontMatter(input);

    expect(result.attributes.sticky).toBe("true");
    expect(result.attributes["read-mode"]).toBe("true");
    expect(result.attributes.style).toBe("modest");
  });
});

describe("ensureUnpublishedFrontMatter", function () {
  test("adds default front matter when none exists", function () {
    var input = "# Just some content";
    var result = ensureUnpublishedFrontMatter(input, "github");

    expect(result).toContain("---");
    expect(result).toContain("title: Untitled");
    expect(result).toContain("published: n");
    expect(result).toContain("style: github");
    expect(result).toContain("# Just some content");
  });

  test("sets published to n when front matter already exists with published: y", function () {
    var input = "---\ntitle: My Page\npublished: y\n---\n\nContent.";
    var result = ensureUnpublishedFrontMatter(input, "modest");

    expect(result).toContain("published: n");
    expect(result).not.toContain("published: y");
    expect(result).toContain("title: My Page");
  });

  test("adds published: n when front matter exists without published field", function () {
    var input = "---\ntitle: My Page\n---\n\nContent.";
    var result = ensureUnpublishedFrontMatter(input, "github");

    expect(result).toContain("published: n");
    expect(result).toContain("title: My Page");
  });

  test("uses provided default style in generated front matter", function () {
    var input = "Just content, no front matter";
    var result = ensureUnpublishedFrontMatter(input, "modest");

    expect(result).toContain("style: modest");
  });

  test("falls back to github style when none provided", function () {
    var input = "Just content";
    var result = ensureUnpublishedFrontMatter(input, undefined);

    expect(result).toContain("style: github");
  });
});

describe("isLapsed", function () {
  test("returns false when no lapse date provided", function () {
    expect(isLapsed(undefined)).toBe(false);
    expect(isLapsed(null)).toBe(false);
    expect(isLapsed("")).toBe(false);
  });

  test("returns true for a date in the past", function () {
    expect(isLapsed("2020-01-01")).toBe(true);
  });

  test("returns false for a date in the future", function () {
    expect(isLapsed("2099-12-31")).toBe(false);
  });
});
