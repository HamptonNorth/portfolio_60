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
    const isActive = (currentPath === "/" && href === "/") || (currentPath !== "/" && href !== "/" && currentPath.startsWith(href));

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
 * @param {number} [options.timeout] - Request timeout in milliseconds (default: no timeout)
 * @returns {Promise<{ok: boolean, data?: any, error?: string, detail?: string}>}
 */
async function apiRequest(url, options = {}) {
  const defaultOptions = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  // Extract timeout option before merging
  const timeout = options.timeout;
  delete options.timeout;

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

  // Set up AbortController for timeout if specified
  let controller;
  let timeoutId;
  if (timeout) {
    controller = new AbortController();
    mergedOptions.signal = controller.signal;
    timeoutId = setTimeout(function () {
      controller.abort();
    }, timeout);
  }

  try {
    const response = await fetch(url, mergedOptions);

    // Clear timeout if set
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

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
    // Clear timeout if set
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Check if it was a timeout abort
    if (networkError.name === "AbortError") {
      return {
        ok: false,
        error: "Request timeout",
        detail: "The request took too long to complete (>" + Math.round(timeout / 1000) + "s)",
      };
    }

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

  container.innerHTML = '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3 mb-4">' + '<p class="text-base">' + escapeHtml(message) + "</p>" + "</div>";

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

  let html = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' + '<p class="text-base font-semibold">' + escapeHtml(message) + "</p>";

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

/**
 * @description Load and display the build time in the footer.
 * Fetches from /api/config/build-time and updates the element with id="build-time".
 */
async function loadBuildTime() {
  const buildTimeEl = document.getElementById("build-time");
  if (!buildTimeEl) return;

  try {
    const response = await fetch("/api/config/build-time");
    if (response.ok) {
      const data = await response.json();
      buildTimeEl.textContent = "Built: " + data.buildTime;
    }
  } catch {
    // Silently fail - not critical
  }
}

/**
 * @description Show a modal dialog with a title and message.
 * Replaces native alert() with a styled modal that has a proper title bar.
 * @param {string} title - The dialog title
 * @param {string} message - The message body (can include newlines)
 * @param {Object} [options={}] - Optional settings
 * @param {string} [options.type="info"] - Dialog type: "success", "error", or "info" (all use same nav bar styling)
 */
function showModal(title, message, options = {}) {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Convert newlines to <br> for display
  const formattedMessage = escapeHtml(message).replace(/\n/g, "<br>");

  // Create modal HTML - uses nav bar colour (brand-800) for title bar
  const modalHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">${escapeHtml(title)}</h3>
        </div>
        <div class="p-4">
          <p class="text-base text-brand-700 font-mono whitespace-pre-wrap">${formattedMessage}</p>
        </div>
        <div class="px-4 py-3 bg-brand-50 flex justify-end">
          <button id="app-modal-close" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">OK</button>
        </div>
      </div>
    </div>
  `;

  // Insert modal into DOM
  document.body.insertAdjacentHTML("beforeend", modalHtml);

  // Add close handler
  const modal = document.getElementById("app-modal");
  const closeBtn = document.getElementById("app-modal-close");

  function closeModal() {
    modal.remove();
  }

  closeBtn.addEventListener("click", closeModal);

  // Close on backdrop click
  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeModal();
    }
  });

  // Close on Escape key
  function handleEscape(event) {
    if (event.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  // Focus the close button
  closeBtn.focus();
}

/**
 * @description Show a modal dialog with HTML content (for rich layouts like tables).
 * The caller is responsible for escaping any user-supplied values before building the HTML.
 * @param {string} title - The modal title (will be escaped)
 * @param {string} htmlContent - Pre-built HTML content to display in the modal body
 */
function showModalHtml(title, htmlContent) {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const modalHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">${escapeHtml(title)}</h3>
        </div>
        <div class="p-4">
          ${htmlContent}
        </div>
        <div class="px-4 py-3 bg-brand-50 flex justify-end">
          <button id="app-modal-close" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">OK</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);

  const modal = document.getElementById("app-modal");
  const closeBtn = document.getElementById("app-modal-close");

  function closeModal() {
    modal.remove();
  }

  closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeModal();
    }
  });

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  closeBtn.focus();
}

// Initialise on page load
document.addEventListener("DOMContentLoaded", function () {
  highlightActiveNav();
  loadBuildTime();
});
