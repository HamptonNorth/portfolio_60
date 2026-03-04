/**
 * @description Investments page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting investments.
 */

/** @type {number|null} ID of the investment pending deletion */
let deleteInvestmentId = null;

/** @type {string} Name of the investment pending deletion (for confirmation dialog) */
let deleteInvestmentName = "";

/** @type {Object<number, number>} Track Load History click counts per investment ID */
let loadHistoryCounts = {};

/** @type {Array<Object>} Cached investments data from last API load */
let cachedInvestments = [];

/** @type {Set<number>} Investment IDs that have been successfully loaded in this session */
let loadedInSession = new Set();

/** @type {number|null} ID of the investment pending history replacement */
let replaceHistoryId = null;

/** @type {string} Name of the investment pending history replacement */
let replaceHistoryName = "";

/** @type {HTMLElement|null} Reference to the button that triggered the replacement */
let replaceHistoryButton = null;

/** @type {Array<{id: number, short_description: string, description: string, usage_notes: string|null}>} Cached investment types */
let investmentTypes = [];

/** @type {Array<{id: number, code: string, description: string}>} Cached currencies */
let currencies = [];

/** @type {Object|null} Currently matched site config from URL */
let matchedSiteConfig = null;

/** @type {Array<{pattern: string, name: string, selector: string, waitStrategy: string, notes: string}>} Cached scraper site configs */
let scraperSites = [];

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
    selectorHelpEl.textContent = "To find the CSS selector: right-click the price on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
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
    selectorHelpEl.textContent = "To find the CSS selector: right-click the price on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
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
 * Validates whether the input is an ISIN or exchange:ticker format and shows
 * appropriate feedback below the field.
 * @param {string} value - The public_id value to check
 */
function checkPublicIdFormat(value) {
  const statusEl = document.getElementById("public-id-status");
  const urlField = document.getElementById("investment_url");

  if (!value || value.trim() === "") {
    statusEl.classList.add("hidden");
    return;
  }

  const trimmed = value.trim().toUpperCase();

  // ISIN: exactly 12 chars, 2 uppercase letters + 10 alphanumeric
  const isinPattern = /^[A-Z]{2}[A-Z0-9]{10}$/;
  // Ticker: EXCHANGE:SYMBOL
  const tickerPattern = /^[A-Z]{1,10}:[A-Z0-9.]{1,10}$/;

  // ETF: TICKER:EXCHANGE:CURRENCY (three parts)
  const etfPattern = /^[A-Z0-9.]{1,10}:[A-Z]{1,10}:[A-Z]{3}$/;

  if (isinPattern.test(trimmed)) {
    let statusHtml = "<strong>ISIN detected.</strong> FT Markets fund URL will be generated automatically.";
    if (urlField && urlField.value.trim()) {
      statusHtml = "<strong>ISIN detected.</strong> Manual URL takes priority over auto-generated URL.";
    }
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = statusHtml;
    statusEl.classList.remove("hidden");
  } else if (etfPattern.test(trimmed)) {
    let statusHtml = "<strong>ETF detected.</strong> FT Markets ETF URL will be generated automatically.";
    if (urlField && urlField.value.trim()) {
      statusHtml = "<strong>ETF detected.</strong> Manual URL takes priority over auto-generated URL.";
    }
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = statusHtml;
    statusEl.classList.remove("hidden");
  } else if (tickerPattern.test(trimmed)) {
    let statusHtml = "<strong>Exchange:Ticker detected.</strong> FT Markets equity URL will be generated automatically.";
    if (urlField && urlField.value.trim()) {
      statusHtml = "<strong>Exchange:Ticker detected.</strong> Manual URL takes priority over auto-generated URL.";
    }
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = statusHtml;
    statusEl.classList.remove("hidden");
  } else {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-amber-50 border border-amber-200 text-amber-700";
    statusEl.innerHTML = "Format not recognised. Expected ISIN (e.g. GB00B4PQW151), Exchange:Ticker (e.g. LSE:AZN), or Ticker:Exchange:Currency (e.g. ISF:LSE:GBX).";
    statusEl.classList.remove("hidden");
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
    // "None" selected — clear site status but don't wipe user-entered selector
    matchedSiteConfig = null;
    statusEl.classList.add("hidden");
    selectorHelpEl.textContent = "To find the CSS selector: right-click the price on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
    return;
  }

  const site = scraperSites[Number(idx)];
  matchedSiteConfig = site;

  // Show site info with notes
  let statusHtml = "<strong>Known site:</strong> " + escapeHtml(site.name) + ".";
  if (site.notes) {
    statusHtml += " " + escapeHtml(site.notes);
  }
  statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
  statusEl.innerHTML = statusHtml;
  statusEl.classList.remove("hidden");

  // Auto-fill selector (only if currently empty)
  if (!selectorField.value.trim()) {
    selectorField.value = site.selector;
  }
  selectorHelpEl.textContent = "This selector was auto-filled for the known site. You can modify it if needed.";
}

