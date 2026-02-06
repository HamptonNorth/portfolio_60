/**
 * @description Investments page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting investments.
 */

/** @type {number|null} ID of the investment pending deletion */
let deleteInvestmentId = null;

/** @type {string} Name of the investment pending deletion (for confirmation dialog) */
let deleteInvestmentName = "";

/** @type {Array<{id: number, short_description: string, description: string, usage_notes: string|null}>} Cached investment types */
let investmentTypes = [];

/** @type {Array<{id: number, code: string, description: string}>} Cached currencies */
let currencies = [];

/** @type {Object|null} Currently matched site config from URL */
let matchedSiteConfig = null;

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
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-green-50 border border-green-200 text-green-700";
    statusEl.innerHTML = "<strong>Known site:</strong> " + escapeHtml(matchedSiteConfig.name) + ". Default selector filled in below.";
    statusEl.classList.remove("hidden");
    selectorOptionalEl.classList.add("hidden");
    selectorHelpEl.textContent = "This selector was auto-filled for the known site. You can modify it if needed.";
    // Auto-fill the selector field with the config value (only if currently empty)
    const selectorField = document.getElementById("selector");
    if (!selectorField.value.trim()) {
      selectorField.value = matchedSiteConfig.selector;
    }
  } else {
    statusEl.className = "mt-2 px-3 py-2 rounded-md text-sm bg-amber-50 border border-amber-200 text-amber-700";
    statusEl.innerHTML = "URL does not match a known site. You will need to provide a CSS selector.";
    statusEl.classList.remove("hidden");
    selectorOptionalEl.classList.add("hidden");
    selectorHelpEl.textContent = "To find the CSS selector: right-click the price on the web page, choose 'Inspect', then right-click the highlighted element and choose 'Copy > Copy selector'.";
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
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.description) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(getTypeDisplayName(inv.type_short, inv.type_description)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.currency_code) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500">' + escapeHtml(urlDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(selectorDisplay) + "</td>";
    html += '<td class="py-3 px-3 text-base flex gap-2">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="viewInvestment(' + inv.id + ')">View</button>';
    // Show Test button if URL exists (selector may come from config for known sites)
    if (inv.investment_url) {
      html += '<button id="test-btn-' + inv.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="testScrapeInvestment(' + inv.id + ', this)">Test</button>';
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
  document.getElementById("view-url").textContent = inv.investment_url || "—";
  document.getElementById("view-selector").textContent = inv.selector || "—";

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
  // Reset URL site status
  document.getElementById("url-site-status").classList.add("hidden");
  document.getElementById("selector-optional").classList.add("hidden");
  matchedSiteConfig = null;
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
  document.getElementById("investment_url").value = inv.investment_url || "";
  document.getElementById("selector").value = inv.selector || "";
  document.getElementById("form-errors").textContent = "";

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
  hideForm();

  if (result.ok) {
    await loadInvestments();
    showSuccess("page-messages", "Investment deleted successfully");
  } else {
    showError("page-messages", "Failed to delete investment", result.detail || result.error);
  }
}

/**
 * @description Test scrape a single investment by ID.
 * Shows the result in a modal dialog for quick debugging.
 * Uses testMode=true so no database tables are updated.
 * @param {number} id - The investment ID to scrape
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testScrapeInvestment(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Scraping...";

  try {
    // Use 120s timeout for scraping - some sites take a long time
    const result = await apiRequest("/api/scraper/prices/" + id + "?testMode=true", {
      method: "POST",
      timeout: 120000,
    });

    button.disabled = false;
    button.textContent = originalText;

    if (result.ok && result.data.price) {
      const price = result.data.price;
      if (price.success) {
        showModal("Test Result (No DB Update)", "Investment: " + price.description + "\nCurrency: " + price.currency + "\nRaw price: " + price.rawPrice + "\nParsed (minor unit): " + price.priceMinorUnit);
      } else {
        showModal("Scrape Failed", "Investment: " + price.description + "\nError: " + price.error);
      }
    } else if (result.data && result.data.price) {
      // API returned error but still has price object
      const price = result.data.price;
      showModal("Scrape Failed", "Investment: " + price.description + "\nError: " + price.error);
    } else {
      showModal("API Error", (result.error || "Unknown error") + "\n" + (result.detail || ""));
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = originalText;
    showModal("Network Error", err.message);
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadInvestmentTypes();
  await loadCurrencies();
  await loadInvestments();

  document.getElementById("add-investment-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("investment-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("view-close-btn").addEventListener("click", hideView);

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

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const formContainer = document.getElementById("investment-form-container");
      const viewContainer = document.getElementById("investment-view-container");
      const deleteDialog = document.getElementById("delete-dialog");

      if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      } else if (!viewContainer.classList.contains("hidden")) {
        hideView();
      }
    }
  });
});
