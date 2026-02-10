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

  // Reset all sub-links and parent triggers
  navLinks.forEach(function (link) {
    link.classList.remove("text-white", "border-b-2", "border-white", "font-semibold", "bg-brand-100", "font-semibold");
  });
  document.querySelectorAll("nav [data-nav-parent]").forEach(function (parent) {
    parent.classList.remove("text-white", "border-b-2", "border-white", "font-semibold");
  });

  navLinks.forEach(function (link) {
    const href = link.getAttribute("href");
    const isActive = (currentPath === "/" && href === "/") || (currentPath !== "/" && href !== "/" && currentPath.startsWith(href));

    if (isActive) {
      const isInDropdown = link.closest("li.relative");

      if (isInDropdown) {
        // Highlight the sub-link in the dropdown (bold + subtle background)
        link.classList.add("font-semibold", "bg-brand-100");

        // Also highlight the top-level parent trigger in the nav bar
        const parentTrigger = isInDropdown.querySelector("[data-nav-parent]");
        if (parentTrigger) {
          parentTrigger.classList.add("text-white", "border-b-2", "border-white", "font-semibold");
        }
      } else {
        // For top-level links (Home), highlight directly
        link.classList.add("text-white", "border-b-2", "border-white", "font-semibold");
      }
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

    // If the response was redirected to the passphrase page (auth expired),
    // show a clear message instead of a cryptic JSON parse error.
    if (response.redirected && response.url && response.url.includes("passphrase")) {
      return {
        ok: false,
        error: "Session expired",
        detail: "Please refresh the page and enter your passphrase.",
      };
    }

    // Guard against non-JSON responses (e.g. HTML error pages)
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return {
        ok: false,
        error: response.ok ? "Unexpected response" : "Request failed (HTTP " + response.status + ")",
        detail: "Server returned " + contentType.split(";")[0] + " instead of JSON",
      };
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

/**
 * @description Show the Edit Settings modal. Loads the raw config.json into
 * a textarea for editing, with Save and Cancel buttons.
 */
async function showEditSettingsModal() {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Show loading modal while fetching config
  const loadingHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 overflow-hidden">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">Edit Settings</h3>
        </div>
        <div class="p-6 text-center text-brand-500">Loading configuration...</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", loadingHtml);

  // Fetch the raw config
  const result = await apiRequest("/api/config/raw");
  const modal = document.getElementById("app-modal");

  if (!result.ok) {
    modal.remove();
    showModal("Error", "Failed to load configuration: " + (result.error || "Unknown error"));
    return;
  }

  const configContent = result.data.content;
  const configPath = result.data.path;

  // Replace loading content with the editor
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 overflow-hidden">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">Edit Settings</h3>
      </div>
      <div class="p-4">
        <p class="text-sm text-brand-600 mb-2">Edit config.json configuration. Changes take effect immediately on save.</p>
        <p class="text-xs text-brand-400 mb-3">Save location: ${escapeHtml(configPath)}</p>
        <div id="settings-error" class="hidden mb-3 bg-red-50 border border-red-300 text-error rounded-lg px-3 py-2 text-sm"></div>
        <textarea id="settings-editor" class="w-full font-mono text-sm border-2 border-brand-300 rounded-lg p-3 focus:outline-none focus:border-brand-500 bg-brand-25 text-brand-800" rows="20" spellcheck="false">${escapeHtml(configContent)}</textarea>
      </div>
      <div class="px-4 py-3 bg-brand-50 flex justify-between">
        <button id="settings-reset-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Reset to Defaults</button>
        <div class="flex gap-3">
          <button id="settings-cancel-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Cancel</button>
          <button id="settings-save-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">Save</button>
        </div>
      </div>
    </div>
  `;

  const editor = document.getElementById("settings-editor");
  const errorDiv = document.getElementById("settings-error");
  const saveBtn = document.getElementById("settings-save-btn");
  const cancelBtn = document.getElementById("settings-cancel-btn");
  const resetBtn = document.getElementById("settings-reset-btn");

  function closeSettingsModal() {
    modal.remove();
  }

  cancelBtn.addEventListener("click", closeSettingsModal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeSettingsModal();
    }
  });

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeSettingsModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  // Save handler — validate JSON and send to server
  saveBtn.addEventListener("click", async function () {
    errorDiv.classList.add("hidden");
    const content = editor.value;

    // Client-side JSON validation
    try {
      JSON.parse(content);
    } catch (parseErr) {
      errorDiv.textContent = "Invalid JSON: " + parseErr.message;
      errorDiv.classList.remove("hidden");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const saveResult = await apiRequest("/api/config/raw", {
      method: "PUT",
      body: { content: content },
    });

    if (saveResult.ok) {
      closeSettingsModal();
      document.removeEventListener("keydown", handleEscape);
    } else {
      errorDiv.textContent = "Save failed: " + (saveResult.error || "Unknown error") + (saveResult.detail ? " — " + saveResult.detail : "");
      errorDiv.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  // Reset to defaults — loads the DEFAULTS object shape
  resetBtn.addEventListener("click", function () {
    const defaults = {
      allowed_providers: [],
      scheduling: {
        enabled: false,
        cron: "0 8 * * 6",
        runOnStartupIfMissed: true,
        startupDelayMinutes: 10,
      },
      retry: {
        delayMinutes: 5,
        maxAttempts: 5,
      },
      scrapeDelayProfile: "cron",
      scraperSites: {
        _readme: "Known website patterns for price/benchmark scraping.",
        _format: {},
        sites: [],
      },
    };
    editor.value = JSON.stringify(defaults, null, 2);
    errorDiv.classList.add("hidden");
  });

  editor.focus();
}

/**
 * @description Show the About modal with system information useful for
 * first-line support.
 */
async function showAboutModal() {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Show loading modal
  const loadingHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4 overflow-hidden">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">About Portfolio 60</h3>
        </div>
        <div class="p-6 text-center text-brand-500">Loading system information...</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", loadingHtml);

  const result = await apiRequest("/api/config/system-info");
  const modal = document.getElementById("app-modal");

  if (!result.ok) {
    modal.remove();
    showModal("Error", "Failed to load system information: " + (result.error || "Unknown error"));
    return;
  }

  const info = result.data;

  // Build the info text block (same format as the screenshot reference)
  const infoLines = [info.appName + " v" + info.version, "Built: " + info.buildTime, "", "--- System ---", "Platform:   " + info.platform, "Arch:       " + info.arch, "OS:         " + info.os, "Runtime:    " + info.runtime, "", "--- Paths ---", "Config:     " + info.configPath, "Database:   " + info.dbPath, "Backups:    " + info.backupPath].join("\n");

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4 overflow-hidden">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">About Portfolio 60</h3>
      </div>
      <div class="p-4">
        <pre id="about-info-text" class="bg-brand-25 border border-brand-200 rounded-lg p-4 text-sm font-mono text-brand-700 whitespace-pre overflow-x-auto">${escapeHtml(infoLines)}</pre>
      </div>
      <div class="px-4 py-3 bg-brand-50 flex justify-between">
        <button id="about-copy-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Copy to Clipboard</button>
        <button id="about-ok-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">OK</button>
      </div>
    </div>
  `;

  const okBtn = document.getElementById("about-ok-btn");
  const copyBtn = document.getElementById("about-copy-btn");

  function closeAboutModal() {
    modal.remove();
  }

  okBtn.addEventListener("click", closeAboutModal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeAboutModal();
    }
  });

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeAboutModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  copyBtn.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(infoLines);
      copyBtn.textContent = "Copied!";
      setTimeout(function () {
        copyBtn.textContent = "Copy to Clipboard";
      }, 2000);
    } catch {
      // Fallback for environments without clipboard API
      copyBtn.textContent = "Copy failed";
      setTimeout(function () {
        copyBtn.textContent = "Copy to Clipboard";
      }, 2000);
    }
  });

  okBtn.focus();
}

/**
 * @description Check whether the Scraper Testing feature is enabled and show/hide
 * the nav link accordingly. Fetches the flag from the config API.
 */
async function checkScraperTestingNav() {
  const navLink = document.getElementById("nav-scraper-testing");
  if (!navLink) return;

  try {
    const response = await fetch("/api/config/scraper-testing-enabled");
    if (response.ok) {
      const data = await response.json();
      if (data.enabled) {
        navLink.classList.remove("hidden");
      }
    }
  } catch {
    // Silently fail — link stays hidden
  }
}

// Initialise on page load
document.addEventListener("DOMContentLoaded", function () {
  highlightActiveNav();
  loadBuildTime();
  checkScraperTestingNav();
});
