/**
 * @description Page logic for the docs detail view.
 * Loads a single markdown page, renders it with the appropriate style CSS,
 * and provides code highlighting and copy-to-clipboard for code blocks.
 */

/* global escapeHtml, showError, hljs */

/** @type {string} Current category from URL query parameter */
var currentCategory = "";

/** @type {string} Current slug from URL query parameter */
var currentSlug = "";

/**
 * @description Initialise the page on load. Reads category and slug from
 * the URL query string and loads the page content.
 */
function init() {
  var params = new URLSearchParams(window.location.search);
  currentCategory = params.get("category") || "";
  currentSlug = params.get("slug") || "";

  if (!currentCategory || !currentSlug) {
    document.getElementById("markdown-content").innerHTML =
      '<p class="text-brand-500">Missing category or slug parameter.</p>';
    return;
  }

  // Set up back link
  document.getElementById("back-link").href =
    "/pages/docs-list.html?category=" + encodeURIComponent(currentCategory);

  // Set up edit button
  document.getElementById("edit-btn").addEventListener("click", function () {
    window.location.href =
      "/pages/docs-list.html?category=" + encodeURIComponent(currentCategory) + "&edit=" + encodeURIComponent(currentSlug);
  });

  loadPage();
}

/**
 * @description Load the page content from the API and render it.
 */
async function loadPage() {
  try {
    var response = await fetch(
      "/api/docs/content/" + encodeURIComponent(currentCategory) + "/" + encodeURIComponent(currentSlug)
    );

    if (response.status === 410) {
      document.getElementById("page-title").textContent = "Expired Document";
      document.getElementById("markdown-content").innerHTML =
        '<div class="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">' +
        '<p class="text-amber-700 text-lg">This document has expired.</p>' +
        '<p class="text-amber-500 mt-2">The lapse date for this document has passed and it is no longer available.</p>' +
        "</div>";
      return;
    }

    if (!response.ok) {
      var errData = await response.json();
      document.getElementById("page-title").textContent = "Not Found";
      document.getElementById("markdown-content").innerHTML =
        '<p class="text-brand-500">' + escapeHtml(errData.error || "Page not found") + "</p>";
      return;
    }

    var data = await response.json();
    var meta = data.meta;
    var html = data.html;
    var styleConfig = data.style;
    var fontLinks = data.fontLinks || [];

    // Set page title
    var title = meta.title || "Untitled";
    document.getElementById("page-title").textContent = title;
    document.title = "Portfolio 60 — " + title;

    // Set date
    if (meta.created) {
      var d = new Date(meta.created);
      if (!isNaN(d)) {
        document.getElementById("page-date").textContent = d.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
    }

    // Inject style CSS
    if (styleConfig && styleConfig.cssFile) {
      injectStyleCss(styleConfig.cssFile);
    }

    // Inject font links
    for (var i = 0; i < fontLinks.length; i++) {
      injectFontLink(fontLinks[i]);
    }

    // Apply wrapper class to the content container
    var contentEl = document.getElementById("markdown-content");
    if (styleConfig && styleConfig.wrapperClass) {
      // Remove any existing prose classes if removeProse is set
      if (styleConfig.removeProse) {
        contentEl.className = styleConfig.wrapperClass + " bg-white rounded-lg border border-brand-200 p-8";
      } else {
        contentEl.className += " " + styleConfig.wrapperClass;
      }
    }

    // Apply read mode (narrow width)
    if (meta.readMode || meta["read-mode"] === "true") {
      contentEl.style.maxWidth = "720px";
      contentEl.style.margin = "0 auto";
    }

    // Render the HTML content
    contentEl.innerHTML = html;

    // Apply syntax highlighting to code blocks
    applyHighlighting();

    // Add copy buttons to code blocks
    addCopyButtons();
  } catch (err) {
    showError("page-messages", "Failed to load document", err.message);
  }
}

/**
 * @description Inject a markdown style CSS file into the page head.
 * Uses preload to prevent FOUC.
 * @param {string} cssFile - CSS filename in /css/md-styles/
 */
function injectStyleCss(cssFile) {
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/css/md-styles/" + cssFile;
  document.head.appendChild(link);
}

/**
 * @description Inject a font link (Google Fonts or CDN) into the page head.
 * @param {string} url - Full URL of the font CSS
 */
function injectFontLink(url) {
  // Add preconnect for Google Fonts
  if (url.includes("googleapis.com")) {
    var preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    document.head.appendChild(preconnect1);

    var preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "";
    document.head.appendChild(preconnect2);
  }

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * @description Apply syntax highlighting to all code blocks using highlight.js.
 */
function applyHighlighting() {
  if (typeof hljs !== "undefined") {
    document.querySelectorAll("#markdown-content pre code").forEach(function (block) {
      hljs.highlightElement(block);
    });
  }
}

/**
 * @description Add a "Copy" button to each code block.
 */
function addCopyButtons() {
  document.querySelectorAll("#markdown-content pre").forEach(function (pre) {
    var wrapper = document.createElement("div");
    wrapper.style.position = "relative";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    var btn = document.createElement("button");
    btn.textContent = "Copy";
    btn.className = "absolute top-2 right-2 text-xs bg-brand-100 hover:bg-brand-200 text-brand-600 px-2 py-1 rounded transition-colors";
    btn.style.position = "absolute";
    btn.addEventListener("click", function () {
      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "Copied!";
        setTimeout(function () {
          btn.textContent = "Copy";
        }, 2000);
      });
    });
    wrapper.appendChild(btn);
  });
}

// =============================================================================
// Init
// =============================================================================

document.addEventListener("DOMContentLoaded", init);
