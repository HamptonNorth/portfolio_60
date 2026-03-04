/**
 * @description Currencies page logic for Portfolio 60.
 * Handles listing, viewing, adding, editing, and deleting currencies.
 * GBP is the base currency and cannot be deleted.
 */

/** @type {number|null} ID of the currency pending deletion */
let deleteCurrencyId = null;

/** @type {Object<number, number>} Track Load History click counts per currency ID */
let loadHistoryCounts = {};

/** @type {Array<Object>} Cached currencies data from last API load */
let cachedCurrencies = [];

/** @type {Set<number>} Currency IDs that have been successfully loaded in this session */
let loadedInSession = new Set();

/** @type {number|null} ID of the currency pending history replacement */
let replaceHistoryId = null;

/** @type {string} Code of the currency pending history replacement */
let replaceHistoryCode = "";

/** @type {HTMLElement|null} Reference to the button that triggered the replacement */
let replaceHistoryButton = null;

/**
 * @description Highlight a table row by currency ID.
 * @param {number} id - The currency ID
 */
function highlightRow(id) {
  clearRowHighlight();
  const row = document.querySelector('tr[data-id="' + id + '"]');
  if (row) {
    row.classList.add("!bg-brand-200");
  }
}

/**
 * @description Remove highlight from all table rows.
 */
function clearRowHighlight() {
  const rows = document.querySelectorAll("tr[data-id]");
  rows.forEach(function (row) {
    row.classList.remove("!bg-brand-200");
  });
}

/**
 * @description Load and display all currencies in the table.
 */
