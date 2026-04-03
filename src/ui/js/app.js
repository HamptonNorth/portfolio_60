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
  const currentSearch = window.location.search;
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
    const hrefUrl = new URL(href, window.location.origin);
    const hrefPath = hrefUrl.pathname;
    const hrefSearch = hrefUrl.search;

    // Match: exact path for "/", or path prefix match for others.
    // If the link has query params, those must also match.
    let isActive = false;
    if (currentPath === "/" && hrefPath === "/") {
      isActive = true;
    } else if (hrefPath !== "/" && currentPath.startsWith(hrefPath)) {
      if (hrefSearch) {
        // Link has query params — require exact match
        isActive = currentSearch === hrefSearch;
      } else {
        isActive = true;
      }
    }

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
        status: response.status,
        error: data.error || "Request failed",
        detail: data.detail || "",
        data: data,
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
 * @description Build an FT Markets research URL for a given public_id and currency code.
 * Returns null if the publicId is not recognised or empty.
 * @param {string} publicId - ISIN, Exchange:Ticker, or Ticker:Exchange:Currency
 * @param {string} currencyCode - 3-letter currency code (e.g. "GBP")
 * @returns {string|null} The FT Markets tearsheet URL, or null
 */
function buildFtMarketsUrl(publicId, currencyCode) {
  if (!publicId || typeof publicId !== "string") return null;
  const trimmed = publicId.trim().toUpperCase();
  if (!trimmed) return null;

  // ISIN: 2 uppercase letters + 10 alphanumeric
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(trimmed)) {
    if (!currencyCode) return null;
    return "https://markets.ft.com/data/funds/tearsheet/summary?s=" + trimmed + ":" + currencyCode.trim().toUpperCase();
  }

  // ETF: TICKER:EXCHANGE:CURRENCY (two colons)
  if (/^[A-Z0-9.]{1,10}:[A-Z]{1,10}:[A-Z]{3}$/.test(trimmed)) {
    return "https://markets.ft.com/data/etfs/tearsheet/summary?s=" + trimmed;
  }

  // Ticker: EXCHANGE:TICKER (one colon)
  if (/^[A-Z]{1,10}:[A-Z0-9.]{1,10}$/.test(trimmed)) {
    const parts = trimmed.split(":");
    return "https://markets.ft.com/data/equities/tearsheet/summary?s=" + parts[1] + ":" + parts[0];
  }

  return null;
}

/**
 * @description Build research link HTML for an investment description. If both
 * FT Markets and Morningstar URLs are available, renders a hover tooltip with
 * both links. If only one is available, renders a direct link. If neither,
 * returns the plain escaped description text.
 * @param {string} description - The investment description text
 * @param {string|null} publicId - ISIN, Exchange:Ticker, or ETF code
 * @param {string|null} currencyCode - 3-letter currency code
 * @param {string|null} morningstarId - Cached morningstar_id (secId|universe)
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.stopPropagation] - Add onclick="event.stopPropagation()" to links
 * @returns {string} HTML string for the research link(s)
 */
function buildResearchLinkHtml(description, publicId, currencyCode, morningstarId, options) {
  const escaped = escapeHtml(description);
  const ftUrl = buildFtMarketsUrl(publicId, currencyCode);
  const msUrl = buildMorningstarUrl(morningstarId);
  const stopClick = (options && options.stopPropagation) ? ' onclick="event.stopPropagation()"' : "";

  if (ftUrl && msUrl) {
    // Both links available — show hover tooltip with both options
    let html = '<span class="relative inline-block research-link-wrapper"' + stopClick + ">";
    html += '<span class="text-blue-700 cursor-pointer hover:underline">' + escaped + "</span>";
    html += '<div class="research-link-tooltip hidden absolute left-0 top-full z-50 mt-0.5 bg-white border border-brand-200 rounded shadow-lg py-1 min-w-[180px]">';
    html += '<a href="' + escapeHtml(ftUrl) + '" target="_blank" rel="noopener" class="block px-3 py-1.5 text-sm text-blue-700 hover:bg-brand-50 hover:underline"' + stopClick + ">FT Markets</a>";
    html += '<a href="' + escapeHtml(msUrl) + '" target="_blank" rel="noopener" class="block px-3 py-1.5 text-sm text-blue-700 hover:bg-brand-50 hover:underline"' + stopClick + ">Morningstar</a>";
    html += "</div></span>";
    return html;
  }

  if (ftUrl) {
    return '<a href="' + escapeHtml(ftUrl) + '" target="_blank" rel="noopener" class="text-blue-700 hover:underline" title="Open FT Markets research page"' + stopClick + ">" + escaped + "</a>";
  }

  if (msUrl) {
    return '<a href="' + escapeHtml(msUrl) + '" target="_blank" rel="noopener" class="text-blue-700 hover:underline" title="Open Morningstar research page"' + stopClick + ">" + escaped + "</a>";
  }

  return escaped;
}

