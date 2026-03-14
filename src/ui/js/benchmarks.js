/**
 * @description Benchmarks page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting benchmarks.
 */

/** @type {number|null} ID of the benchmark pending deletion */
let deleteBenchmarkId = null;

/** @type {string} Name of the benchmark pending deletion (for confirmation dialog) */
let deleteBenchmarkName = "";

/** @type {Object<number, number>} Track Load History click counts per benchmark ID */
let loadHistoryCounts = {};

/** @type {Array<Object>} Cached benchmarks data from last API load */
let cachedBenchmarks = [];

/** @type {Set<number>} Benchmark IDs that have been successfully loaded in this session */
let loadedInSession = new Set();

/** @type {number|null} ID of the benchmark pending history replacement */
let replaceHistoryId = null;

/** @type {string} Name of the benchmark pending history replacement */
let replaceHistoryName = "";

/** @type {HTMLElement|null} Reference to the button that triggered the replacement */
let replaceHistoryButton = null;

/** @type {Array<{id: number, code: string, description: string}>} Cached currencies */
let currencies = [];

/** @type {number|null} The GBP currency ID (for index benchmark validation) */
let gbpCurrencyId = null;

/** @type {Object|null} Currently matched site config from URL */
let matchedSiteConfig = null;

/** @type {Array<{pattern: string, name: string, selector: string, waitStrategy: string, notes: string}>} Cached scraper site configs */
let scraperSites = [];

/**
 * @description Load currencies from the API and cache them.
 */
async function loadCurrencies() {
  const result = await apiRequest("/api/currencies");
  if (result.ok) {
    currencies = result.data;
  }
}

/**
 * @description Load the GBP currency ID from the API.
 */
async function loadGbpCurrencyId() {
  const result = await apiRequest("/api/benchmarks/gbp-id");
  if (result.ok) {
    gbpCurrencyId = result.data.gbp_id;
  }
}

/**
 * @description Load scraper site configurations from the API and cache them.
 */
async function loadScraperSites() {
  const result = await apiRequest("/api/config/scraper-sites");
  if (result.ok) {
    scraperSites = result.data;
    populateSiteDropdown();
  }
}

/**
 * @description Populate the known site <select> element with options from cached sites.
 */
function populateSiteDropdown() {
  const select = document.getElementById("site-select");
  select.innerHTML = '<option value="">— Select a known site (optional) —</option>';

  for (let i = 0; i < scraperSites.length; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = scraperSites[i].name;
    select.appendChild(option);
  }
}

/**
 * @description Handle site dropdown selection. Auto-fills the selector and shows
 * usage notes when a known site is selected.
 */
function handleSiteSelect() {
  const select = document.getElementById("site-select");
  const statusEl = document.getElementById("url-site-status");
  const selectorHelpEl = document.getElementById("selector-help");
  const selectorField = document.getElementById("selector");

  const idx = select.value;

  if (idx === "") {
    matchedSiteConfig = null;
    statusEl.classList.add("hidden");
    selectorHelpEl.textContent = "To find the CSS selector: right-click the value on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
    return;
  }

  const site = scraperSites[Number(idx)];
  matchedSiteConfig = site;

  let statusHtml = "<strong>Known site:</strong> " + escapeHtml(site.name) + ".";
  if (site.notes) {
    statusHtml += " " + escapeHtml(site.notes);
  }
  statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
  statusEl.innerHTML = statusHtml;
  statusEl.classList.remove("hidden");

  if (!selectorField.value.trim()) {
    selectorField.value = site.selector;
  }
  selectorHelpEl.textContent = "This selector was auto-filled for the known site. You can modify it if needed.";
}

/**
 * @description Sync the site dropdown to match a site config object.
 * @param {Object|null} site - The matched site config, or null to reset
 */
function syncSiteDropdown(site) {
  const select = document.getElementById("site-select");
  if (!site) {
    select.value = "";
    return;
  }
  for (let i = 0; i < scraperSites.length; i++) {
    if (scraperSites[i].name === site.name) {
      select.value = i;
      return;
    }
  }
  select.value = "";
}

/**
 * @description Check if a URL matches a known scraper site.
 * Updates the UI to show the match status and makes selector optional for known sites.
 * @param {string} url - The URL to check
 */
