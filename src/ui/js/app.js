/**
 * @description Shared application logic for Portfolio 60 frontend.
 * Handles navigation highlighting, API fetch wrapper, and message display.
 */

/**
 * @description Highlight the active navigation link based on the current URL path.
 * Adds a visual indicator (underline and brighter text) to the matching nav item.
 */
function highlightActiveNav() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll("nav a[data-nav]");

  navLinks.forEach(function (link) {
    link.classList.remove("text-white", "border-b-2", "border-white", "font-semibold");

    const href = link.getAttribute("href");
    const isActive =
      (currentPath === "/" && href === "/") ||
      (currentPath !== "/" && href !== "/" && currentPath.startsWith(href));

    if (isActive) {
      link.classList.add("text-white", "border-b-2", "border-white", "font-semibold");
    }
  });
}

/**
 * @description Make a JSON API request to the server.
 * Handles JSON encoding/decoding, error responses, and network errors.
 * @param {string} url - The API endpoint URL (e.g. "/api/users")
 * @param {Object} [options={}] - Fetch options (method, body, etc.)
 * @returns {Promise<{ok: boolean, data?: any, error?: string, detail?: string}>}
 */
async function apiRequest(url, options = {}) {
  const defaultOptions = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  // Merge headers, keeping any custom headers from options
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {}),
    },
  };

  // If body is an object, stringify it
  if (mergedOptions.body && typeof mergedOptions.body === "object") {
    mergedOptions.body = JSON.stringify(mergedOptions.body);
  }

  try {
    const response = await fetch(url, mergedOptions);
    const data = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: data.error || "Request failed",
        detail: data.detail || "",
      };
    }

    return { ok: true, data: data };
  } catch (networkError) {
    return {
      ok: false,
      error: "Network error",
      detail: networkError.message,
    };
  }
}

/**
 * @description Show a success message in a target container element.
 * Creates a styled green message box that auto-dismisses after 5 seconds.
 * @param {string} containerId - The ID of the container element to show the message in
 * @param {string} message - The message text to display
 */
function showSuccess(containerId, message) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML =
    '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3 mb-4">' +
    '<p class="text-base">' + escapeHtml(message) + "</p>" +
    "</div>";

  // Auto-dismiss after 5 seconds
  setTimeout(function () {
    container.innerHTML = "";
  }, 5000);
}

/**
 * @description Show an error message in a target container element.
 * Creates a styled red message box that stays visible until replaced.
 * @param {string} containerId - The ID of the container element to show the error in
 * @param {string} message - The error message text to display
 * @param {string} [detail=""] - Optional additional detail text
 */
function showError(containerId, message, detail) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html =
    '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' +
    '<p class="text-base font-semibold">' + escapeHtml(message) + "</p>";

  if (detail) {
    html += '<p class="text-sm mt-1">' + escapeHtml(detail) + "</p>";
  }

  html += "</div>";
  container.innerHTML = html;
}

/**
 * @description Escape HTML special characters to prevent XSS when inserting text into the DOM.
 * @param {string} text - The raw text to escape
 * @returns {string} The escaped text safe for HTML insertion
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// Initialise on page load
document.addEventListener("DOMContentLoaded", function () {
  highlightActiveNav();
});
