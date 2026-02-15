/**
 * @description List Viewer page — displays an embedded Google Sheets or
 * Excel Online spreadsheet selected from the Lists menu. Reads the item
 * index from the URL query string and fetches the corresponding config entry.
 */

/** @type {string[]} Allowed iframe source domains for security */
const ALLOWED_IFRAME_DOMAINS = ["docs.google.com", "onedrive.live.com"];

/**
 * @description Extract the src URL from an iframe HTML string.
 * @param {string} iframeHtml - The full iframe HTML tag
 * @returns {string|null} The src URL, or null if not found
 */
function extractIframeSrc(iframeHtml) {
  const match = iframeHtml.match(/src=["']([^"']+)["']/);
  return match ? match[1] : null;
}

/**
 * @description Append a range parameter to the iframe src URL. For Google
 * Sheets this adds &range=A3:F14. For Microsoft Excel this adds
 * &Item=NamedRange (requires a pre-defined named range in the workbook).
 * @param {string} src - The original iframe src URL
 * @param {string} spreadsheet - "google" or "microsoft"
 * @param {string} range - The range value to append
 * @returns {string} The src URL with range parameter appended
 */
function applyRange(src, spreadsheet, range) {
  if (!range) {
    return src;
  }
  const separator = src.includes("?") ? "&" : "?";
  if (spreadsheet === "microsoft") {
    return src + separator + "Item=" + encodeURIComponent(range);
  }
  // Google Sheets (default)
  return src + separator + "range=" + encodeURIComponent(range);
}

/**
 * @description Check whether an iframe src URL is from an allowed domain.
 * @param {string} src - The iframe src URL
 * @returns {boolean} True if the domain is allowed
 */
function isAllowedDomain(src) {
  try {
    const url = new URL(src);
    return ALLOWED_IFRAME_DOMAINS.some(function (domain) {
      return url.hostname === domain || url.hostname.endsWith("." + domain);
    });
  } catch {
    return false;
  }
}

/**
 * @description Initialise the list viewer page. Reads the index from the
 * query string, fetches the list items from the config API, and renders
 * the selected spreadsheet in a responsive iframe container.
 */
async function initListViewer() {
  const params = new URLSearchParams(window.location.search);
  const indexParam = params.get("index");

  if (indexParam === null) {
    showError("page-messages", "No list selected", "Use the Lists menu to choose a list to view.");
    return;
  }

  const index = parseInt(indexParam, 10);
  if (isNaN(index) || index < 0) {
    showError("page-messages", "Invalid list selection", "The list index is not valid.");
    return;
  }

  try {
    const result = await apiRequest("/api/config/lists");
    if (!result.ok) {
      showError("page-messages", result.error || "Failed to load lists", result.detail || "");
      return;
    }
    const items = result.data.items || [];

    if (items.length === 0) {
      showError("page-messages", "No lists configured", "Add list entries via Settings > Edit Settings.");
      return;
    }

    if (index >= items.length) {
      showError("page-messages", "List not found", "The selected list no longer exists. It may have been removed from settings.");
      return;
    }

    const item = items[index];
    const titleEl = document.getElementById("list-title");
    const container = document.getElementById("iframe-container");

    // Set page heading and document title
    titleEl.textContent = item.title;
    document.title = "Portfolio 60 \u2014 " + item.title;

    // Extract and validate the iframe src
    const rawSrc = extractIframeSrc(item.iframe);
    if (!rawSrc) {
      showError("page-messages", "Invalid embed code", "The iframe embed code for this list is missing a src attribute.");
      return;
    }

    if (!isAllowedDomain(rawSrc)) {
      showError("page-messages", "Blocked iframe source", "The iframe source domain is not in the allowed list (Google Sheets or Microsoft OneDrive).");
      return;
    }

    // Apply optional range parameter
    const src = applyRange(rawSrc, item.spreadsheet, item.range);

    // Build the iframe inside a responsive 16:9 container
    const wrapper = document.createElement("div");
    wrapper.className = "responsive-sheet-container";

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("title", item.title);

    wrapper.appendChild(iframe);
    container.appendChild(wrapper);
  } catch (err) {
    showError("page-messages", "Failed to load list", err.message || "An unexpected error occurred.");
  }
}

document.addEventListener("DOMContentLoaded", initListViewer);