/**
 * @description Build a Morningstar UK research page URL from a cached morningstar_id.
 * The morningstar_id is stored as "secId|universe" (e.g. "0P0000X3IO|FOGBR$$ALL").
 * The universe prefix determines the page category (funds, etf, or stocks).
 * @param {string} morningstarId - The cached morningstar_id (format "secId|universe")
 * @returns {string|null} The Morningstar research URL, or null if input is invalid
 */
function buildMorningstarUrl(morningstarId) {
  if (!morningstarId || typeof morningstarId !== "string") return null;
  const parts = morningstarId.split("|");
  const secId = parts[0].trim();
  if (!secId) return null;
  const universe = (parts[1] || "").trim();
  let category = "funds";
  if (universe.substring(0, 2) === "FE") {
    category = "etf";
  } else if (universe.substring(0, 2) === "E0") {
    category = "stocks";
  }
  return "https://www.morningstar.co.uk/uk/" + category + "/snapshot/snapshot.aspx?id=" + secId;
}

/**
 * @description Create a line-numbered editor wrapper around a textarea.
 * Adds a line-number gutter on the left that scrolls in sync with the textarea.
 * Call this after the textarea is in the DOM.
 * @param {HTMLTextAreaElement} textarea - The textarea element to enhance
 */
function attachLineNumbers(textarea) {
  // Wrap the textarea in a flex container with a gutter.
  // Use a fixed height so the content scrolls rather than expanding the modal.
  const wrapper = document.createElement("div");
  wrapper.className = "flex border-2 border-brand-300 rounded-lg overflow-hidden focus-within:border-brand-500";
  wrapper.style.height = "70vh";

  const gutter = document.createElement("div");
  gutter.className = "bg-brand-100 text-brand-400 text-sm font-mono text-right select-none py-3 px-2 overflow-hidden";
  gutter.style.minWidth = "3rem";
  gutter.style.whiteSpace = "pre";
  gutter.style.lineHeight = "1.425";

  // Remove border/rounding from textarea since wrapper handles it.
  // Set explicit height so the textarea scrolls within the wrapper.
  textarea.classList.remove("border-2", "border-brand-300", "rounded-lg", "focus:outline-none", "focus:border-brand-500");
  textarea.classList.add("border-0", "outline-none", "rounded-none");
  textarea.style.lineHeight = "1.425";
  textarea.style.resize = "none";
  textarea.style.height = "100%";
  textarea.removeAttribute("rows");

  // Insert wrapper in place of textarea
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(gutter);
  wrapper.appendChild(textarea);

  function updateLineNumbers() {
    const lineCount = textarea.value.split("\n").length;
    let nums = "";
    for (let i = 1; i <= lineCount; i++) {
      nums += i + "\n";
    }
    gutter.textContent = nums;
  }

  function syncScroll() {
    gutter.scrollTop = textarea.scrollTop;
  }

  textarea.addEventListener("scroll", syncScroll);
  textarea.addEventListener("input", updateLineNumbers);
  updateLineNumbers();
}

/**
 * @description Build a user-friendly JSON parse error message with line and column info.
 * Extracts the position from the native error message and converts it to line:column.
 * @param {string} jsonText - The JSON text that failed to parse
 * @param {SyntaxError} parseErr - The native JSON parse error
 * @returns {string} A message like "Invalid JSON at line 12, column 5: Unexpected token }"
 */