async function checkUrlSiteMatch(url) {
  const statusEl = document.getElementById("url-site-status");
  const selectorOptionalEl = document.getElementById("selector-optional");
  const selectorHelpEl = document.getElementById("selector-help");

  // Reset state
  matchedSiteConfig = null;

  if (!url || url.trim() === "") {
    statusEl.classList.add("hidden");
    selectorOptionalEl.classList.add("hidden");
    selectorHelpEl.textContent = "To find the CSS selector: right-click the value on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
    return;
  }

  // Check against known sites
  const result = await apiRequest("/api/config/scraper-sites/match", {
    method: "POST",
    body: { url: url.trim() },
  });

  if (result.ok && result.data.matched) {
    matchedSiteConfig = result.data.site;
    syncSiteDropdown(matchedSiteConfig);
    let statusHtml = "<strong>Known site:</strong> " + escapeHtml(matchedSiteConfig.name) + ".";
    if (matchedSiteConfig.notes) {
      statusHtml += " " + escapeHtml(matchedSiteConfig.notes);
    }
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = statusHtml;
    statusEl.classList.remove("hidden");
    selectorOptionalEl.classList.add("hidden");
    selectorHelpEl.textContent = "This selector was auto-filled for the known site. You can modify it if needed.";
    // Auto-fill the selector field with the config value (only if currently empty)
    const selectorField = document.getElementById("selector");
    if (!selectorField.value.trim()) {
      selectorField.value = matchedSiteConfig.selector;
    }
  } else {
    syncSiteDropdown(null);
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-amber-50 border border-amber-200 text-amber-700";
    statusEl.innerHTML = "URL does not match a known site. You will need to provide a CSS selector.";
    statusEl.classList.remove("hidden");
    selectorOptionalEl.classList.add("hidden");
    selectorHelpEl.textContent = "To find the CSS selector: right-click the value on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
  }
}

/**
 * @description Populate the benchmark type <select> element with options.
 * @param {string} [selectedType=""] - The type to pre-select ('index' or 'price')
 */
