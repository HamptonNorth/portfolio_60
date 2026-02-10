/**
 * @description Scraper Testing page logic for Portfolio 60.
 * Sandbox for testing scraper configurations without affecting live portfolio data.
 */

/** @type {number|null} ID of the test investment pending deletion */
let deleteTestId = null;

/** @type {Array<{id: number, short_description: string, description: string}>} Cached investment types */
let investmentTypes = [];

/** @type {Array<{id: number, code: string, description: string}>} Cached currencies */
let currencies = [];

/** @type {Array<{pattern: string, name: string, selector: string, waitStrategy: string, notes: string}>} Cached scraper site configs */
let scraperSites = [];

/** @type {boolean} True when a Test All operation is in progress */
let testAllRunning = false;

/** @type {string|null} ID of the badge element for the currently active stream ('stalest-badge' or 'test-all-badge') */
let activeBadgeId = null;

/** @type {number} Running count of completed items during a stream */
let streamCompletedCount = 0;

/** @type {number} Total items in the current stream */
let streamTotalCount = 0;

/** @type {number} Configured stalest limit from config.json (default 20) */
let stalestLimit = 20;

/** @type {Object.<number, {success: boolean, rows: Array, error?: string, currency?: string, description?: string}>} Cached history results by test investment ID */
let historyResults = {};

/** @type {Object.<number, string>} Cached scrape error messages by test investment ID */
let scrapeErrors = {};

/**
 * @description Check the feature flag and show/hide content accordingly.
 * @returns {Promise<boolean>} True if feature is enabled
 */
async function checkFeatureEnabled() {
  const result = await apiRequest("/api/config/scraper-testing-enabled");
  if (result.ok && result.data.enabled) {
    document.getElementById("feature-disabled").classList.add("hidden");
    document.getElementById("feature-content").classList.remove("hidden");
    // Read stalest limit from config and update button label
    if (result.data.stalestLimit && result.data.stalestLimit > 0) {
      stalestLimit = result.data.stalestLimit;
    }
    const stalestBtn = document.getElementById("test-stalest-btn");
    if (stalestBtn) {
      stalestBtn.firstChild.textContent = "Test Stalest " + stalestLimit + " ";
    }
    return true;
  } else {
    document.getElementById("feature-disabled").classList.remove("hidden");
    document.getElementById("feature-content").classList.add("hidden");
    return false;
  }
}

/**
 * @description Load investment types from the API and cache them.
 */
async function loadInvestmentTypes() {
  const result = await apiRequest("/api/investment-types");
  if (result.ok) {
    investmentTypes = result.data;
  }
}

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
 * @description Load scraper site configurations from the API and cache them.
 */
async function loadScraperSites() {
  const result = await apiRequest("/api/config/scraper-sites");
  if (result.ok) {
    scraperSites = result.data;
  }
}

/**
 * @description Populate the investment type <select> element with options.
 * @param {number|string} [selectedId=""] - The type ID to pre-select
 */
