/**
 * @description Benchmarks page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting benchmarks.
 */

/** @type {number|null} ID of the benchmark pending deletion */
let deleteBenchmarkId = null;

/** @type {string} Name of the benchmark pending deletion (for confirmation dialog) */
let deleteBenchmarkName = "";

/** @type {Array<{id: number, code: string, description: string}>} Cached currencies */
let currencies = [];

/** @type {number|null} The GBP currency ID (for index benchmark validation) */
let gbpCurrencyId = null;

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
    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="viewBenchmark(' + bm.id + ')">View</button>';
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
  document.getElementById("add-benchmark-btn").classList.add("hidden");
}

/**
 * @description Hide the read-only view panel and show the Add Benchmark button.
 */
function hideView() {
  document.getElementById("benchmark-view-container").classList.add("hidden");
  document.getElementById("add-benchmark-btn").classList.remove("hidden");
  clearRowHighlight();
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
  clearRowHighlight();
  document.getElementById("benchmark-view-container").classList.add("hidden");
  document.getElementById("benchmark-form-container").classList.remove("hidden");
  document.getElementById("add-benchmark-btn").classList.add("hidden");
  document.getElementById("description").focus();
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
  document.getElementById("add-benchmark-btn").classList.add("hidden");
  document.getElementById("description").focus();
}

/**
 * @description Hide the form and show the Add Benchmark button again.
 */
function hideForm() {
  document.getElementById("benchmark-form-container").classList.add("hidden");
  document.getElementById("add-benchmark-btn").classList.remove("hidden");
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

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadCurrencies();
  await loadGbpCurrencyId();
  await loadBenchmarks();

  document.getElementById("add-benchmark-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("benchmark-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("view-close-btn").addEventListener("click", hideView);

  // Handle type change to enforce GBP for index benchmarks
  document.getElementById("benchmark_type").addEventListener("change", handleTypeChange);
});