function formatJsonError(jsonText, parseErr) {
  const msg = parseErr.message;

  // Try to extract character position from error message (varies by engine)
  // Bun/V8: "... at position 123" or "... at line 4 column 5"
  const posMatch = msg.match(/position\s+(\d+)/i);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const before = jsonText.slice(0, pos);
    const line = (before.match(/\n/g) || []).length + 1;
    const lastNewline = before.lastIndexOf("\n");
    const column = pos - lastNewline;
    return "Invalid JSON at line " + line + ", column " + column + ": " + msg;
  }

  const lineMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineMatch) {
    return "Invalid JSON at line " + lineMatch[1] + ", column " + lineMatch[2] + ": " + msg;
  }

  return "Invalid JSON: " + msg;
}

/**
 * @description Auto-fix unescaped double quotes inside "iframe" JSON string values.
 * When a user pastes an iframe tag from Google Sheets or Excel into user-settings.json,
 * the inner quotes (e.g. src="...") break JSON parsing. This function finds
 * "iframe": "..." lines and escapes the inner double quotes so the JSON is valid.
 * Already-escaped quotes (\") are left unchanged.
 * @param {string} jsonText - The raw JSON text to fix
 * @returns {string} The JSON text with iframe quotes escaped
 */
function fixIframeQuotes(jsonText) {
  // Match "iframe": "..." capturing the value between the outer quotes.
  // The value starts after ": " and runs to the line's trailing quote before
  // optional comma/whitespace. We use a line-by-line approach for clarity.
  const lines = jsonText.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for lines containing "iframe": "..."
    const match = line.match(/^(\s*"iframe"\s*:\s*")(.*)("\s*,?\s*)$/);
    if (!match) {
      continue;
    }

    let value = match[2];

    // Undo any existing escapes so we can re-escape uniformly
    value = value.replace(/\\"/g, '"');

    // Now escape all double quotes inside the value
    value = value.replace(/"/g, '\\"');

    lines[i] = match[1] + value + match[3];
  }

  return lines.join("\n");
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
 * @description Show the Edit Settings modal. Loads the raw user-settings.json into
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
      <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">>
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
    <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">Edit Settings</h3>
      </div>
      <div class="p-4">
        <p class="text-sm text-brand-600 mb-2">Edit user settings. A backup was created when this editor opened. Changes take effect immediately on save.</p>
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
  attachLineNumbers(editor);
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
    let content = editor.value;

    // Auto-fix unescaped quotes in iframe values pasted from Google Sheets / Excel.
    // The user pastes e.g. "<iframe src="https://...">" but JSON needs the inner
    // quotes escaped as \". This finds "iframe": "..." lines and escapes inner quotes.
    content = fixIframeQuotes(content);
    editor.value = content;

    // Client-side JSON validation
    try {
      JSON.parse(content);
    } catch (parseErr) {
      errorDiv.textContent = formatJsonError(content, parseErr);
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
      fetchDelayProfile: "cron",
      fetchBatch: {
        _readme: "Fetch investments/benchmarks in batches to avoid rate-limiting. batchSize is items per batch (1-50), cooldownSeconds is pause between batches (0-600).",
        batchSize: 10,
        cooldownSeconds: 25,
      },
    };
    editor.value = JSON.stringify(defaults, null, 2);
    editor.dispatchEvent(new Event("input"));
    errorDiv.classList.add("hidden");
  });

  editor.focus();
}

/**
 * @description Show the Edit Reports modal. Loads the raw user-reports.json into
 * a textarea for editing, with Save and Cancel buttons. Creates a timestamped
 * backup on the server before saving.
 */
