/**
 * @description Currencies page logic for Portfolio 60.
 * Handles listing, viewing, adding, editing, and deleting currencies.
 * GBP is the base currency and cannot be deleted.
 */

/** @type {number|null} ID of the currency pending deletion */
let deleteCurrencyId = null;

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
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="viewCurrency(' + cur.id + ')">View</button>';
    if (!isGbp) {
      html += '<button id="test-btn-' + cur.id + '" class="bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="testScrapeCurrency(' + cur.id + ', this)">Test</button>';
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
 * @description Test fetch the exchange rate for a single currency.
 * Shows the result in a modal dialog for quick debugging.
 * Uses testMode=true so no database tables are updated.
 * @param {number} id - The currency ID to test
 * @param {HTMLElement} button - The button element that was clicked
 */
async function testScrapeCurrency(id, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "...";

  try {
    // Fetch all currency rates in test mode (no database writes)
    // Use 60s timeout - currency API is usually fast but allow extra time
    const result = await apiRequest("/api/scraper/currency-rates?testMode=true", {
      method: "POST",
      timeout: 60000,
    });

    button.disabled = false;
    button.textContent = originalText;

    if (result.ok && result.data.rates) {
      // Find the rate for this currency
      const rates = result.data.rates;
      // We need to get the currency code first
      const currencyResult = await apiRequest("/api/currencies/" + id);
      if (currencyResult.ok) {
        const currencyCode = currencyResult.data.code;
        const rate = rates.find(function (r) {
          return r.code === currencyCode;
        });
        if (rate) {
          showModal("Test Result (No DB Update)", "Currency: " + rate.code + " - " + rate.description + "\nRate (per 1 GBP): " + rate.rate.toFixed(4) + "\nDate: " + rate.rateDate, { type: "success" });
        } else {
          showModal("Test Result", "No rate found for " + currencyCode + " in API response.\n\nThis may mean the currency is not supported by the Frankfurter API.", { type: "error" });
        }
      } else {
        showModal("Error", "Failed to get currency details: " + (currencyResult.error || "Unknown error"), { type: "error" });
      }
    } else {
      showModal("API Error", (result.error || "Unknown error") + "\n" + (result.detail || ""), { type: "error" });
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = originalText;
    showModal("Network Error", err.message, { type: "error" });
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

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const formContainer = document.getElementById("currency-form-container");
      const viewContainer = document.getElementById("currency-view-container");
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