/**
 * @description Sync the site dropdown to match a site config object.
 * Finds the site in the cached scraperSites array by name and selects it.
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
 * @description Get the display name for an investment type by its short description.
 * @param {string} typeShort - The short description (e.g. "SHARE")
 * @param {string} typeDescription - The full description (e.g. "Shares")
 * @returns {string} Display string
 */
function getTypeDisplayName(typeShort, typeDescription) {
  if (!typeDescription) return typeShort || "";
  return typeDescription;
}

/**
 * @description Load and display all investments in the table.
 */
async function loadInvestments() {
  const container = document.getElementById("investments-table-container");

  const result = await apiRequest("/api/investments");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load investments</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    return;
  }

  const investments = result.data;
  cachedInvestments = investments;

  if (investments.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No investments yet. Click "Add Investment" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Type</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Public ID</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">URL</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Selector</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    // Truncate URL for display if it's very long
    const urlDisplay = inv.investment_url ? (inv.investment_url.length > 40 ? inv.investment_url.substring(0, 40) + "..." : inv.investment_url) : "";

    // Truncate selector for display if it's very long
    const selectorDisplay = inv.selector ? (inv.selector.length > 30 ? inv.selector.substring(0, 30) + "..." : inv.selector) : "";

    html += '<tr data-id="' + inv.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors cursor-pointer" ondblclick="viewInvestment(' + inv.id + ')">';
    const manualBadge = inv.auto_scrape === 0 ? ' <span class="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Manually Priced</span>' : "";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.description) + manualBadge + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(getTypeDisplayName(inv.type_short, inv.type_description)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.currency_code) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(inv.public_id || "—") + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500">' + escapeHtml(urlDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(selectorDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-base flex gap-2">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="viewInvestment(' + inv.id + ')">View</button>';
    // Show Test and Load/Replace History buttons if scrapeable (has URL or public_id)
    if (inv.investment_url || inv.public_id) {
      const hasHistory = investmentHasHistory(inv);
      const loadBtnLabel = hasHistory ? "Replace History" : "Load History";
      html += '<button id="test-btn-' + inv.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="testScrapeInvestment(' + inv.id + ', this)">Test</button>';
      html += '<button id="load-btn-' + inv.id + '" class="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-medium px-2 py-1 rounded transition-colors whitespace-nowrap" onclick="loadHistoryInvestment(' + inv.id + ", this, '" + escapeHtml(inv.description).replace(/'/g, "\\'") + "')\">" + loadBtnLabel + "</button>";
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
 * @param {number} id - The investment ID whose row to highlight
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
 * @description Show a read-only view of an investment's details.
 * Triggered by double-clicking a table row or clicking the View button.
 * @param {number} id - The investment ID to view
 */
async function viewInvestment(id) {
  const result = await apiRequest("/api/investments/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load investment", result.detail || result.error);
    return;
  }

  const inv = result.data;

  // Find the display names for type and currency
  const typeDisplay = getTypeDisplayName(inv.type_short, inv.type_description);
  const currencyDisplay = inv.currency_code + " — " + inv.currency_description;

  document.getElementById("view-description").textContent = inv.description;
  document.getElementById("view-type").textContent = typeDisplay;
  document.getElementById("view-currency").textContent = currencyDisplay;
  document.getElementById("view-public-id").textContent = inv.public_id || "—";
  document.getElementById("view-url").textContent = inv.investment_url || "—";
  document.getElementById("view-selector").textContent = inv.selector || "—";

  // Reset price history toggle
  const priceCheckbox = document.getElementById("view-show-prices");
  priceCheckbox.checked = false;
  document.getElementById("view-prices-container").classList.add("hidden");
  document.getElementById("view-prices-container").innerHTML = "";
  priceCheckbox.onchange = function () {
    toggleViewPrices(inv.id);
  };

  // Wire the Edit button to switch to edit mode for this investment
  const editBtn = document.getElementById("view-edit-btn");
  editBtn.onclick = function () {
    hideView();
    editInvestment(inv.id);
  };

  // Highlight the corresponding table row
  highlightRow(inv.id);

  // Hide the form if it's open, show the view modal
  document.getElementById("investment-form-container").classList.add("hidden");
  document.getElementById("investment-view-container").classList.remove("hidden");
}

/**
 * @description Hide the read-only view modal.
 */
function hideView() {
  document.getElementById("investment-view-container").classList.add("hidden");
  clearRowHighlight();
}

/**
 * @description Toggle the price history display in the view modal.
 * Fetches prices from the API on first show, then toggles visibility.
 * @param {number} investmentId - The investment ID to fetch prices for
 */
/**
 * @description Load and display price history for an investment.
 * Fetches a page of prices and renders them in a scrollable table.
 * Supports "Load more" pagination to fetch additional rows.
 * @param {number} investmentId - The investment ID
 * @param {boolean} [append=false] - If true, append rows to existing table
 */
async function toggleViewPrices(investmentId, append) {
  const container = document.getElementById("view-prices-container");
  const checkbox = document.getElementById("view-show-prices");
  const PAGE_SIZE = 100;

  if (!append && !checkbox.checked) {
    container.classList.add("hidden");
    return;
  }

  // Work out the current offset from rows already loaded
  const existingRows = append ? container.querySelectorAll("tbody tr").length : 0;

  if (!append) {
    container.classList.remove("hidden");
    container.innerHTML = '<p class="text-sm text-brand-500">Loading prices...</p>';
  }

  const result = await apiRequest("/api/investments/" + investmentId + "/prices?limit=" + PAGE_SIZE + "&offset=" + existingRows);

  if (!result.ok) {
    if (!append) {
      container.innerHTML = '<p class="text-sm text-error">Failed to load prices.</p>';
    }
    return;
  }

  const prices = result.data.prices;
  const totalCount = result.data.totalCount;

  if (!append && prices.length === 0) {
    container.innerHTML = '<p class="text-sm text-brand-500">No prices recorded.</p>';
    return;
  }

  if (append) {
    // Append rows to the existing table body
    const tbody = container.querySelector("tbody");
    for (let i = 0; i < prices.length; i++) {
      const rowIndex = existingRows + i;
      const rowClass = rowIndex % 2 === 0 ? "bg-white" : "bg-brand-50";
      tbody.insertAdjacentHTML("beforeend",
        '<tr class="' + rowClass + ' border-b border-brand-100">' +
        '<td class="py-1 px-2 text-xs font-mono">' + escapeHtml(prices[i].price_date) + "</td>" +
        '<td class="py-1 px-2 text-xs font-mono text-right">' + escapeHtml(String(prices[i].price.toFixed(2))) + "</td>" +
        "</tr>"
      );
    }

    // Update count display and Load more button
    const loadedCount = existingRows + prices.length;
    container.querySelector("[data-count]").textContent = totalCount + " price" + (totalCount !== 1 ? "s" : "") + " recorded (showing " + loadedCount + ")";
    const moreBtn = container.querySelector("[data-load-more]");
    if (loadedCount >= totalCount) {
      if (moreBtn) moreBtn.remove();
    }
    return;
  }

  // Build the initial table
  const loadedCount = prices.length;
  let html = '<p class="text-xs text-brand-500 mb-1" data-count>' + totalCount + " price" + (totalCount !== 1 ? "s" : "") + " recorded" + (loadedCount < totalCount ? " (showing " + loadedCount + ")" : "") + "</p>";
  html += '<div class="max-h-[16rem] overflow-y-auto border border-brand-200 rounded">';
  html += '<table class="w-full text-left border-collapse">';
  html += '<thead class="sticky top-0 bg-brand-100"><tr>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700">Date</th>';
  html += '<th class="py-1 px-2 text-xs font-semibold text-brand-700 text-right">Price (pence)</th>';
  html += '</tr></thead><tbody>';

  for (let i = 0; i < prices.length; i++) {
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-xs font-mono">' + escapeHtml(prices[i].price_date) + "</td>";
    html += '<td class="py-1 px-2 text-xs font-mono text-right">' + escapeHtml(String(prices[i].price.toFixed(2))) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";

  if (loadedCount < totalCount) {
    html += '<button type="button" data-load-more class="text-xs text-brand-600 hover:text-brand-800 mt-1 underline">Load more</button>';
  }

  container.innerHTML = html;

  // Wire Load more button
  const moreBtn = container.querySelector("[data-load-more]");
  if (moreBtn) {
    moreBtn.addEventListener("click", function () {
      toggleViewPrices(investmentId, true);
    });
  }
}

/**
 * @description Show the add investment form modal (empty fields).
 */
function showAddForm() {
  document.getElementById("form-title").textContent = "Add Investment";
  document.getElementById("investment-id").value = "";
  document.getElementById("investment-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  populateTypeDropdown();
  populateCurrencyDropdown();
  clearRowHighlight();
  // Reset public ID status
  document.getElementById("public-id-status").classList.add("hidden");
  // Reset URL site status and site dropdown
  document.getElementById("url-site-status").classList.add("hidden");
  document.getElementById("selector-optional").classList.add("hidden");
  document.getElementById("site-select").value = "";
  matchedSiteConfig = null;
  // Hide manual price section (not applicable when adding new investments)
  document.getElementById("manual-price-section").classList.add("hidden");
  document.getElementById("manual-price-input").value = "";
  document.getElementById("manual-price-messages").innerHTML = "";
  document.getElementById("investment-view-container").classList.add("hidden");
  document.getElementById("investment-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Load an investment's data into the form modal for editing.
 * @param {number} id - The investment ID to edit
 */
async function editInvestment(id) {
  const result = await apiRequest("/api/investments/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load investment for editing", result.detail || result.error);
    return;
  }

  const inv = result.data;
  document.getElementById("form-title").textContent = "Edit Investment";
  document.getElementById("investment-id").value = inv.id;
  document.getElementById("description").value = inv.description;
  populateTypeDropdown(inv.investment_type_id);
  populateCurrencyDropdown(inv.currencies_id);
  document.getElementById("public_id").value = inv.public_id || "";
  document.getElementById("investment_url").value = inv.investment_url || "";
  document.getElementById("selector").value = inv.selector || "";
  document.getElementById("auto-scrape").checked = inv.auto_scrape !== 0;
  document.getElementById("form-errors").textContent = "";

  // Check public ID format and show status
  checkPublicIdFormat(inv.public_id || "");

  // Check URL against known sites
  if (inv.investment_url) {
    checkUrlSiteMatch(inv.investment_url);
  } else {
    document.getElementById("url-site-status").classList.add("hidden");
    document.getElementById("selector-optional").classList.add("hidden");
    matchedSiteConfig = null;
  }

  // Show the delete link when editing
  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDeleteInvestment(inv.id, inv.description);
  };

  // Highlight the corresponding table row
  highlightRow(inv.id);

  // Show/hide manual price section based on auto_scrape state
  toggleManualPriceSection();

  document.getElementById("investment-view-container").classList.add("hidden");
  document.getElementById("investment-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("description").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  document.getElementById("investment-form-container").classList.add("hidden");
  document.getElementById("manual-price-section").classList.add("hidden");
  document.getElementById("manual-price-input").value = "";
  document.getElementById("manual-price-messages").innerHTML = "";
  clearRowHighlight();
}

/**
 * @description Handle form submission for creating or updating an investment.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const investmentId = document.getElementById("investment-id").value;
  const isEditing = investmentId !== "";

  const data = {
    description: document.getElementById("description").value.trim(),
    investment_type_id: document.getElementById("investment_type_id").value || null,
    currencies_id: document.getElementById("currencies_id").value || null,
    public_id: document.getElementById("public_id").value.trim().toUpperCase() || null,
    investment_url: document.getElementById("investment_url").value.trim() || null,
    selector: document.getElementById("selector").value.trim() || null,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/investments/" + investmentId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/investments", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    // Update auto_scrape flag separately
    const autoScrapeChecked = document.getElementById("auto-scrape").checked;
    const savedId = isEditing ? investmentId : result.data.id;
    if (savedId) {
      await fetch("/api/investments/" + savedId + "/auto-scrape", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoScrape: autoScrapeChecked }),
      });
    }

    hideForm();
    await loadInvestments();
    showSuccess("page-messages", isEditing ? "Investment updated successfully" : "Investment added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The investment ID to delete
 * @param {string} name - The investment description for the confirmation message
 */
function confirmDeleteInvestment(id, name) {
  deleteInvestmentId = id;
  deleteInvestmentName = name;
  document.getElementById("delete-investment-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteInvestmentId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the investment deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteInvestmentId) return;

  const result = await apiRequest("/api/investments/" + deleteInvestmentId, {
    method: "DELETE",
  });

  hideDeleteDialog();

  if (result.ok) {
    hideForm();
    await loadInvestments();
    showSuccess("page-messages", "Investment deleted successfully");
  } else {
    // Show error on the edit form rather than closing it
    document.getElementById("form-errors").textContent = result.detail || result.error;
  }
}

/**
 * @description Build an HTML table from historic backfill preview rows.
 * @param {Array<{date: string, price: number}>} rows - The preview rows (most recent first)
 * @param {string} valueLabel - Column header for the value (e.g. "Price", "Rate")
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
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-1 px-2 text-sm">' + escapeHtml(rows[i].date) + "</td>";
    const displayPrice = typeof rows[i].price === "number" ? rows[i].price.toFixed(4) : String(rows[i].price);
    html += '<td class="py-1 px-2 text-sm text-right font-mono">' + escapeHtml(displayPrice) + "</td>";
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
 * @description Build the result HTML for a live scrape result.
 * @param {Object} scrapeResult - The result from apiRequest
 * @returns {string} HTML string
 */
function buildScrapeResultHtml(scrapeResult) {
  if (scrapeResult.ok && scrapeResult.data.price) {
    const price = scrapeResult.data.price;
    if (price.success) {
      return '<div class="bg-green-50 border border-green-200 rounded p-3 text-sm">' + "<p><strong>Investment:</strong> " + escapeHtml(price.description) + "</p>" + "<p><strong>Currency:</strong> " + escapeHtml(price.currency) + "</p>" + "<p><strong>Raw price:</strong> " + escapeHtml(price.rawPrice) + "</p>" + "<p><strong>Parsed (minor unit):</strong> " + escapeHtml(String(price.priceMinorUnit)) + "</p>" + "</div>";
    } else {
      return '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">' + "<p><strong>Investment:</strong> " + escapeHtml(price.description) + "</p>" + "<p><strong>Error:</strong> " + escapeHtml(price.error) + "</p>" + "</div>";
    }
  } else if (scrapeResult.data && scrapeResult.data.price) {
    const price = scrapeResult.data.price;
    return '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">' + "<p><strong>Investment:</strong> " + escapeHtml(price.description) + "</p>" + "<p><strong>Error:</strong> " + escapeHtml(price.error) + "</p>" + "</div>";
  } else {
    let html = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm">';
    html += "<p>" + escapeHtml(scrapeResult.error || "Unknown error") + "</p>";
    if (scrapeResult.detail) {
      html += "<p>" + escapeHtml(scrapeResult.detail) + "</p>";
    }
    html += "</div>";
    return html;
  }
}

/**
 * @description Build the result HTML for a historic data preview.
 * @param {Object} historyResult - The result from apiRequest
 * @returns {string} HTML string
 */
function buildHistoryResultHtml(historyResult) {
  if (historyResult.ok && historyResult.data.success) {
    return '<p class="text-sm text-brand-600 mb-1">' + escapeHtml(historyResult.data.description) + " (" + escapeHtml(historyResult.data.currency) + ")</p>" + buildHistoricPreviewTable(historyResult.data.rows, "Price");
  } else if (historyResult.data && historyResult.data.error) {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>" + escapeHtml(historyResult.data.error) + "</p>" + "</div>";
  } else {
    return '<div class="bg-amber-50 border border-amber-200 rounded p-3 text-sm">' + "<p>Could not fetch historic preview.</p>" + "</div>";
  }
}

/**
 * @description Test scrape a single investment by ID.
 * Shows a modal immediately with spinners, then progressively updates
 * each section as the live scrape and historic preview results arrive.
 * Uses testMode=true so no database tables are updated.
 * @param {number} id - The investment ID to scrape
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testScrapeInvestment(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Testing...";

  // Show modal immediately with spinners for both sections
  const initialHtml = '<h4 class="text-base font-semibold text-brand-800 mb-2">Live Scrape Result</h4>' + '<div id="test-scrape-result">' + buildSpinner("Fetching live price...") + "</div>" + '<h4 class="text-base font-semibold text-brand-800 mt-4 mb-2">Historic Data Preview (Morningstar)</h4>' + '<div id="test-history-result">' + buildSpinner("Fetching historic data...") + "</div>";

  showModalHtml("Test Result (No DB Update)", initialHtml);

  // Fire both requests in parallel, update each section as it completes
  const scrapePromise = apiRequest("/api/scraper/prices/" + id + "?testMode=true", {
    method: "POST",
    timeout: 120000,
  })
    .then(function (result) {
      const el = document.getElementById("test-scrape-result");
      if (el) el.innerHTML = buildScrapeResultHtml(result);
    })
    .catch(function (err) {
      const el = document.getElementById("test-scrape-result");
      if (el) el.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-3 text-sm"><p>' + escapeHtml(err.message) + "</p></div>";
    });

  const historyPromise = apiRequest("/api/backfill/test/investment/" + id, {
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
  await Promise.all([scrapePromise, historyPromise]);

  button.disabled = false;
  button.textContent = originalText;
}

/**
 * @description Determine if an investment has existing price history (older than 6 days).
 * An investment "has history" if it was loaded during this session, or if its
 * oldest_price_date is at least 7 days before today (indicating backfill data
 * rather than just recent live-scraped prices).
 * @param {Object} inv - The investment object from the API (must have oldest_price_date)
 * @returns {boolean} True if history exists
 */
function investmentHasHistory(inv) {
  if (loadedInSession.has(inv.id)) {
    return true;
  }

  if (!inv.oldest_price_date) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return inv.oldest_price_date <= cutoffStr;
}

/**
 * @description Check if an investment has history by its ID, using cached data
 * and session state.
 * @param {number} id - The investment ID
 * @returns {boolean} True if the investment has existing history
 */
function investmentHasHistoryById(id) {
  if (loadedInSession.has(id)) return true;
  const inv = cachedInvestments.find(function (i) { return i.id === id; });
  return inv ? investmentHasHistory(inv) : false;
}

/**
 * @description Load historic prices for a single investment.
 * If the investment already has price history, shows a confirmation dialog
 * before proceeding. Otherwise proceeds directly with the load.
 * @param {number} id - The investment ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} name - The investment description for the confirmation message
 */
async function loadHistoryInvestment(id, button, name) {
  const hasHistory = investmentHasHistoryById(id);

  if (hasHistory) {
    // Show confirmation dialog instead of proceeding directly
    replaceHistoryId = id;
    replaceHistoryName = name;
    replaceHistoryButton = button;
    document.getElementById("replace-history-name").textContent = name;
    document.getElementById("replace-history-dialog").classList.remove("hidden");
    // Focus the "No" button as the safe default
    document.getElementById("replace-history-no-btn").focus();
    return;
  }

  // No existing history — proceed directly
  await executeLoadHistory(id, button, name);
}

/**
 * @description Execute the actual history load for an investment.
 * Called directly for first-time loads, or after confirmation for replacements.
 * @param {number} id - The investment ID
 * @param {HTMLElement} button - The button element that was clicked
 * @param {string} name - The investment description
 */
async function executeLoadHistory(id, button, name) {
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const result = await apiRequest("/api/backfill/load/investment/" + id, {
      method: "POST",
      timeout: 120000,
    });

    button.disabled = false;

    if (result.ok && result.data.success) {
      loadHistoryCounts[id] = (loadHistoryCounts[id] || 0) + 1;
      loadedInSession.add(id);
      // Update button text to "Replace History" since it now has history
      button.textContent = "Replace History";
      updateLoadBadge(id);
      showModal("History Loaded", "Investment: " + result.data.description + "\nPrices loaded: " + result.data.count);
    } else {
      button.textContent = investmentHasHistoryById(id) ? "Replace History" : "Load History";
      updateLoadBadge(id);
      const errorMsg = (result.data && result.data.error) || result.error || "Unknown error";
      const desc = (result.data && result.data.description) || name;
      showModal("Load Failed", "Investment: " + desc + "\nError: " + errorMsg);
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = investmentHasHistoryById(id) ? "Replace History" : "Load History";
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
 * @description Update the Load/Replace History button badge for an investment.
 * Shows a small count badge after the button text if the count is > 0.
 * Uses the correct label based on whether history exists.
 * @param {number} id - The investment ID
 */
function updateLoadBadge(id) {
  const btn = document.getElementById("load-btn-" + id);
  if (!btn) return;
  const count = loadHistoryCounts[id] || 0;
  const label = investmentHasHistoryById(id) ? "Replace History" : "Load History";
  if (count > 0) {
    btn.innerHTML = label + " " + '<span class="inline-flex items-center justify-center bg-blue-600 text-white font-bold rounded-full w-5 h-5 ml-1 text-xs">' + count + "</span>";
  }
}

/**
 * @description Show or hide the manual price entry section based on the
 * auto-scrape checkbox state and whether an investment is being edited.
 * Only shown when editing an existing investment with auto_scrape unchecked.
 */
function toggleManualPriceSection() {
  const section = document.getElementById("manual-price-section");
  const autoScrapeChecked = document.getElementById("auto-scrape").checked;
  const investmentId = document.getElementById("investment-id").value;

  if (!autoScrapeChecked && investmentId) {
    section.classList.remove("hidden");
    loadLatestPriceForEdit(investmentId);
  } else {
    section.classList.add("hidden");
  }
}

/**
 * @description Fetch and display the latest price for an investment in the
 * manual price entry section of the edit form.
 * @param {number|string} investmentId - The investment ID
 */
async function loadLatestPriceForEdit(investmentId) {
  const lastPriceEl = document.getElementById("manual-price-last");
  lastPriceEl.textContent = "Loading last price...";

  const result = await apiRequest("/api/investments/" + investmentId + "/latest-price");

  if (!result.ok) {
    lastPriceEl.textContent = "Could not load last price.";
    return;
  }

  const data = result.data;
  if (data.price !== null) {
    lastPriceEl.textContent = "Last price: " + data.price.toFixed(2) + "p (" + data.currencyCode + ") on " + data.priceDate;
  } else {
    lastPriceEl.textContent = "No previous price recorded for this investment.";
  }
}

/**
 * @description Save a manually entered price for the currently edited investment.
 * Calls POST /api/investments/manual-price with the investment ID and price value.
 */
async function handleSaveManualPrice() {
  const investmentId = document.getElementById("investment-id").value;
  const input = document.getElementById("manual-price-input");
  const messagesDiv = document.getElementById("manual-price-messages");

  if (!investmentId) return;

  const priceValue = parseFloat(input.value);
  if (isNaN(priceValue) || priceValue < 0) {
    messagesDiv.innerHTML = '<p class="text-sm text-error">Please enter a valid price in pence (e.g. 1234.56)</p>';
    return;
  }

  const btn = document.getElementById("save-manual-price-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  const result = await apiRequest("/api/investments/manual-price", {
    method: "POST",
    body: { investmentId: Number(investmentId), price: priceValue },
  });

  btn.disabled = false;
  btn.textContent = "Save Price";

  if (result.ok) {
    messagesDiv.innerHTML = '<p class="text-sm text-success">' + escapeHtml(result.data.message) + "</p>";
    input.value = "";
    // Refresh the "Last price" display
    loadLatestPriceForEdit(investmentId);
    // Auto-clear success message after 5 seconds
    setTimeout(function () {
      messagesDiv.innerHTML = "";
    }, 5000);
  } else {
    messagesDiv.innerHTML = '<p class="text-sm text-error">' + escapeHtml(result.error || "Failed to save price") + "</p>";
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadInvestmentTypes();
  await loadCurrencies();
  await loadScraperSites();
  await loadInvestments();

  document.getElementById("add-investment-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("investment-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("view-close-btn").addEventListener("click", hideView);
  document.getElementById("replace-history-no-btn").addEventListener("click", hideReplaceHistoryDialog);
  document.getElementById("replace-history-yes-btn").addEventListener("click", confirmReplaceHistory);

  // Check public ID format when it changes (debounced)
  let publicIdCheckTimeout = null;
  document.getElementById("public_id").addEventListener("input", function (event) {
    if (publicIdCheckTimeout) {
      clearTimeout(publicIdCheckTimeout);
    }
    publicIdCheckTimeout = setTimeout(function () {
      checkPublicIdFormat(event.target.value);
    }, 500);
  });

  // Check URL against known sites when it changes (debounced)
  let urlCheckTimeout = null;
  document.getElementById("investment_url").addEventListener("input", function (event) {
    if (urlCheckTimeout) {
      clearTimeout(urlCheckTimeout);
    }
    urlCheckTimeout = setTimeout(function () {
      checkUrlSiteMatch(event.target.value);
    }, 500);
  });

  // Handle known site dropdown selection
  document.getElementById("site-select").addEventListener("change", handleSiteSelect);

  // Show/hide manual price section based on auto-scrape checkbox
  document.getElementById("auto-scrape").addEventListener("change", function () {
    toggleManualPriceSection();
  });

  // Wire the Save Price button
  document.getElementById("save-manual-price-btn").addEventListener("click", handleSaveManualPrice);

  // Close modals when clicking on the backdrop (outside the modal content)
  document.getElementById("investment-form-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideForm();
    }
  });

  document.getElementById("investment-view-container").addEventListener("click", function (event) {
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
      const formContainer = document.getElementById("investment-form-container");
      const viewContainer = document.getElementById("investment-view-container");

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