async function showEditReportsModal() {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Show loading modal while fetching reports
  const loadingHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">Edit Reports</h3>
        </div>
        <div class="p-6 text-center text-brand-500">Loading report definitions...</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", loadingHtml);

  // Fetch the raw reports content
  const result = await apiRequest("/api/reports/raw");
  const modal = document.getElementById("app-modal");

  if (!result.ok) {
    modal.remove();
    showModal("Error", "Failed to load report definitions: " + (result.error || "Unknown error"));
    return;
  }

  const reportsContent = result.data.content;
  const reportsPath = result.data.path;

  // Replace loading content with the editor
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">Edit Reports</h3>
      </div>
      <div class="p-4">
        <p class="text-sm text-brand-600 mb-2">Edit PDF report definitions. A backup was created when this editor opened.</p>
        <p class="text-xs text-brand-400 mb-3">Save location: ${escapeHtml(reportsPath)}</p>
        <div id="reports-warning" class="hidden mb-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2 text-sm"></div>
        <div id="reports-error" class="hidden mb-3 bg-red-50 border border-red-300 text-error rounded-lg px-3 py-2 text-sm"></div>
        <textarea id="reports-editor" class="w-full font-mono text-sm border-2 border-brand-300 rounded-lg p-3 focus:outline-none focus:border-brand-500 bg-brand-25 text-brand-800" rows="20" spellcheck="false">${escapeHtml(reportsContent)}</textarea>
      </div>
      <div class="px-4 py-3 bg-brand-50 flex justify-end gap-3">
        <button id="reports-cancel-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Cancel</button>
        <button id="reports-save-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">Save</button>
      </div>
    </div>
  `;

  const editor = document.getElementById("reports-editor");
  attachLineNumbers(editor);
  const warningDiv = document.getElementById("reports-warning");
  const errorDiv = document.getElementById("reports-error");
  const saveBtn = document.getElementById("reports-save-btn");
  const cancelBtn = document.getElementById("reports-cancel-btn");

  function closeReportsModal() {
    modal.remove();
  }

  cancelBtn.addEventListener("click", closeReportsModal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeReportsModal();
    }
  });

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeReportsModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  // Save handler — validate JSON, check for warnings, and send to server
  saveBtn.addEventListener("click", async function () {
    errorDiv.classList.add("hidden");
    warningDiv.classList.add("hidden");
    const content = editor.value;

    // Client-side JSON validation
    try {
      JSON.parse(content);
    } catch (parseErr) {
      errorDiv.textContent = formatJsonError(content, parseErr);
      errorDiv.classList.remove("hidden");
      return;
    }

    // Check for warnings (new_page or layout in reports file)
    const warnings = validateJsonWarnings(content, "reports");
    if (warnings.length > 0) {
      warningDiv.innerHTML = "<strong>Warning:</strong> " + warnings.map(escapeHtml).join("<br>");
      warningDiv.classList.remove("hidden");
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const saveResult = await apiRequest("/api/reports/raw", {
      method: "PUT",
      body: { content: content },
    });

    if (saveResult.ok) {
      closeReportsModal();
      document.removeEventListener("keydown", handleEscape);
    } else {
      errorDiv.textContent = "Save failed: " + (saveResult.error || "Unknown error") + (saveResult.detail ? " — " + saveResult.detail : "");
      errorDiv.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  editor.focus();
}

/**
 * @description Check JSON content for properties that belong in the other file.
 * Returns an array of warning strings to display in the editor.
 * @param {string} content - The raw JSON string
 * @param {string} fileType - Either "views" or "reports"
 * @returns {Array<string>} Warning messages (empty if none)
 */
function validateJsonWarnings(content, fileType) {
  const warnings = [];
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return warnings;

    if (fileType === "views") {
      // Warn if any entry contains pdfEndpoint (belongs in user-reports.json)
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].pdfEndpoint) {
          warnings.push('Entry "' + (parsed[i].id || parsed[i].title || "index " + i) + '" has "pdfEndpoint" — this belongs in user-reports.json (PDF reports), not user-views.json.');
        }
      }
    } else if (fileType === "reports") {
      // Warn if any entry or its blocks contain new_page or layout (belongs in user-views.json)
      for (let i = 0; i < parsed.length; i++) {
        const entry = parsed[i];
        const entryName = entry.id || entry.title || "index " + i;
        if (entry.layout) {
          warnings.push('Entry "' + entryName + '" has "layout" — this belongs in user-views.json (HTML views), not user-reports.json.');
        }
        if (entry.blocks && Array.isArray(entry.blocks)) {
          for (let j = 0; j < entry.blocks.length; j++) {
            if (entry.blocks[j].type === "new_page") {
              warnings.push('Entry "' + entryName + '" has a "new_page" block — this belongs in user-views.json (HTML views), not user-reports.json.');
              break;
            }
            if (entry.blocks[j].layout) {
              warnings.push('Entry "' + entryName + '" has a block with "layout" — this belongs in user-views.json (HTML views), not user-reports.json.');
              break;
            }
          }
        }
      }
    }
  } catch {
    // If JSON is invalid, skip validation warnings (parse error will be shown separately)
  }
  return warnings;
}

/**
 * @description Show the Edit Views modal. Loads the raw user-views.json into
 * a textarea for editing, with Save and Cancel buttons. Creates a timestamped
 * backup on the server before saving. Warns if content contains pdfEndpoint.
 */
async function showEditViewsModal() {
  // Remove any existing modal
  const existingModal = document.getElementById("app-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // Show loading modal while fetching views
  const loadingHtml = `
    <div id="app-modal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">
        <div class="bg-brand-800 text-white px-4 py-3">
          <h3 class="text-lg font-semibold">Edit Views</h3>
        </div>
        <div class="p-6 text-center text-brand-500">Loading view definitions...</div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", loadingHtml);

  // Fetch the raw views content
  const result = await apiRequest("/api/views/raw");
  const modal = document.getElementById("app-modal");

  if (!result.ok) {
    modal.remove();
    showModal("Error", "Failed to load view definitions: " + (result.error || "Unknown error"));
    return;
  }

  const viewsContent = result.data.content;
  const viewsPath = result.data.path;

  // Replace loading content with the editor
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl mx-4 overflow-hidden" style="width:60vw;min-width:48rem;max-width:60vw">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">Edit Views</h3>
      </div>
      <div class="p-4">
        <p class="text-sm text-brand-600 mb-2">Edit HTML composite view definitions. A backup was created when this editor opened.</p>
        <p class="text-xs text-brand-400 mb-3">Save location: ${escapeHtml(viewsPath)}</p>
        <div id="views-warning" class="hidden mb-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2 text-sm"></div>
        <div id="views-error" class="hidden mb-3 bg-red-50 border border-red-300 text-error rounded-lg px-3 py-2 text-sm"></div>
        <textarea id="views-editor" class="w-full font-mono text-sm border-2 border-brand-300 rounded-lg p-3 focus:outline-none focus:border-brand-500 bg-brand-25 text-brand-800" rows="20" spellcheck="false">${escapeHtml(viewsContent)}</textarea>
      </div>
      <div class="px-4 py-3 bg-brand-50 flex justify-end gap-3">
        <button id="views-cancel-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Cancel</button>
        <button id="views-save-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">Save</button>
      </div>
    </div>
  `;

  const editor = document.getElementById("views-editor");
  attachLineNumbers(editor);
  const warningDiv = document.getElementById("views-warning");
  const errorDiv = document.getElementById("views-error");
  const saveBtn = document.getElementById("views-save-btn");
  const cancelBtn = document.getElementById("views-cancel-btn");

  function closeViewsModal() {
    modal.remove();
  }

  cancelBtn.addEventListener("click", closeViewsModal);

  modal.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeViewsModal();
    }
  });

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeViewsModal();
      document.removeEventListener("keydown", handleEscape);
    }
  }
  document.addEventListener("keydown", handleEscape);

  // Save handler — validate JSON, check for warnings, and send to server
  saveBtn.addEventListener("click", async function () {
    errorDiv.classList.add("hidden");
    warningDiv.classList.add("hidden");
    const content = editor.value;

    // Client-side JSON validation
    try {
      JSON.parse(content);
    } catch (parseErr) {
      errorDiv.textContent = formatJsonError(content, parseErr);
      errorDiv.classList.remove("hidden");
      return;
    }

    // Check for warnings (pdfEndpoint in views file)
    const warnings = validateJsonWarnings(content, "views");
    if (warnings.length > 0) {
      warningDiv.innerHTML = "<strong>Warning:</strong> " + warnings.map(escapeHtml).join("<br>");
      warningDiv.classList.remove("hidden");
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const saveResult = await apiRequest("/api/views/raw", {
      method: "PUT",
      body: { content: content },
    });

    if (saveResult.ok) {
      closeViewsModal();
      document.removeEventListener("keydown", handleEscape);
    } else {
      errorDiv.textContent = "Save failed: " + (saveResult.error || "Unknown error") + (saveResult.detail ? " — " + saveResult.detail : "");
      errorDiv.classList.remove("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  editor.focus();
}

/**
 * @description Show the Fetch Server Settings info modal.
 * Displays instructions for configuring the optional remote fetch server.
 */
function showFetchServerInfoModal() {
  const htmlContent = `
    <p class="text-base text-brand-700 mb-4">
      The fetch server is an optional companion service that runs on a separate always-on server
      to fetch currency rates, investment prices, and benchmark values on a schedule.
    </p>

    <h4 class="font-semibold text-brand-800 mb-2">1. Enable the fetch server</h4>
    <p class="text-sm text-brand-600 mb-1">Edit the <code class="bg-brand-100 px-1 rounded">fetchServer</code> section in your settings file:</p>
    <pre class="bg-brand-50 border border-brand-200 rounded p-3 text-sm font-mono mb-4 overflow-x-auto">nano ~/.config/portfolio_60/user-settings.json</pre>
    <p class="text-sm text-brand-600 mb-1">Add or update this section:</p>
    <pre class="bg-brand-50 border border-brand-200 rounded p-3 text-sm font-mono mb-4 overflow-x-auto">"fetchServer": {
  "enabled": true,
  "url": "https://your-server-address.example.com",
  "syncOnStartup": true
}</pre>

    <h4 class="font-semibold text-brand-800 mb-2">2. Set the shared API key</h4>
    <p class="text-sm text-brand-600 mb-1">Add the API key to your <code class="bg-brand-100 px-1 rounded">.env</code> file:</p>
    <pre class="bg-brand-50 border border-brand-200 rounded p-3 text-sm font-mono mb-4 overflow-x-auto">nano ~/.config/portfolio_60/.env

FETCH_SERVER_API_KEY=your-secret-key</pre>

    <h4 class="font-semibold text-brand-800 mb-2">3. Server cron schedule</h4>
    <p class="text-sm text-brand-600 mb-1">The fetch server has its own cron schedule, configured in <code class="bg-brand-100 px-1 rounded">settings.json</code> on the server:</p>
    <pre class="bg-brand-50 border border-brand-200 rounded p-3 text-sm font-mono mb-4 overflow-x-auto">"scheduling": {
  "enabled": true,
  "cron": "0 6 * * 6"
}</pre>
    <p class="text-sm text-brand-500 mb-4">The default is every Saturday at 06:00. This is independent of the workstation's own cron schedule.</p>

    <p class="text-sm text-brand-600">Restart the application after making changes. The Fetching page will show the fetch server status when enabled.</p>
  `;

  showModalHtml("Fetch Server Settings", htmlContent);
}

/**
 * @description Show the About modal with system information useful for
 * first-line support. Displays version, build time, platform details, and
 * file paths in a tabbed dialog with a Copy to Clipboard button.
 * Also includes an Acknowledgements tab listing open-source dependencies.
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

  // Tab labels and active/inactive styles
  const activeTabClass = "border-b-2 border-brand-700 text-brand-800 font-semibold";
  const inactiveTabClass = "text-brand-500 hover:text-brand-700";

  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4 overflow-hidden">
      <div class="bg-brand-800 text-white px-4 py-3">
        <h3 class="text-lg font-semibold">About Portfolio 60</h3>
      </div>
      <div class="flex border-b border-brand-200 px-4 pt-2 gap-6 text-sm">
        <button id="about-tab-version" class="pb-2 cursor-pointer ${activeTabClass}">Version</button>
        <button id="about-tab-ack" class="pb-2 cursor-pointer ${inactiveTabClass}">Acknowledgements</button>
      </div>
      <div id="about-panel-version" class="p-4">
        <pre id="about-info-text" class="bg-brand-25 border border-brand-200 rounded-lg p-4 text-sm font-mono text-brand-700 whitespace-pre overflow-x-auto">${escapeHtml(infoLines)}</pre>
      </div>
      <div id="about-panel-ack" class="p-4 hidden text-sm text-brand-700 max-h-80 overflow-y-auto">
        <p class="mb-4 text-brand-600">Built with open-source software. Thanks to all the contributors who share their work freely — you make the web a better place.</p>
        <table class="w-full text-left">
          <thead>
            <tr class="border-b border-brand-200 text-brand-500 text-xs uppercase tracking-wide">
              <th class="pb-2 pr-3">Library</th>
              <th class="pb-2">Description</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-brand-100">
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/oven-sh/bun" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Bun</a></td><td class="py-1.5">JavaScript runtime, server, and toolkit</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/sqlite/sqlite" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">SQLite</a></td><td class="py-1.5">Embedded relational database engine</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/tailwindlabs/tailwindcss" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Tailwind CSS</a></td><td class="py-1.5">Utility-first CSS framework</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/lit/lit" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Lit</a></td><td class="py-1.5">Web components library</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/markedjs/marked" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Marked</a></td><td class="py-1.5">Markdown parser and compiler</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/nicholasgasior/libpdf" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">@libpdf/core</a></td><td class="py-1.5">PDF generation</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/gadicc/node-yahoo-finance2" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">yahoo-finance2</a></td><td class="py-1.5">Yahoo Finance API client</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/hexagon/croner" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Croner</a></td><td class="py-1.5">Cron job scheduler</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/archiverjs/node-archiver" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Archiver</a></td><td class="py-1.5">Archive/ZIP file creation</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/cthackers/adm-zip" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">ADM-ZIP</a></td><td class="py-1.5">ZIP file extraction</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/open-cli-tools/concurrently" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Concurrently</a></td><td class="py-1.5">Run multiple commands concurrently</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/streetsidesoftware/cspell" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">cspell-lib</a></td><td class="py-1.5">Spell-checking library</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/microsoft/playwright" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Playwright</a></td><td class="py-1.5">End-to-end browser testing</td></tr>
            <tr><td class="py-1.5 pr-3 font-medium"><a href="https://github.com/cloudflare/cloudflared" target="_blank" rel="noopener" class="text-brand-700 underline hover:text-brand-900">Cloudflare Tunnel</a></td><td class="py-1.5">Secure remote access without port forwarding</td></tr>
          </tbody>
        </table>
        <p class="mt-4 pt-3 border-t border-brand-200 text-brand-500 text-xs">Portfolio 60 was built with the help of <a href="https://claude.ai" target="_blank" rel="noopener" class="underline hover:text-brand-700"><strong>Claude</strong></a> by Anthropic.</p>
      </div>
      <div class="px-4 py-3 bg-brand-50 flex justify-between">
        <button id="about-copy-btn" class="bg-brand-200 hover:bg-brand-300 text-brand-700 font-medium px-4 py-2 rounded transition-colors">Copy to Clipboard</button>
        <button id="about-ok-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-4 py-2 rounded transition-colors">OK</button>
      </div>
    </div>
  `;

  const okBtn = document.getElementById("about-ok-btn");
  const copyBtn = document.getElementById("about-copy-btn");
  const tabVersion = document.getElementById("about-tab-version");
  const tabAck = document.getElementById("about-tab-ack");
  const panelVersion = document.getElementById("about-panel-version");
  const panelAck = document.getElementById("about-panel-ack");

  /**
   * @description Switches the active tab in the About modal
   * @param {"version"|"ack"} tab - Which tab to activate
   */
  function switchTab(tab) {
    const isVersion = tab === "version";
    panelVersion.classList.toggle("hidden", !isVersion);
    panelAck.classList.toggle("hidden", isVersion);
    tabVersion.className = "pb-2 cursor-pointer " + (isVersion ? activeTabClass : inactiveTabClass);
    tabAck.className = "pb-2 cursor-pointer " + (isVersion ? inactiveTabClass : activeTabClass);
    // Only show Copy to Clipboard on the Version tab
    copyBtn.classList.toggle("invisible", !isVersion);
  }

  tabVersion.addEventListener("click", function () { switchTab("version"); });
  tabAck.addEventListener("click", function () { switchTab("ack"); });

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

// Navigation highlighting and build time loading
// are handled by the <app-navbar> and <app-footer> web components
// in their firstUpdated() lifecycle methods.
// The functions remain defined here as globals for the components to call.
