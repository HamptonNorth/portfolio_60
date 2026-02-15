/**
 * @description Front matter parser and helpers for the docs subsystem.
 * Parses YAML front matter from markdown files and provides utilities
 * for ensuring default front matter on uploaded files.
 */

/**
 * @description Parse YAML front matter from markdown content.
 * Expects front matter delimited by --- on its own line at the start
 * of the file. Returns an object with attributes and the remaining body.
 * @param {string} text - Raw markdown file content
 * @returns {{ attributes: Object, body: string }} Parsed front matter and body
 */
export function parseFrontMatter(text) {
  var match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { attributes: {}, body: text };
  }

  var attributes = {};
  var yamlLines = match[1].split("\n");

  yamlLines.forEach(function (line) {
    var colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      var key = line.slice(0, colonIndex).trim();
      var value = line.slice(colonIndex + 1).trim();
      attributes[key] = value;
    }
  });

  var body = text.replace(match[0], "").trim();
  return { attributes: attributes, body: body };
}

/**
 * @description Ensure uploaded markdown content has front matter with published: n.
 * If the content has no front matter, adds a default block. If it already has
 * front matter, sets published to "n" so new uploads are not visible until reviewed.
 * @param {string} content - Raw markdown content
 * @param {string} defaultStyle - Default style name for this category
 * @returns {string} Content with front matter guaranteed
 */
export function ensureUnpublishedFrontMatter(content, defaultStyle) {
  var hasFrontMatter = content.trim().startsWith("---");

  if (!hasFrontMatter) {
    var today = new Date().toISOString().split("T")[0];
    var defaultFrontMatter = "---\ntitle: Untitled\nsummary:\ncreated: " + today + "\npublished: n\nstyle: " + (defaultStyle || "github") + "\n---\n\n";
    return defaultFrontMatter + content;
  }

  // Has front matter — ensure published: n
  var match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return content;
  }

  var frontMatter = match[1];
  var body = content.slice(match[0].length);

  if (/^published\s*:/m.test(frontMatter)) {
    frontMatter = frontMatter.replace(/^(published\s*:\s*).*$/m, "$1n");
  } else {
    frontMatter = frontMatter.trim() + "\npublished: n";
  }

  return "---\n" + frontMatter + "\n---" + body;
}

/**
 * @description Check whether a page has lapsed (expired) based on its
 * front matter lapse date. Returns true if the lapse date is in the past.
 * @param {string|undefined} lapseDate - ISO-8601 date string, or undefined
 * @returns {boolean} True if the page has expired
 */
export function isLapsed(lapseDate) {
  if (!lapseDate) {
    return false;
  }
  return new Date() > new Date(lapseDate);
}