async function loadCurrencies() {
  const container = document.getElementById("currencies-table-container");

  const result = await apiRequest("/api/currencies");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load currencies</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    return;
  }

  const currencies = result.data;
  cachedCurrencies = currencies;

  if (currencies.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No currencies yet. Click "Add Currency" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Code</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < currencies.length; i++) {
    const cur = currencies[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const isGbp = cur.code === "GBP";

    html += '<tr data-id="' + cur.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors cursor-pointer" ondblclick="viewCurrency(' + cur.id + ')">';
    html += '<td class="py-3 px-3 text-base font-semibold">' + escapeHtml(cur.code) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(cur.description);
    if (isGbp) {
      html += ' <span class="text-sm text-brand-400 font-normal">(Base currency)</span>';
    }
    html += "</td>";
    html += '<td class="py-3 px-3 text-base flex gap-2">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="viewCurrency(' + cur.id + ')">View</button>';
    if (!isGbp) {
      const hasHistory = currencyHasHistory(cur);
      const loadBtnLabel = hasHistory ? "Replace History" : "Load History";
      html += '<button id="test-btn-' + cur.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="testScrapeCurrency(' + cur.id + ', this)">Test</button>';
      html += '<button id="load-btn-' + cur.id + '" class="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="loadHistoryCurrency(' + cur.id + ", this, '" + escapeHtml(cur.code).replace(/'/g, "\\'") + "')\">" + loadBtnLabel + "</button>";
    }
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Show a read-only view of a currency's details.
 * Triggered by double-clicking a table row or clicking the View button.
 * @param {number} id - The currency ID to view
 */
async function viewCurrency(id) {
  const result = await apiRequest("/api/currencies/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load currency", result.detail || result.error);
    return;
  }

  const cur = result.data;

  document.getElementById("view-code").textContent = cur.code;
  document.getElementById("view-description").textContent = cur.description;

  // Reset rate history toggle — hide for GBP (no exchange rates for base currency)
  const rateToggle = document.getElementById("view-rates-toggle");
  const rateCheckbox = document.getElementById("view-show-rates");
  const rateContainer = document.getElementById("view-rates-container");
  rateCheckbox.checked = false;
  rateContainer.classList.add("hidden");
  rateContainer.innerHTML = "";
  if (cur.code === "GBP") {
    rateToggle.classList.add("hidden");
  } else {
    rateToggle.classList.remove("hidden");
    rateCheckbox.onchange = function () {
      toggleViewRates(cur.id);
    };
  }

  // Wire the Edit button to switch to edit mode for this currency
  const editBtn = document.getElementById("view-edit-btn");
  editBtn.onclick = function () {
    hideView();
    editCurrency(cur.id);
  };

  // Highlight the corresponding table row
  highlightRow(cur.id);

  // Hide the form if it's open, show the view modal
  document.getElementById("currency-form-container").classList.add("hidden");
  document.getElementById("currency-view-container").classList.remove("hidden");
}

/**
 * @description Hide the read-only view modal.
 */
function hideView() {
  document.getElementById("currency-view-container").classList.add("hidden");
  clearRowHighlight();
}

/**
 * @description Toggle the rate history display in the view modal.
 * Fetches rates from the API on first show, then toggles visibility.
 * @param {number} currencyId - The currency ID to fetch rates for
 */
async function toggleViewRates(currencyId) {
  const container = document.getElementById("view-rates-container");
  const checkbox = document.getElementById("view-show-rates");

  if (!checkbox.checked) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = '<p class="text-sm text-brand-500">Loading rates...</p>';

  const result = await apiRequest("/api/currencies/" + currencyId + "/rates");

  if (!result.ok) {
    container.innerHTML = '<p class="text-sm text-error">Failed to load rates.</p>';
    return;
  }

  const rates = result.data.rates;
  const totalCount = result.data.totalCount;

  if (rates.length === 0) {
    container.innerHTML = '<p class="text-sm text-brand-500">No rates recorded.</p>';
    return;
  }

  let html = '<p class="text-xs text-brand-500 mb-1">' + totalCount + " rate" + (totalCount !== 1 ? "s" : "") + " recorded</p>";
  html += '<div class="max-h-[16rem] overflow-y-auto border border-brand-200 rounded">';
  html += '<table class="w-full text-left border-collapse">';
  html += '<thead class="sticky top-0 bg-brand-100"><tr>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700 text-right">Rate (per 1 GBP)</th>';
  html += '</tr></thead><tbody>';

  const displayRows = rates.slice(0, 10);
  for (let i = 0; i < displayRows.length; i++) {
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const rateValue = rates[i].rate / 10000;
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-xs font-mono">' + escapeHtml(displayRows[i].rate_date) + "</td>";
    html += '<td class="py-1 px-2 text-xs font-mono text-right">' + escapeHtml(rateValue.toFixed(4)) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Show the add currency form modal (empty fields).
 */
function showAddForm() {
  clearRowHighlight();
  document.getElementById("form-title").textContent = "Add Currency";
  document.getElementById("currency-id").value = "";
  document.getElementById("currency-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  document.getElementById("code").removeAttribute("readonly");
  document.getElementById("currency-view-container").classList.add("hidden");
  document.getElementById("currency-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("code").focus();
  }, 50);
}

/**
 * @description Load a currency's data into the form for editing.
 * @param {number} id - The currency ID to edit
 */
async function editCurrency(id) {
  const result = await apiRequest("/api/currencies/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load currency for editing", result.detail || result.error);
    return;
  }

  const cur = result.data;
  const isGbp = cur.code === "GBP";

  document.getElementById("form-title").textContent = "Edit Currency";
  document.getElementById("currency-id").value = cur.id;
  document.getElementById("code").value = cur.code;
  document.getElementById("description").value = cur.description;
  document.getElementById("form-errors").textContent = "";

  // GBP code should not be changed
  if (isGbp) {
    document.getElementById("code").setAttribute("readonly", "readonly");
  } else {
    document.getElementById("code").removeAttribute("readonly");
  }

  // Show delete link only for non-GBP currencies
  const deleteBtn = document.getElementById("delete-from-form-btn");
  if (isGbp) {
    deleteBtn.classList.add("hidden");
  } else {
    deleteBtn.classList.remove("hidden");
    deleteBtn.onclick = function () {
      confirmDeleteCurrency(cur.id, cur.code + " — " + cur.description);
    };
  }

  // Highlight the corresponding table row
  highlightRow(cur.id);

  document.getElementById("currency-view-container").classList.add("hidden");
  document.getElementById("currency-form-container").classList.remove("hidden");
  // Focus the appropriate field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById(isGbp ? "description" : "code").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  document.getElementById("currency-form-container").classList.add("hidden");
  clearRowHighlight();
}

/**
 * @description Handle form submission for creating or updating a currency.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const currencyId = document.getElementById("currency-id").value;
  const isEditing = currencyId !== "";

  const data = {
    code: document.getElementById("code").value.trim(),
    description: document.getElementById("description").value.trim(),
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/currencies/" + currencyId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/currencies", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadCurrencies();
    showSuccess("page-messages", isEditing ? "Currency updated successfully" : "Currency added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The currency ID to delete
 * @param {string} name - Display name for the confirmation message
 */
function confirmDeleteCurrency(id, name) {
  deleteCurrencyId = id;
  document.getElementById("delete-currency-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteCurrencyId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the currency deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteCurrencyId) return;

  const result = await apiRequest("/api/currencies/" + deleteCurrencyId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadCurrencies();
    showSuccess("page-messages", "Currency deleted successfully");
  } else {
    showError("page-messages", "Cannot delete currency", result.detail || result.error);
  }
}

/**
 * @description Build an HTML table from historic backfill preview rows.
 * @param {Array<{date: string, rate: number}>} rows - The preview rows (most recent first)
 * @param {string} valueLabel - Column header for the value (e.g. "Rate")
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
    const value = rows[i].rate !== undefined ? rows[i].rate : rows[i].price;
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(rows[i].date) + "</td>";
    html += '<td class="py-1 px-2 text-sm text-right font-mono">' + escapeHtml(String(value)) + "</td>";
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
 * @description Build the result HTML for a live currency rate result.
 * @param {Object} rateResult - The result from the currency rates API
 * @param {Object} currencyResult - The result from the currency lookup API
 * @returns {string} HTML string
 */
function buildRateResultHtml(rateResult, currencyResult) {
  if (rateResult.ok && rateResult.data.rates && currencyResult.ok) {
    const currencyCode = currencyResult.data.code;
    const rate = rateResult.data.rates.find(function (r) {
      return r.code === currencyCode;
    });
    if (rate) {
      return '<div class="bg-green-50 border border-green-200 rounded p-3 text-sm">' + "<p><strong>Currency:</strong> " + escapeHtml(rate.code) + " - " + escapeHtml(rate.description) + "</p>" + "<p><strong>Rate (per 1 GBP):</strong> " + escapeHtml(rate.rate.toFixed(4)) + "</p>" + "<p><strong>Date:</strong> " + escapeHtml(rate.rateDate) + "</p>" + "</div>";
    } else {
      return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>No rate found for " + escapeHtml(currencyCode) + " in API response.</p>" + "</div>";
    }
  } else {
    return '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">' + "<p>" + escapeHtml(rateResult.error || "Unknown error") + "</p>" + "</div>";
  }
}

/**
 * @description Build the result HTML for a historic currency rate preview.
 * @param {Object} historyResult - The result from the backfill test API
 * @returns {string} HTML string
 */
function buildHistoryResultHtml(historyResult) {
  if (historyResult.ok && historyResult.data.success) {
    return '<p class="text-sm text-brand-600 mb-1">' + escapeHtml(historyResult.data.code) + " — weekly Friday rates</p>" + buildHistoricPreviewTable(historyResult.data.rows, "Rate");
  } else if (historyResult.data && historyResult.data.error) {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>" + escapeHtml(historyResult.data.error) + "</p>" + "</div>";
  } else {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>Could not fetch historic preview.</p>" + "</div>";
  }
}

/**
 * @description Test fetch the exchange rate for a single currency.
 * Shows a modal immediately with spinners, then progressively updates
 * each section as the live rate and historic preview results arrive.
 * Uses testMode=true so no database tables are updated.
 * @param {number} id - The currency ID to test
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testScrapeCurrency(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Testing...";

  // Show modal immediately with spinners for both sections
  const initialHtml = '<h4 class="text-base font-semibold text-brand-800 mb-2">Live Rate Result</h4>' + '<div id="test-rate-result">' + buildSpinner("Fetching live rate...") + "</div>" + '<h4 class="text-base font-semibold text-brand-800 mt-4 mb-2">Historic Data Preview (Bank of England)</h4>' + '<div id="test-history-result">' + buildSpinner("Fetching historic data...") + "</div>";

  showModalHtml("Test Result (No DB Update)", initialHtml);

  // Fire all requests in parallel, update sections as they complete
  // The live rate and currency lookup both need to complete before we can show the rate
  const ratePromise = Promise.all([
    apiRequest("/api/scraper/currency-rates?testMode=true", {
      method: "POST",
      timeout: 60000,
    }),
    apiRequest("/api/currencies/" + id),
  ])
    .then(function (results) {
      const el = document.getElementById("test-rate-result");
      if (el) el.innerHTML = buildRateResultHtml(results[0], results[1]);
    })
    .catch(function (err) {
      const el = document.getElementById("test-rate-result");
      if (el) el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm"><p>' + escapeHtml(err.message) + "</p></div>";
    });

  const historyPromise = apiRequest("/api/backfill/test/currency/" + id, {
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
  await Promise.all([ratePromise, historyPromise]);

  button.disabled = false;
  button.textContent = originalText;
}

/**
 * @description Determine if a currency has existing rate history (older than 6 days).
 * A currency "has history" if it was loaded during this session, or if its
 * oldest_rate_date is at least 7 days before today.
 * @param {Object} cur - The currency object from the API (must have oldest_rate_date)
 * @returns {boolean} True if history exists
 */
function currencyHasHistory(cur) {
  if (loadedInSession.has(cur.id)) {
    return true;
  }

  if (!cur.oldest_rate_date) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return cur.oldest_rate_date <= cutoffStr;
}

/**
 * @description Check if a currency has history by its ID, using cached data
 * and session state.
 * @param {number} id - The currency ID
 * @returns {boolean} True if the currency has existing history
 */
function currencyHasHistoryById(id) {
  if (loadedInSession.has(id)) return true;
  const cur = cachedCurrencies.find(function (c) { return c.id === id; });
  return cur ? currencyHasHistory(cur) : false;
}

/**
 * @description Load historic exchange rates for a single currency.
 * If the currency already has rate history, shows a confirmation dialog
 * before proceeding. Otherwise proceeds directly with the load.
 * @param {number} id - The currency ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} code - The currency code for the confirmation message
 */
async function loadHistoryCurrency(id, button, code) {
  const hasHistory = currencyHasHistoryById(id);

  if (hasHistory) {
    replaceHistoryId = id;
    replaceHistoryCode = code;
    replaceHistoryButton = button;
    document.getElementById("replace-history-name").textContent = code;
    document.getElementById("replace-history-dialog").classList.remove("hidden");
    document.getElementById("replace-history-no-btn").focus();
    return;
  }

  await executeLoadHistory(id, button, code);
}

/**
 * @description Execute the actual history load for a currency.
 * Called directly for first-time loads, or after confirmation for replacements.
 * @param {number} id - The currency ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} code - The currency code
 */
async function executeLoadHistory(id, button, code) {
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const result = await apiRequest("/api/backfill/load/currency/" + id, {
      method: "POST",
      timeout: 120000,
    });

    button.disabled = false;

    if (result.ok && result.data.success) {
      loadHistoryCounts[id] = (loadHistoryCounts[id] || 0) + 1;
      loadedInSession.add(id);
      button.textContent = "Replace History";
      updateLoadBadge(id);
      showModal("History Loaded", "Currency: " + result.data.code + "\nRates loaded: " + result.data.count);
    } else {
      button.textContent = currencyHasHistoryById(id) ? "Replace History" : "Load History";
      updateLoadBadge(id);
      const errorMsg = (result.data && result.data.error) || result.error || "Unknown error";
      const desc = (result.data && result.data.code) || code;
      showModal("Load Failed", "Currency: " + desc + "\nError: " + errorMsg);
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = currencyHasHistoryById(id) ? "Replace History" : "Load History";
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
  replaceHistoryCode = "";
  document.getElementById("replace-history-dialog").classList.add("hidden");
}

/**
 * @description Execute the history replacement after the user confirmed "Yes".
 */
async function confirmReplaceHistory() {
  const id = replaceHistoryId;
  const button = replaceHistoryButton;
  const code = replaceHistoryCode;

  hideReplaceHistoryDialog();

  if (!id || !button) return;

  await executeLoadHistory(id, button, code);
}

/**
 * @description Update the Load/Replace History button badge for a currency.
 * Shows a small count badge after the button text if the count is > 0.
 * Uses the correct label based on whether history exists.
 * @param {number} id - The currency ID
 */
function updateLoadBadge(id) {
  const btn = document.getElementById("load-btn-" + id);
  if (!btn) return;
  const count = loadHistoryCounts[id] || 0;
  const label = currencyHasHistoryById(id) ? "Replace History" : "Load History";
  if (count > 0) {
    btn.innerHTML = label + " " + '<span class="inline-flex items-center justify-center bg-blue-600 text-white font-bold rounded-full w-5 h-5 ml-1 text-xs">' + count + "</span>";
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadCurrencies();

  document.getElementById("add-currency-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("currency-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("view-close-btn").addEventListener("click", hideView);
  document.getElementById("replace-history-no-btn").addEventListener("click", hideReplaceHistoryDialog);
  document.getElementById("replace-history-yes-btn").addEventListener("click", confirmReplaceHistory);

  // Close modals when clicking on the backdrop (outside the modal content)
  document.getElementById("currency-form-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideForm();
    }
  });

  document.getElementById("currency-view-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideView();
    }
  });

  document.getElementById("delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) {
      hideDeleteDialog();
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
      const formContainer = document.getElementById("currency-form-container");
      const viewContainer = document.getElementById("currency-view-container");

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