function populateTypeDropdown(selectedType) {
  const select = document.getElementById("benchmark_type");
  select.innerHTML = '<option value="">Select type...</option>';

  const types = [
    { value: "index", label: "Index (e.g. FTSE 100, S&P 500)" },
    { value: "price", label: "Price (e.g. ETF tracking an index)" },
  ];

  for (const type of types) {
    const option = document.createElement("option");
    option.value = type.value;
    option.textContent = type.label;
    if (selectedType && type.value === selectedType) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

/**
 * @description Populate the currency <select> element with options.
 * @param {number|string} [selectedId=""] - The currency ID to pre-select
 */
function populateCurrencyDropdown(selectedId) {
  const select = document.getElementById("currencies_id");
  select.innerHTML = '<option value="">Select currency...</option>';

  for (const currency of currencies) {
    const option = document.createElement("option");
    option.value = currency.id;
    option.textContent = currency.code + " — " + currency.description;
    if (selectedId && Number(currency.id) === Number(selectedId)) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

/**
 * @description Handle benchmark type change to show/hide currency field.
 * When type is 'index', hide currency field entirely (always GBP).
 * When type is 'price', show the currency dropdown.
 */
function handleTypeChange() {
  const typeSelect = document.getElementById("benchmark_type");
  const currencySelect = document.getElementById("currencies_id");
  const currencyContainer = document.getElementById("currency-container");

  if (typeSelect.value === "index") {
    // Hide currency field entirely and set to GBP
    if (gbpCurrencyId) {
      currencySelect.value = gbpCurrencyId;
    }
    currencyContainer.classList.add("hidden");
  } else {
    // Show currency selection
    currencyContainer.classList.remove("hidden");
  }
}

/**
 * @description Get the display name for a benchmark type.
 * @param {string} benchmarkType - The type ('index' or 'price')
 * @returns {string} Human-readable type name
 */
function getTypeDisplayName(benchmarkType) {
  if (benchmarkType === "index") return "Index";
  if (benchmarkType === "price") return "Price";
  return benchmarkType || "";
}

/**
 * @description Load and display all benchmarks in the table.
 */
async function loadBenchmarks() {
  const container = document.getElementById("benchmarks-table-container");

  const result = await apiRequest("/api/benchmarks");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load benchmarks</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    return;
  }

  const benchmarks = result.data;
  cachedBenchmarks = benchmarks;

  if (benchmarks.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No benchmarks yet. Click "Add Benchmark" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Type</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">URL</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Selector</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < benchmarks.length; i++) {
    const bm = benchmarks[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    // Truncate URL for display if it's very long
    const urlDisplay = bm.benchmark_url ? (bm.benchmark_url.length > 40 ? bm.benchmark_url.substring(0, 40) + "..." : bm.benchmark_url) : "";

    // Truncate selector for display if it's very long
    const selectorDisplay = bm.selector ? (bm.selector.length > 30 ? bm.selector.substring(0, 30) + "..." : bm.selector) : "";

    // For price type, show currency in parentheses after type
    const typeDisplay = bm.benchmark_type === "price" ? getTypeDisplayName(bm.benchmark_type) + " (" + bm.currency_code + ")" : getTypeDisplayName(bm.benchmark_type);

    html += '<tr data-id="' + bm.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors cursor-pointer" ondblclick="viewBenchmark(' + bm.id + ')">';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(bm.description) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(typeDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500">' + escapeHtml(urlDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(selectorDisplay) + "</td>";
    const isMsci = bm.description.toLowerCase().includes("msci");

    html += '<td class="py-3 px-3 text-base flex gap-2">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="viewBenchmark(' + bm.id + ')">View</button>';
    // Show Test button if URL exists (selector may come from config for known sites)
    if (bm.benchmark_url) {
      html += '<button id="test-btn-' + bm.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="testFetchBenchmark(' + bm.id + ', this)">Test</button>';
    }
    // Show Load/Replace History for benchmarks with URLs — disabled for MSCI (no free historic data source)
    if (bm.benchmark_url) {
      if (isMsci) {
        html += '<button class="bg-gray-100 text-gray-400 text-sm font-medium px-2 py-1 rounded cursor-not-allowed whitespace-nowrap" disabled title="No free historic data source for MSCI indexes">Load History</button>';
      } else {
        const hasHistory = benchmarkHasHistory(bm);
        const loadBtnLabel = hasHistory ? "Replace History" : "Load History";
        html += '<button id="load-btn-' + bm.id + '" class="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="loadHistoryBenchmark(' + bm.id + ", this, '" + escapeHtml(bm.description).replace(/'/g, "\\'") + "')\">" + loadBtnLabel + "</button>";
      }
    }
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Highlight a table row to indicate it is currently open
 * in the view or edit panel. Clears any previous highlight first.
 * @param {number} id - The benchmark ID whose row to highlight
 */
function highlightRow(id) {
  clearRowHighlight();
  const row = document.querySelector('tr[data-id="' + id + '"]');
  if (row) {
    row.classList.add("!bg-brand-200", "font-semibold");
  }
}

/**
 * @description Remove the highlight from any previously highlighted table row.
 */
function clearRowHighlight() {
  const highlighted = document.querySelector("tr.\\!bg-brand-200");
  if (highlighted) {
    highlighted.classList.remove("!bg-brand-200", "font-semibold");
  }
}

/**
 * @description Show a read-only view of a benchmark's details.
 * Triggered by double-clicking a table row or clicking the View button.
 * @param {number} id - The benchmark ID to view
 */
async function viewBenchmark(id) {
  const result = await apiRequest("/api/benchmarks/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load benchmark", result.detail || result.error);
    return;
  }

  const bm = result.data;

  // Find the display names for type and currency
  const typeDisplay = getTypeDisplayName(bm.benchmark_type);

  document.getElementById("view-description").textContent = bm.description;
  document.getElementById("view-type").textContent = typeDisplay;
  document.getElementById("view-url").textContent = bm.benchmark_url || "—";
  document.getElementById("view-selector").textContent = bm.selector || "—";

  // Show/hide currency based on type
  const viewCurrencyContainer = document.getElementById("view-currency-container");
  if (bm.benchmark_type === "index") {
    viewCurrencyContainer.classList.add("hidden");
  } else {
    viewCurrencyContainer.classList.remove("hidden");
    const currencyDisplay = bm.currency_code + " — " + bm.currency_description;
    document.getElementById("view-currency").textContent = currencyDisplay;
  }

  // Reset value history toggle
  const valueCheckbox = document.getElementById("view-show-values");
  valueCheckbox.checked = false;
  document.getElementById("view-values-container").classList.add("hidden");
  document.getElementById("view-values-container").innerHTML = "";
  valueCheckbox.onchange = function () {
    toggleViewValues(bm.id);
  };

  // Wire the Edit button to switch to edit mode for this benchmark
  const editBtn = document.getElementById("view-edit-btn");
  editBtn.onclick = function () {
    hideView();
    editBenchmark(bm.id);
  };

  // Highlight the corresponding table row
  highlightRow(bm.id);

  // Hide the form if it's open, show the view panel
  document.getElementById("benchmark-form-container").classList.add("hidden");
  document.getElementById("benchmark-view-container").classList.remove("hidden");
}

/**
 * @description Hide the read-only view panel.
 */
function hideView() {
  document.getElementById("benchmark-view-container").classList.add("hidden");
  clearRowHighlight();
}

/**
 * @description Toggle the value history display in the view modal.
 * Fetches values from the API on first show, then toggles visibility.
 * @param {number} benchmarkId - The benchmark ID to fetch values for
 */
/**
 * @description Load and display value history for a benchmark.
 * Fetches a page of values and renders them in a scrollable table.
 * Supports "Load more" pagination to fetch additional rows.
 * @param {number} benchmarkId - The benchmark ID
 * @param {boolean} [append=false] - If true, append rows to existing table
 */
async function toggleViewValues(benchmarkId, append) {
  const container = document.getElementById("view-values-container");
  const checkbox = document.getElementById("view-show-values");
  const PAGE_SIZE = 100;

  if (!append && !checkbox.checked) {
    container.classList.add("hidden");
    return;
  }

  const existingRows = append ? container.querySelectorAll("tbody tr").length : 0;

  if (!append) {
    container.classList.remove("hidden");
    container.innerHTML = '<p class="text-sm text-brand-500">Loading values...</p>';
  }

  const result = await apiRequest("/api/benchmarks/" + benchmarkId + "/values?limit=" + PAGE_SIZE + "&offset=" + existingRows);

  if (!result.ok) {
    if (!append) {
      container.innerHTML = '<p class="text-sm text-error">Failed to load values.</p>';
    }
    return;
  }

  const values = result.data.values;
  const totalCount = result.data.totalCount;

  if (!append && values.length === 0) {
    container.innerHTML = '<p class="text-sm text-brand-500">No values recorded.</p>';
    return;
  }

  if (append) {
    const tbody = container.querySelector("tbody");
    for (let i = 0; i < values.length; i++) {
      const rowIndex = existingRows + i;
      const rowClass = rowIndex % 2 === 0 ? "bg-white" : "bg-brand-50";
      tbody.insertAdjacentHTML("beforeend",
        '<tr class="' + rowClass + ' border-b border-brand-100">' +
        '<td class="py-1 px-2 text-xs font-mono">' + escapeHtml(values[i].benchmark_date) + "</td>" +
        '<td class="py-1 px-2 text-xs font-mono text-right">' + escapeHtml(String(values[i].value.toFixed(2))) + "</td>" +
        "</tr>"
      );
    }

    const loadedCount = existingRows + values.length;
    container.querySelector("[data-count]").textContent = totalCount + " value" + (totalCount !== 1 ? "s" : "") + " recorded (showing " + loadedCount + ")";
    const moreBtn = container.querySelector("[data-load-more]");
    if (loadedCount >= totalCount) {
      if (moreBtn) moreBtn.remove();
    }
    return;
  }

  const loadedCount = values.length;
  let html = '<p class="text-xs text-brand-500 mb-1" data-count>' + totalCount + " value" + (totalCount !== 1 ? "s" : "") + " recorded" + (loadedCount < totalCount ? " (showing " + loadedCount + ")" : "") + "</p>";
  html += '<div class="max-h-[16rem] overflow-y-auto border border-brand-200 rounded">';
  html += '<table class="w-full text-left border-collapse">';
  html += '<thead class="sticky top-0 bg-brand-100"><tr>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700 text-right">Value</th>';
  html += '</tr></thead><tbody>';

  for (let i = 0; i < values.length; i++) {
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-xs font-mono">' + escapeHtml(values[i].benchmark_date) + "</td>";
    html += '<td class="py-1 px-2 text-xs font-mono text-right">' + escapeHtml(String(values[i].value.toFixed(2))) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";

  if (loadedCount < totalCount) {
    html += '<button type="button" data-load-more class="text-xs text-brand-600 hover:text-brand-800 mt-1 underline">Load more</button>';
  }

  container.innerHTML = html;

  const moreBtn = container.querySelector("[data-load-more]");
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      toggleViewValues(benchmarkId, true);
    });
  }
}

/**
 * @description Show the add benchmark form (empty fields).
 */
function showAddForm() {
  document.getElementById("form-title").textContent = "Add Benchmark";
  document.getElementById("benchmark-id").value = "";
  document.getElementById("benchmark-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  populateTypeDropdown();
  populateCurrencyDropdown();
  // Show currency field by default (user hasn't selected type yet)
  document.getElementById("currency-container").classList.remove("hidden");
  // Reset URL site status and site dropdown
  document.getElementById("url-site-status").classList.add("hidden");
  document.getElementById("selector-optional").classList.add("hidden");
  document.getElementById("site-select").value = "";
  matchedSiteConfig = null;
  clearRowHighlight();
  document.getElementById("benchmark-view-container").classList.add("hidden");
  document.getElementById("benchmark-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Load a benchmark's data into the form for editing.
 * @param {number} id - The benchmark ID to edit
 */
async function editBenchmark(id) {
  const result = await apiRequest("/api/benchmarks/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load benchmark for editing", result.detail || result.error);
    return;
  }

  const bm = result.data;
  document.getElementById("form-title").textContent = "Edit Benchmark";
  document.getElementById("benchmark-id").value = bm.id;
  document.getElementById("description").value = bm.description;
  populateTypeDropdown(bm.benchmark_type);
  populateCurrencyDropdown(bm.currencies_id);
  document.getElementById("benchmark_url").value = bm.benchmark_url || "";
  document.getElementById("selector").value = bm.selector || "";
  document.getElementById("form-errors").textContent = "";

  // Apply type-based currency restriction
  handleTypeChange();

  // Check URL against known sites
  if (bm.benchmark_url) {
    checkUrlSiteMatch(bm.benchmark_url);
  } else {
    document.getElementById("url-site-status").classList.add("hidden");
    document.getElementById("selector-optional").classList.add("hidden");
    matchedSiteConfig = null;
  }

  // Show the delete link when editing
  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDeleteBenchmark(bm.id, bm.description);
  };

  // Highlight the corresponding table row
  highlightRow(bm.id);

  document.getElementById("benchmark-view-container").classList.add("hidden");
  document.getElementById("benchmark-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Hide the form and show the Add Benchmark button again.
 */
function hideForm() {
  document.getElementById("benchmark-form-container").classList.add("hidden");
  clearRowHighlight();
}

/**
 * @description Handle form submission for creating or updating a benchmark.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const benchmarkId = document.getElementById("benchmark-id").value;
  const isEditing = benchmarkId !== "";

  const data = {
    description: document.getElementById("description").value.trim(),
    benchmark_type: document.getElementById("benchmark_type").value || null,
    currencies_id: document.getElementById("currencies_id").value || null,
    benchmark_url: document.getElementById("benchmark_url").value.trim() || null,
    selector: document.getElementById("selector").value.trim() || null,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/benchmarks/" + benchmarkId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/benchmarks", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadBenchmarks();
    showSuccess("page-messages", isEditing ? "Benchmark updated successfully" : "Benchmark added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The benchmark ID to delete
 * @param {string} name - The benchmark description for the confirmation message
 */
function confirmDeleteBenchmark(id, name) {
  deleteBenchmarkId = id;
  deleteBenchmarkName = name;
  document.getElementById("delete-benchmark-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteBenchmarkId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the benchmark deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteBenchmarkId) return;

  const result = await apiRequest("/api/benchmarks/" + deleteBenchmarkId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadBenchmarks();
    showSuccess("page-messages", "Benchmark deleted successfully");
  } else {
    showError("page-messages", "Failed to delete benchmark", result.detail || result.error);
  }
}

/**
 * @description Build an HTML table from historic backfill preview rows.
 * @param {Array<{date: string, value: number}>} rows - The preview rows (most recent first)
 * @param {string} valueLabel - Column header for the value (e.g. "Value")
 * @returns {string} HTML table string
 */
function buildHistoricPreviewTable(rows, valueLabel) {
  if (!rows || rows.length === 0) {
    return '<p class="text-brand-500 text-sm mt-2">No historic data available.</p>';
  }

  let html = '<table class="w-full text-left border-collapse mt-2">';
  html += '<thead><tr class="border-b-2 border-brand-200">';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700 text-right">' + escapeHtml(valueLabel) + "</th>";
  html += "</tr></thead><tbody>";

  for (let i = 0; i < rows.length; i++) {
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const val = rows[i].value !== undefined ? rows[i].value : rows[i].price;
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(rows[i].date) + "</td>";
    html += '<td class="py-1 px-2 text-sm text-right font-mono">' + escapeHtml(String(val)) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

/**
 * @description Build a spinner element HTML for use in progressive modals.
 * @param {string} label - The label to show next to the spinner
 * @returns {string} HTML string with a CSS spinner and label
 */
function buildSpinner(label) {
  return '<div class="flex items-center gap-3 py-3">' + '<div class="w-5 h-5 border-2 border-brand-300 border-t-brand-700 rounded-full animate-spin"></div>' + '<span class="text-sm text-brand-500">' + escapeHtml(label) + "</span>" + "</div>";
}

/**
 * @description Build the result HTML for a live benchmark fetch result.
 * @param {Object} fetchResult - The result from apiRequest
 * @returns {string} HTML string
 */
function buildFetchResultHtml(fetchResult) {
  if (fetchResult.ok && fetchResult.data.benchmark) {
    const bm = fetchResult.data.benchmark;
    if (bm.success) {
      return '<div class="bg-green-50 border border-green-200 rounded p-3 text-sm">' + "<p><strong>Benchmark:</strong> " + escapeHtml(bm.description) + "</p>" + "<p><strong>Raw value:</strong> " + escapeHtml(bm.rawValue) + "</p>" + "<p><strong>Parsed:</strong> " + escapeHtml(String(bm.parsedValue)) + "</p>" + "</div>";
    } else {
      return '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">' + "<p><strong>Benchmark:</strong> " + escapeHtml(bm.description) + "</p>" + "<p><strong>Error:</strong> " + escapeHtml(bm.error) + "</p>" + "</div>";
    }
  } else if (fetchResult.data && fetchResult.data.benchmark) {
    const bm = fetchResult.data.benchmark;
    return '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">' + "<p><strong>Benchmark:</strong> " + escapeHtml(bm.description) + "</p>" + "<p><strong>Error:</strong> " + escapeHtml(bm.error || fetchResult.detail || fetchResult.error) + "</p>" + "</div>";
  } else {
    let html = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">';
    html += "<p>" + escapeHtml(fetchResult.error || "Unknown error") + "</p>";
    if (fetchResult.detail) {
      html += "<p>" + escapeHtml(fetchResult.detail) + "</p>";
    }
    html += "</div>";
    return html;
  }
}

/**
 * @description Build the result HTML for a historic benchmark preview.
 * @param {Object} historyResult - The result from the backfill test API
 * @returns {string} HTML string
 */
function buildHistoryResultHtml(historyResult) {
  if (historyResult.ok && historyResult.data.success) {
    return '<p class="text-sm text-brand-600 mb-1">' + escapeHtml(historyResult.data.description) + " (" + escapeHtml(historyResult.data.yahooTicker) + ")</p>" + buildHistoricPreviewTable(historyResult.data.rows, "Value");
  } else if (historyResult.data && historyResult.data.error) {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>" + escapeHtml(historyResult.data.error) + "</p>" + "</div>";
  } else {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>Could not fetch historic preview.</p>" + "</div>";
  }
}

/**
 * @description Test fetch a single benchmark by ID.
 * Shows a modal immediately with spinners, then progressively updates
 * each section as the live fetch and historic preview results arrive.
 * Uses testMode=true so no database tables are updated.
 * @param {number} id - The benchmark ID to fetch
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testFetchBenchmark(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Testing...";

  // Show modal immediately with spinners for both sections
  const initialHtml = '<h4 class="text-base font-semibold text-brand-800 mb-2">Live Fetch Result</h4>' + '<div id="test-fetch-result">' + buildSpinner("Fetching live value...") + "</div>" + '<h4 class="text-base font-semibold text-brand-800 mt-4 mb-2">Historic Data Preview (Yahoo Finance)</h4>' + '<div id="test-history-result">' + buildSpinner("Fetching historic data...") + "</div>";

  showModalHtml("Test Result (No DB Update)", initialHtml);

  // Fire both requests in parallel, update each section as it completes
  const fetchPromise = apiRequest("/api/fetch/benchmarks/" + id + "?testMode=true", {
    method: "POST",
    timeout: 120000,
  })
    .then(function (result) {
      const el = document.getElementById("test-fetch-result");
      if (el) el.innerHTML = buildFetchResultHtml(result);
    })
    .catch(function (err) {
      const el = document.getElementById("test-fetch-result");
      if (el) el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm"><p>' + escapeHtml(err.message) + "</p></div>";
    });

  const historyPromise = apiRequest("/api/backfill/test/benchmark/" + id, {
    timeout: 30000,
  })
    .then(function (result) {
      const el = document.getElementById("test-history-result");
      if (el) el.innerHTML = buildHistoryResultHtml(result);
    })
    .catch(function (err) {
      const el = document.getElementById("test-history-result");
      if (el) el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm"><p>' + escapeHtml(err.message) + "</p></div>";
    });

  // Wait for both to complete before re-enabling the button
  await Promise.all([fetchPromise, historyPromise]);

  button.disabled = false;
  button.textContent = originalText;
}

/**
 * @description Determine if a benchmark has existing value history (older than 6 days).
 * A benchmark "has history" if it was loaded during this session, or if its
 * oldest_value_date is at least 7 days before today.
 * @param {Object} bm - The benchmark object from the API (must have oldest_value_date)
 * @returns {boolean} True if history exists
 */
function benchmarkHasHistory(bm) {
  if (loadedInSession.has(bm.id)) {
    return true;
  }

  if (!bm.oldest_value_date) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return bm.oldest_value_date <= cutoffStr;
}

/**
 * @description Check if a benchmark has history by its ID, using cached data
 * and session state.
 * @param {number} id - The benchmark ID
 * @returns {boolean} True if the benchmark has existing history
 */
function benchmarkHasHistoryById(id) {
  if (loadedInSession.has(id)) return true;
  const bm = cachedBenchmarks.find(function (b) { return b.id === id; });
  return bm ? benchmarkHasHistory(bm) : false;
}

/**
 * @description Load historic values for a single benchmark.
 * If the benchmark already has value history, shows a confirmation dialog
 * before proceeding. Otherwise proceeds directly with the load.
 * @param {number} id - The benchmark ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} name - The benchmark description for the confirmation message
 */
async function loadHistoryBenchmark(id, button, name) {
  const hasHistory = benchmarkHasHistoryById(id);

  if (hasHistory) {
    replaceHistoryId = id;
    replaceHistoryName = name;
    replaceHistoryButton = button;
    document.getElementById("replace-history-name").textContent = name;
    document.getElementById("replace-history-dialog").classList.remove("hidden");
    document.getElementById("replace-history-no-btn").focus();
    return;
  }

  await executeLoadHistory(id, button, name);
}

/**
 * @description Execute the actual history load for a benchmark.
 * Called directly for first-time loads, or after confirmation for replacements.
 * @param {number} id - The benchmark ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} name - The benchmark description
 */
async function executeLoadHistory(id, button, name) {
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const result = await apiRequest("/api/backfill/load/benchmark/" + id, {
      method: "POST",
      timeout: 120000,
    });

    button.disabled = false;

    if (result.ok && result.data.success) {
      loadHistoryCounts[id] = (loadHistoryCounts[id] || 0) + 1;
      loadedInSession.add(id);
      button.textContent = "Replace History";
      updateLoadBadge(id);
      showModal("History Loaded", "Benchmark: " + result.data.description + "\nValues loaded: " + result.data.count);
    } else {
      button.textContent = benchmarkHasHistoryById(id) ? "Replace History" : "Load History";
      updateLoadBadge(id);
      const errorMsg = (result.data && result.data.error) || result.error || "Unknown error";
      const desc = (result.data && result.data.description) || name;
      showModal("Load Failed", "Benchmark: " + desc + "\nError: " + errorMsg);
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = benchmarkHasHistoryById(id) ? "Replace History" : "Load History";
    updateLoadBadge(id);
    showModal("Network Error", err.message);
  }
}

/**
 * @description Hide the replace history confirmation dialog and reset state.
 */
function hideReplaceHistoryDialog() {
  replaceHistoryId = null;
  replaceHistoryButton = null;
  replaceHistoryName = "";
  document.getElementById("replace-history-dialog").classList.add("hidden");
}

/**
 * @description Execute the history replacement after the user confirmed "Yes".
 */
async function confirmReplaceHistory() {
  const id = replaceHistoryId;
  const button = replaceHistoryButton;
  const name = replaceHistoryName;

  hideReplaceHistoryDialog();

  if (!id || !button) return;

  await executeLoadHistory(id, button, name);
}

/**
 * @description Update the Load/Replace History button badge for a benchmark.
 * Shows a small count badge after the button text if the count is > 0.
 * Uses the correct label based on whether history exists.
 * @param {number} id - The benchmark ID
 */
function updateLoadBadge(id) {
  const btn = document.getElementById("load-btn-" + id);
  if (!btn) return;
  const count = loadHistoryCounts[id] || 0;
  const label = benchmarkHasHistoryById(id) ? "Replace History" : "Load History";
  if (count > 0) {
    btn.innerHTML = label + " " + '<span class="inline-flex items-center justify-center bg-blue-600 text-white font-bold rounded-full w-5 h-5 ml-1 text-xs">' + count + "</span>";
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadCurrencies();
  await loadGbpCurrencyId();
  await loadScraperSites();
  await loadBenchmarks();

  document.getElementById("add-benchmark-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("benchmark-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("view-close-btn").addEventListener("click", hideView);
  document.getElementById("replace-history-no-btn").addEventListener("click", hideReplaceHistoryDialog);
  document.getElementById("replace-history-yes-btn").addEventListener("click", confirmReplaceHistory);

  // Handle type change to enforce GBP for index benchmarks
  document.getElementById("benchmark_type").addEventListener("change", handleTypeChange);

  // Check URL against known sites when it changes (debounced)
  let urlCheckTimeout = null;
  document.getElementById("benchmark_url").addEventListener("input", function (event) {
    if (urlCheckTimeout) {
      clearTimeout(urlCheckTimeout);
    }
    urlCheckTimeout = setTimeout(function () {
      checkUrlSiteMatch(event.target.value);
    }, 500);
  });

  // Handle known site dropdown selection
  document.getElementById("site-select").addEventListener("change", handleSiteSelect);

  // Close modals when clicking on the backdrop (outside the modal content)
  document.getElementById("benchmark-form-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideForm();
    }
  });

  document.getElementById("benchmark-view-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideView();
    }
  });

  document.getElementById("replace-history-dialog").addEventListener("click", function (event) {
    if (event.target === this) {
      hideReplaceHistoryDialog();
    }
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const replaceDialog = document.getElementById("replace-history-dialog");
      const deleteDialog = document.getElementById("delete-dialog");
      const formContainer = document.getElementById("benchmark-form-container");
      const viewContainer = document.getElementById("benchmark-view-container");

      // Close in priority order: replace history first, then delete, then form, then view
      if (!replaceDialog.classList.contains("hidden")) {
        hideReplaceHistoryDialog();
      } else if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      } else if (!viewContainer.classList.contains("hidden")) {
        hideView();
      }
    }
  });
});