function populateTypeDropdown(selectedId) {
  const select = document.getElementById("investment_type_id");
  select.innerHTML = '<option value="">Select type...</option>';

  for (const type of investmentTypes) {
    const option = document.createElement("option");
    option.value = type.id;
    option.textContent = type.description;
    if (selectedId && Number(type.id) === Number(selectedId)) {
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
 * @description Populate the source site <select> element with known scraper sites.
 * @param {string} [selectedName=""] - The site name to pre-select
 */
function populateSourceSiteDropdown(selectedName) {
  const select = document.getElementById("source_site");
  select.innerHTML = '<option value="">— Select a source site —</option>';

  for (const site of scraperSites) {
    const option = document.createElement("option");
    option.value = site.name;
    option.textContent = site.name;
    if (selectedName && site.name === selectedName) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  // Add a "Custom" option for URLs not matching any known site
  const customOption = document.createElement("option");
  customOption.value = "Custom";
  customOption.textContent = "Custom";
  if (selectedName === "Custom") {
    customOption.selected = true;
  }
  select.appendChild(customOption);
}

/**
 * @description Handle source site dropdown selection.
 * Auto-fills the CSS selector from the site config when a known site is selected.
 */
function handleSourceSiteSelect() {
  const select = document.getElementById("source_site");
  const selectorField = document.getElementById("selector");
  const siteName = select.value;

  if (!siteName || siteName === "Custom") {
    return;
  }

  const site = scraperSites.find(function (s) {
    return s.name === siteName;
  });

  if (site && !selectorField.value.trim()) {
    selectorField.value = site.selector;
  }
}

/**
 * @description Fetch and display the Public ID help content in a modal.
 */
async function showPublicIdHelp() {
  const result = await apiRequest("/api/config/help/public-id");
  if (result.ok) {
    showModalHtml("Public ID Formats", result.data.html);
  } else {
    showModal("Error", "Failed to load help content: " + (result.error || "Unknown error"));
  }
}

/**
 * @description Check the format of a public_id value and update the status display.
 * @param {string} value - The public_id value to check
 */
function checkPublicIdFormat(value) {
  const statusEl = document.getElementById("public-id-status");

  if (!value || value.trim() === "") {
    statusEl.classList.add("hidden");
    return;
  }

  const trimmed = value.trim().toUpperCase();
  const isinPattern = /^[A-Z]{2}[A-Z0-9]{10}$/;
  const tickerPattern = /^[A-Z]{1,10}:[A-Z0-9.]{1,10}$/;
  const etfPattern = /^[A-Z0-9.]{1,10}:[A-Z]{1,10}:[A-Z]{3}$/;

  if (isinPattern.test(trimmed)) {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = "<strong>ISIN detected.</strong> FT Markets fund URL will be generated automatically.";
    statusEl.classList.remove("hidden");
  } else if (etfPattern.test(trimmed)) {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = "<strong>ETF detected.</strong> FT Markets ETF URL will be generated automatically.";
    statusEl.classList.remove("hidden");
  } else if (tickerPattern.test(trimmed)) {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = "<strong>Exchange:Ticker detected.</strong> FT Markets equity URL will be generated automatically.";
    statusEl.classList.remove("hidden");
  } else {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-amber-50 border border-amber-200 text-amber-700";
    statusEl.innerHTML = "Format not recognised. Expected ISIN (e.g. GB00B4PQW151), Exchange:Ticker (e.g. LSE:AZN), or Ticker:Exchange:Currency (e.g. ISF:LSE:GBX).";
    statusEl.classList.remove("hidden");
  }
}

/**
 * @description Load and display all test investments in the table.
 */
async function loadTestInvestments() {
  const container = document.getElementById("test-investments-table-container");

  const result = await apiRequest("/api/test-investments");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load test investments</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p></div>";
    return;
  }

  const tests = result.data;

  // Update total count in header
  const scrapeable = tests.filter(function (ti) {
    return ti.investment_url || ti.public_id;
  });
  const totalCountEl = document.getElementById("test-total-count");
  if (totalCountEl) {
    totalCountEl.textContent = "(" + scrapeable.length + " scrapeable of " + tests.length + " total)";
  }

  if (tests.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No test investments yet. Click "Add Test" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700">Description</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700">Type</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700">Source Site</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700">Public ID</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700">Last Test</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700 text-center">Status</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700 text-right">Price</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700 text-center">History</th>';
  html += '<th class="py-1.5 px-2 text-xs font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < tests.length; i++) {
    const ti = tests[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    // Status icon
    let statusHtml = '<span class="text-brand-300">—</span>';
    if (ti.last_test_success === 1) {
      statusHtml = '<span class="text-green-600 font-bold">&#10003;</span>';
    } else if (ti.last_test_success === 0 && ti.last_test_date) {
      statusHtml = '<span class="text-red-600 font-bold">&#10007;</span>';
    }

    // Price display
    let priceDisplay = "—";
    if (ti.last_test_price) {
      const priceNum = parseFloat(ti.last_test_price);
      if (!isNaN(priceNum)) {
        priceDisplay = priceNum.toFixed(2) + "p";
      } else {
        priceDisplay = ti.last_test_price;
      }
    }

    html += '<tr id="test-row-' + ti.id + '" data-id="' + ti.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors">';
    html += '<td class="py-1.5 px-2 text-xs cursor-context-menu" oncontextmenu="showScrapeDetails(' + ti.id + ', event)">' + escapeHtml(ti.description) + "</td>";
    html += '<td class="py-1.5 px-2 text-xs">' + escapeHtml(ti.type_description) + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-brand-500">' + escapeHtml(ti.source_site || "—") + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-brand-500 font-mono">' + escapeHtml(ti.public_id || "—") + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-brand-500">' + escapeHtml(ti.last_test_date || "—") + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-center" id="status-' + ti.id + '">' + statusHtml + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-right font-mono" id="price-' + ti.id + '">' + escapeHtml(priceDisplay) + "</td>";
    html += '<td class="py-1.5 px-2 text-xs text-center" id="history-' + ti.id + '"><span class="text-brand-300">—</span></td>';
    html += '<td class="py-1.5 px-2 text-xs flex gap-1">';
    html += '<button id="test-btn-' + ti.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium px-1.5 py-0.5 rounded transition-colors whitespace-nowrap" onclick="testSingle(' + ti.id + ', this)">Test</button>';
    html += '<button class="bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded transition-colors whitespace-nowrap" onclick="toggleHistory(' + ti.id + ', this)">History</button>';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-xs font-medium px-1.5 py-0.5 rounded transition-colors whitespace-nowrap" onclick="editTestInvestment(' + ti.id + ')">Edit</button>';
    html += '<button class="bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium px-1.5 py-0.5 rounded transition-colors whitespace-nowrap" onclick="confirmDelete(' + ti.id + ", '" + escapeHtml(ti.description).replace(/'/g, "\\'") + "')\">" + "Delete</button>";
    html += "</td>";
    html += "</tr>";
    // History panel (hidden by default, shown below the row)
    html += '<tr id="history-panel-' + ti.id + '" class="hidden">';
    html += '<td colspan="9" class="px-4 py-2 bg-brand-25 border-b border-brand-200">';
    html += '<div id="history-content-' + ti.id + '"></div>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Show the add form modal (empty fields).
 */
function showAddForm() {
  document.getElementById("form-title").textContent = "Add Test Investment";
  document.getElementById("test-investment-id").value = "";
  document.getElementById("test-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  document.getElementById("public-id-status").classList.add("hidden");
  populateTypeDropdown();
  populateCurrencyDropdown();
  populateSourceSiteDropdown();
  document.getElementById("test-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Load a test investment's data into the form for editing.
 * @param {number} id - The test investment ID to edit
 */
async function editTestInvestment(id) {
  const result = await apiRequest("/api/test-investments/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load test investment", result.detail || result.error);
    return;
  }

  const ti = result.data;
  document.getElementById("form-title").textContent = "Edit Test Investment";
  document.getElementById("test-investment-id").value = ti.id;
  document.getElementById("description").value = ti.description;
  populateTypeDropdown(ti.investment_type_id);
  populateCurrencyDropdown(ti.currencies_id);
  populateSourceSiteDropdown(ti.source_site || "");
  document.getElementById("public_id").value = ti.public_id || "";
  document.getElementById("investment_url").value = ti.investment_url || "";
  document.getElementById("selector").value = ti.selector || "";
  document.getElementById("notes").value = ti.notes || "";
  document.getElementById("form-errors").textContent = "";

  checkPublicIdFormat(ti.public_id || "");

  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDelete(ti.id, ti.description);
  };

  document.getElementById("test-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  document.getElementById("test-form-container").classList.add("hidden");
}

/**
 * @description Handle form submission for creating or updating a test investment.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const testId = document.getElementById("test-investment-id").value;
  const isEditing = testId !== "";

  const data = {
    description: document.getElementById("description").value.trim(),
    investment_type_id: document.getElementById("investment_type_id").value || null,
    currencies_id: document.getElementById("currencies_id").value || null,
    public_id: document.getElementById("public_id").value.trim().toUpperCase() || null,
    investment_url: document.getElementById("investment_url").value.trim() || null,
    selector: document.getElementById("selector").value.trim() || null,
    source_site: document.getElementById("source_site").value || null,
    notes: document.getElementById("notes").value.trim() || null,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/test-investments/" + testId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/test-investments", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadTestInvestments();
    showSuccess("page-messages", isEditing ? "Test investment updated" : "Test investment added");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The test investment ID to delete
 * @param {string} name - The description for the confirmation message
 */
function confirmDelete(id, name) {
  deleteTestId = id;
  document.getElementById("delete-test-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteTestId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the test investment deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteTestId) return;

  const result = await apiRequest("/api/test-investments/" + deleteTestId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadTestInvestments();
    showSuccess("page-messages", "Test investment deleted");
  } else {
    showError("page-messages", "Failed to delete", result.detail || result.error);
  }
}

/**
 * @description Test scrape a single test investment by ID.
 * @param {number} id - The test investment ID
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testSingle(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Testing...";

  // Update status and history cells to show spinners
  const statusCell = document.getElementById("status-" + id);
  if (statusCell) {
    statusCell.innerHTML = '<div class="w-4 h-4 border-2 border-brand-300 border-t-brand-700 rounded-full animate-spin mx-auto"></div>';
  }
  const historyCell = document.getElementById("history-" + id);
  if (historyCell) {
    historyCell.innerHTML = '<div class="w-4 h-4 border-2 border-brand-300 border-t-brand-700 rounded-full animate-spin mx-auto"></div>';
  }

  // Fire live scrape and history preview in parallel
  let scrapedPriceMinor = null;
  const scrapePromise = apiRequest("/api/test-investments/" + id + "/scrape", {
    method: "POST",
    timeout: 120000,
  })
    .then(function (result) {
      if (result.ok && result.data.success) {
        delete scrapeErrors[id];
        const priceMinor = result.data.priceMinorUnit;
        scrapedPriceMinor = priceMinor;
        if (statusCell) {
          statusCell.innerHTML = '<span class="text-green-600 font-bold">&#10003;</span>';
        }
        const priceCell = document.getElementById("price-" + id);
        if (priceCell) {
          priceCell.textContent = priceMinor != null ? parseFloat(priceMinor).toFixed(2) + "p" : "—";
        }
      } else {
        const errorMsg = (result.data && result.data.error) || result.error || "Unknown error";
        scrapeErrors[id] = errorMsg;
        if (statusCell) {
          statusCell.innerHTML = '<span class="text-red-600 font-bold cursor-pointer" onclick="showScrapeError(' + id + ')" title="Click to view error">&#10007;</span>';
        }
      }
    })
    .catch(function (err) {
      scrapeErrors[id] = err.message;
      if (statusCell) {
        statusCell.innerHTML = '<span class="text-red-600 font-bold cursor-pointer" onclick="showScrapeError(' + id + ')" title="Click to view error">&#10007;</span>';
      }
    });

  const historyPromise = apiRequest("/api/test-investments/" + id + "/backfill/test", {
    timeout: 30000,
  })
    .then(function (result) {
      updateHistoryCell(id, result.ok ? result.data : { success: false, error: result.error });
    })
    .catch(function () {
      updateHistoryCell(id, { success: false, rows: [], error: "Request failed" });
    });

  await Promise.all([scrapePromise, historyPromise]);

  // Cross-validate: compare live scrape price with most recent Morningstar price
  if (scrapedPriceMinor != null && historyResults[id] && historyResults[id].success && historyResults[id].rows && historyResults[id].rows.length > 0) {
    const scrapedMajor = scrapedPriceMinor / 100;
    const morningstarMajor = historyResults[id].rows[0].price;
    const morningstarDate = historyResults[id].rows[0].date;
    if (morningstarMajor > 0) {
      const pctDiff = ((scrapedMajor - morningstarMajor) / morningstarMajor) * 100;
      if (Math.abs(pctDiff) > 5) {
        historyResults[id].priceWarning = {
          scrapedPrice: scrapedMajor,
          morningstarPrice: morningstarMajor,
          morningstarDate: morningstarDate,
          pctDiff: pctDiff,
        };
        updateHistoryCell(id, historyResults[id]);
      }
    }
  }

  button.disabled = false;
  button.textContent = originalText;
}

/**
 * @description Update the history cell for a test investment with the backfill result.
 * Stores the result in historyResults for later detail modal display.
 * @param {number} id - The test investment ID
 * @param {Object} data - The backfill test result {success, rows, error?, currency?, description?}
 */
function updateHistoryCell(id, data) {
  historyResults[id] = data;
  const cell = document.getElementById("history-" + id);
  if (!cell) return;

  // Remove any existing price-warning row for this investment
  const existingWarning = document.getElementById("price-warning-" + id);
  if (existingWarning) {
    existingWarning.remove();
  }

  if (data.success && data.rows && data.rows.length > 0) {
    if (data.priceWarning) {
      const w = data.priceWarning;
      const sign = w.pctDiff >= 0 ? "+" : "";
      const tooltipText = "Scraped " + w.scrapedPrice.toFixed(4) + " vs Morningstar " + w.morningstarPrice.toFixed(4) + " (" + sign + w.pctDiff.toFixed(1) + "%)";

      // History found but price mismatch — amber warning with click for detail
      cell.innerHTML = '<span class="text-amber-600 font-bold cursor-pointer" onclick="showHistoryDetail(' + id + ')" title="' + escapeHtml(tooltipText) + '">&#9888; ' + data.rows.length + "</span>";

      // Insert a warning detail row after the main row
      const mainRow = document.getElementById("test-row-" + id);
      if (mainRow) {
        const warningRow = document.createElement("tr");
        warningRow.id = "price-warning-" + id;
        warningRow.className = "bg-amber-50 border-b border-amber-200";
        warningRow.innerHTML = '<td colspan="9" class="py-0.5 px-2 text-xs text-amber-700">' + '<span class="font-medium">Price check:</span> ' + "Scraped <strong>" + w.scrapedPrice.toFixed(4) + "</strong>" + " &mdash; Morningstar <strong>" + w.morningstarPrice.toFixed(4) + "</strong>" + " (" + w.morningstarDate + ")" + " &mdash; difference: <strong>" + sign + w.pctDiff.toFixed(1) + "%</strong>" + "</td>";
        mainRow.insertAdjacentElement("afterend", warningRow);
      }
    } else {
      cell.innerHTML = '<span class="text-green-600 font-bold cursor-pointer" onclick="showHistoryDetail(' + id + ')" title="Click to view historic prices">&#10003; ' + data.rows.length + "</span>";
    }
  } else if (data.success && (!data.rows || data.rows.length === 0)) {
    cell.innerHTML = '<span class="text-amber-500" title="No historic data found">—</span>';
  } else {
    cell.innerHTML = '<span class="text-red-600 font-bold cursor-pointer" onclick="showHistoryDetail(' + id + ')" title="Click to view error">&#10007;</span>';
  }
}

/**
 * @description Show the scrape error for a test investment in a modal.
 * @param {number} id - The test investment ID
 */
function showScrapeError(id) {
  const error = scrapeErrors[id];
  if (!error) {
    showModal("Price Scrape", "No error recorded.");
    return;
  }
  showModal("Price Scrape Failed", error);
}

/**
 * @description Show a modal with historic price detail for a test investment.
 * @param {number} id - The test investment ID
 */
function showHistoryDetail(id) {
  const data = historyResults[id];
  if (!data) {
    showModal("Historic Data", "Run Test to see historic data.");
    return;
  }

  if (!data.success) {
    showModal("Historic Data — Error", data.error || "Could not fetch historic data from Morningstar.");
    return;
  }

  if (!data.rows || data.rows.length === 0) {
    showModal("Historic Data", "No historic price data found on Morningstar.");
    return;
  }

  let html = '<div class="space-y-3">';
  if (data.description) {
    html += '<p class="text-sm text-brand-600">' + escapeHtml(data.description);
    if (data.currency) {
      html += " (" + escapeHtml(data.currency) + ")";
    }
    html += "</p>";
  }
  if (data.priceWarning) {
    var w = data.priceWarning;
    var sign = w.pctDiff >= 0 ? "+" : "";
    html += '<div class="bg-amber-50 border border-amber-200 rounded p-2 mb-2 text-sm text-amber-700">' + '<span class="font-medium">Price check:</span> ' + "Scraped <strong>" + w.scrapedPrice.toFixed(4) + "</strong>" + " &mdash; Morningstar <strong>" + w.morningstarPrice.toFixed(4) + "</strong>" + " (" + w.morningstarDate + ")" + " &mdash; difference: <strong>" + sign + w.pctDiff.toFixed(1) + "%</strong>" + "</div>";
  }
  html += '<p class="text-xs text-brand-400 mb-2">Most recent ' + data.rows.length + " weekly prices from Morningstar (read-only preview, no DB writes)</p>";
  html += '<table class="w-full text-left border-collapse">';
  html += '<thead><tr class="border-b border-brand-200">';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700 text-right">Price</th>';
  html += "</tr></thead><tbody>";

  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    var rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(row.date) + "</td>";
    html += '<td class="py-1 px-2 text-sm text-right font-mono">' + row.price.toFixed(4) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  showModalHtml("Historic Data Preview (Morningstar)", html);
}

/**
 * @description Start an SSE test stream against the given URL and wire up
 * the standard event handlers (init, price, retry, history, done, error).
 * Shared by both Test All and Test Stalest buttons.
 * @param {string} streamUrl - The SSE endpoint URL
 */
function startTestStream(streamUrl) {
  const eventSource = new EventSource(streamUrl);

  eventSource.addEventListener("init", function (event) {
    const data = JSON.parse(event.data);
    // Set up counter badge
    streamTotalCount = data.total || 0;
    streamCompletedCount = 0;
    updateActiveBadge();
    // Set all scrapeable rows to spinners for both status and history
    for (const inv of data.investments) {
      const statusCell = document.getElementById("status-" + inv.investmentId);
      if (statusCell) {
        statusCell.innerHTML = '<div class="w-4 h-4 border-2 border-brand-300 border-t-brand-700 rounded-full animate-spin mx-auto"></div>';
      }
      const historyCell = document.getElementById("history-" + inv.investmentId);
      if (historyCell) {
        historyCell.innerHTML = '<div class="w-4 h-4 border-2 border-brand-300 border-t-brand-700 rounded-full animate-spin mx-auto"></div>';
      }
    }
  });

  eventSource.addEventListener("price", function (event) {
    const result = JSON.parse(event.data);
    streamCompletedCount++;
    updateActiveBadge();
    const statusCell = document.getElementById("status-" + result.investmentId);
    const priceCell = document.getElementById("price-" + result.investmentId);

    if (result.success) {
      delete scrapeErrors[result.investmentId];
      if (statusCell) {
        statusCell.innerHTML = '<span class="text-green-600 font-bold">&#10003;</span>';
      }
      if (priceCell) {
        const priceMinor = result.priceMinorUnit;
        priceCell.textContent = priceMinor != null ? parseFloat(priceMinor).toFixed(2) + "p" : "—";
      }
    } else {
      scrapeErrors[result.investmentId] = result.error || "Unknown error";
      if (statusCell) {
        statusCell.innerHTML = '<span class="text-red-600 font-bold cursor-pointer" onclick="showScrapeError(' + result.investmentId + ')" title="Click to view error">&#10007;</span>';
      }
    }
  });

  eventSource.addEventListener("retry", function (event) {
    const data = JSON.parse(event.data);
    const statusCell = document.getElementById("status-" + data.investmentId);
    if (statusCell) {
      statusCell.innerHTML = '<div class="flex items-center justify-center gap-1">' + '<div class="w-4 h-4 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin"></div>' + '<span class="text-xs text-amber-600">' + data.attemptNumber + "/" + data.maxAttempts + "</span></div>";
    }
  });

  eventSource.addEventListener("history", function (event) {
    const data = JSON.parse(event.data);
    updateHistoryCell(data.investmentId, data);
  });

  eventSource.addEventListener("done", function (event) {
    const data = JSON.parse(event.data);
    eventSource.close();
    finishTestAll(data);
  });

  eventSource.addEventListener("error", function (event) {
    eventSource.close();
    finishTestAll(null);
    showError("page-messages", "Test failed", "Connection to server lost. If a previous test is still running on the server, wait for it to finish or restart the server.");
  });
}

/**
 * @description Update the counter badge on the active stream button.
 */
function updateActiveBadge() {
  if (!activeBadgeId) return;
  const badge = document.getElementById(activeBadgeId);
  if (badge) {
    badge.textContent = streamCompletedCount + "/" + streamTotalCount;
  }
}

/**
 * @description Disable both test stream buttons and all individual Test buttons.
 * Does not change button labels — just disables them.
 */
function disableTestButtons() {
  document.getElementById("test-all-btn").disabled = true;
  document.getElementById("test-stalest-btn").disabled = true;

  document.querySelectorAll('[id^="test-btn-"]').forEach(function (btn) {
    btn.disabled = true;
  });
}

/**
 * @description Test all test investments via SSE streaming.
 */
function testAll() {
  if (testAllRunning) return;
  testAllRunning = true;
  activeBadgeId = "test-all-badge";
  streamCompletedCount = 0;
  streamTotalCount = 0;
  disableTestButtons();
  startTestStream("/api/test-investments/scrape/stream");
}

/**
 * @description Test the stalest 20 test investments via SSE streaming.
 * Uses the cron delay profile for longer, more polite pauses.
 */
function testStalest() {
  if (testAllRunning) return;
  testAllRunning = true;
  activeBadgeId = "stalest-badge";
  streamCompletedCount = 0;
  streamTotalCount = 0;
  disableTestButtons();
  startTestStream("/api/test-investments/scrape/stalest?limit=" + stalestLimit);
}

/**
 * @description Clean up after Test All or Test Stalest completes.
 * @param {Object|null} summary - The done event data, or null on error
 */
function finishTestAll(summary) {
  testAllRunning = false;

  document.getElementById("test-all-btn").disabled = false;
  document.getElementById("test-stalest-btn").disabled = false;

  // Clear the badge
  if (activeBadgeId) {
    const badge = document.getElementById(activeBadgeId);
    if (badge) {
      badge.textContent = "";
    }
    activeBadgeId = null;
  }

  // Re-enable individual Test buttons
  document.querySelectorAll('[id^="test-btn-"]').forEach(function (btn) {
    btn.disabled = false;
  });

  if (summary) {
    showSuccess("page-messages", summary.message);
  }
}

/**
 * @description Toggle the price history panel for a test investment.
 * @param {number} id - The test investment ID
 * @param {HTMLElement} button - The button that was clicked
 */
async function toggleHistory(id, button) {
  const panel = document.getElementById("history-panel-" + id);
  const content = document.getElementById("history-content-" + id);

  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    return;
  }

  // Show loading
  content.innerHTML = '<p class="text-sm text-brand-500">Loading price history...</p>';
  panel.classList.remove("hidden");

  const result = await apiRequest("/api/test-investments/" + id + "/prices");

  if (!result.ok) {
    content.innerHTML = '<p class="text-sm text-error">Failed to load prices: ' + escapeHtml(result.error) + "</p>";
    return;
  }

  const prices = result.data;

  if (prices.length === 0) {
    content.innerHTML = '<p class="text-sm text-brand-500">No price history yet. Click "Test" to scrape a price.</p>';
    return;
  }

  let html = '<table class="w-full text-left border-collapse">';
  html += '<thead><tr class="border-b border-brand-200">';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700">Time</th>';
  html += '<th class="py-1 px-2 text-sm font-semibold text-brand-700 text-right">Price (minor unit)</th>';
  html += "</tr></thead><tbody>";

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(p.price_date) + "</td>";
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(p.price_time) + "</td>";
    html += '<td class="py-1 px-2 text-sm text-right font-mono">' + p.price.toFixed(4) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  content.innerHTML = html;
}

/**
 * @description Show scrape configuration details for a test investment in a modal.
 * Triggered by right-clicking the description cell. Fetches the current record
 * from the API so the displayed values reflect any write-backs from fallback logic.
 * @param {number} id - The test investment ID
 * @param {Event} event - The contextmenu event
 */
async function showScrapeDetails(id, event) {
  event.preventDefault();

  const [result, configResult] = await Promise.all([apiRequest("/api/test-investments/" + id), apiRequest("/api/test-investments/" + id + "/scrape-config")]);

  if (!result.ok) {
    showModal("Error", "Failed to load investment details: " + (result.detail || result.error));
    return;
  }

  const ti = result.data;
  const config = configResult.ok ? configResult.data : { url: null, selector: null, urlSource: "unknown", selectorSource: "unknown" };

  let html = '<div class="space-y-3 text-sm">';

  html += "<div>";
  html += '<label class="block font-semibold text-brand-700 mb-1">Description</label>';
  html += '<div class="bg-brand-50 rounded px-3 py-2 select-all">' + escapeHtml(ti.description) + "</div>";
  html += "</div>";

  if (ti.public_id) {
    html += "<div>";
    html += '<label class="block font-semibold text-brand-700 mb-1">Public ID</label>';
    html += '<div class="bg-brand-50 rounded px-3 py-2 font-mono select-all">' + escapeHtml(ti.public_id) + "</div>";
    html += "</div>";
  }

  if (ti.source_site) {
    html += "<div>";
    html += '<label class="block font-semibold text-brand-700 mb-1">Source Site</label>';
    html += '<div class="bg-brand-50 rounded px-3 py-2 select-all">' + escapeHtml(ti.source_site) + "</div>";
    html += "</div>";
  }

  html += "<div>";
  html += '<label class="block font-semibold text-brand-700 mb-1">Effective URL <span class="font-normal text-brand-400">(' + escapeHtml(config.urlSource) + ")</span></label>";
  if (config.url) {
    html += '<div class="bg-brand-50 rounded px-3 py-2 font-mono text-xs break-all select-all">' + escapeHtml(config.url) + "</div>";
  } else {
    html += '<div class="text-brand-400 italic">No URL available</div>';
  }
  html += "</div>";

  html += "<div>";
  html += '<label class="block font-semibold text-brand-700 mb-1">Effective CSS Selector <span class="font-normal text-brand-400">(' + escapeHtml(config.selectorSource) + ")</span></label>";
  if (config.selector) {
    html += '<div class="bg-brand-50 rounded px-3 py-2 font-mono text-xs break-all select-all">' + escapeHtml(config.selector) + "</div>";
  } else {
    html += '<div class="text-brand-400 italic">No selector available</div>';
  }
  html += "</div>";

  if (ti.notes) {
    html += "<div>";
    html += '<label class="block font-semibold text-brand-700 mb-1">Notes</label>';
    html += '<div class="bg-brand-50 rounded px-3 py-2 select-all">' + escapeHtml(ti.notes) + "</div>";
    html += "</div>";
  }

  html += "</div>";

  showModalHtml("Scrape Details", html);
}

/**
 * @description Reset all test data by calling the seed SQL endpoint.
 * Prompts the user for confirmation before proceeding.
 */
async function resetTestData() {
  if (!confirm("This will delete all test investments, test prices, and test scraping history, then re-seed from the standard data set plus your current live investments.\n\nContinue?")) {
    return;
  }

  const link = document.getElementById("reset-test-data-link");
  const originalText = link.textContent;
  link.textContent = "Resetting...";
  link.style.pointerEvents = "none";

  const result = await apiRequest("/api/test-investments/reset", {
    method: "POST",
  });

  link.textContent = originalText;
  link.style.pointerEvents = "";

  if (result.ok) {
    await loadTestInvestments();
    showSuccess("page-messages", result.data.message);
  } else {
    showError("page-messages", "Failed to reset test data", result.detail || result.error);
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  const enabled = await checkFeatureEnabled();
  if (!enabled) return;

  await loadInvestmentTypes();
  await loadCurrencies();
  await loadScraperSites();
  await loadTestInvestments();

  document.getElementById("add-test-btn").addEventListener("click", showAddForm);
  document.getElementById("test-all-btn").addEventListener("click", testAll);
  document.getElementById("test-stalest-btn").addEventListener("click", testStalest);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("test-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("source_site").addEventListener("change", handleSourceSiteSelect);
  document.getElementById("reset-test-data-link").addEventListener("click", function (event) {
    event.preventDefault();
    resetTestData();
  });

  // Public ID format checking (debounced)
  let publicIdCheckTimeout = null;
  document.getElementById("public_id").addEventListener("input", function (event) {
    if (publicIdCheckTimeout) clearTimeout(publicIdCheckTimeout);
    publicIdCheckTimeout = setTimeout(function () {
      checkPublicIdFormat(event.target.value);
    }, 500);
  });

  // Close modals on backdrop click
  document.getElementById("test-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideForm();
  });
  document.getElementById("delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) hideDeleteDialog();
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const deleteDialog = document.getElementById("delete-dialog");
      const formContainer = document.getElementById("test-form-container");
      if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      }
    }
  });
});
