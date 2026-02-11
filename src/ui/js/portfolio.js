/**
 * @description Portfolio page logic for Portfolio 60.
 * Handles two views: accounts list (per user) and holdings list (per account).
 */

/** @type {Array<Object>} Cached list of users */
let users = [];

/** @type {Array<Object>} Cached list of all investments (for holding dropdown) */
let allInvestments = [];

/** @type {number|null} Currently selected user ID */
let selectedUserId = null;

/** @type {Object|null} Currently selected account (for holdings view) */
let selectedAccount = null;

/** @type {Array<Object>} Current holdings for the selected account */
let currentHoldings = [];

/** @type {Object|null} Pending delete info: { type: 'account'|'holding', id, name } */
let pendingDelete = null;

// ─── Formatting helpers ──────────────────────────────────────────────

/**
 * @description Format a number as GBP currency string.
 * Whole numbers show no decimals; fractional amounts show 2 decimal places.
 * @param {number} amount - The amount to format
 * @returns {string} Formatted string like "£1,234" or "£1,234.56"
 */
function formatGBP(amount) {
  if (amount === 0) return "£0";
  const isWhole = Math.abs(amount - Math.round(amount)) < 0.005;
  if (isWhole) {
    return "£" + Math.round(amount).toLocaleString("en-GB");
  }
  return "£" + amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @description Format account type for display (uppercase).
 * @param {string} type - Account type ('trading', 'isa', 'sipp')
 * @returns {string} Display string like "TRADING", "ISA", "SIPP"
 */
function formatAccountType(type) {
  return type.toUpperCase();
}

// ─── Users loading ───────────────────────────────────────────────────

/**
 * @description Load the list of users and populate the user dropdown.
 */
async function loadUsers() {
  const result = await apiRequest("/api/users");
  if (result.ok) {
    users = result.data;
  }
  populateUserDropdown();
}

/**
 * @description Populate the user dropdown with loaded users.
 */
function populateUserDropdown() {
  const select = document.getElementById("user-select");
  select.innerHTML = '<option value="">Select a user...</option>';

  for (const user of users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.first_name + " " + user.last_name;
    if (selectedUserId && user.id === selectedUserId) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

// ─── Accounts view ───────────────────────────────────────────────────

/**
 * @description Handle user selection change — load their accounts.
 */
async function onUserSelected() {
  const select = document.getElementById("user-select");
  const userId = Number(select.value);

  if (!userId) {
    selectedUserId = null;
    document.getElementById("add-account-btn").classList.add("hidden");
    document.getElementById("accounts-table-container").innerHTML = '<p class="text-brand-500">Select a user to view their accounts.</p>';
    return;
  }

  selectedUserId = userId;
  document.getElementById("add-account-btn").classList.remove("hidden");
  await loadAccounts();
}

/**
 * @description Load and display accounts for the selected user.
 */
async function loadAccounts() {
  if (!selectedUserId) return;

  const container = document.getElementById("accounts-table-container");
  const result = await apiRequest("/api/users/" + selectedUserId + "/accounts");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load accounts</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p></div>";
    return;
  }

  const accounts = result.data;

  if (accounts.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No accounts yet. Click "Add Account" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Account Type</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Account Reference</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-center">Holdings</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Cash Balance</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Warning Threshold</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < accounts.length; i++) {
    const acct = accounts[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const warnClass = acct.warn_cash > 0 && acct.cash_balance < acct.warn_cash ? " text-red-600 font-semibold" : "";

    html += '<tr class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors">';
    html += '<td class="py-3 px-3 text-base font-medium">' + escapeHtml(formatAccountType(acct.account_type)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(acct.account_ref) + "</td>";
    html += '<td class="py-3 px-3 text-base text-center">' + (acct.holdings_count || 0) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right' + warnClass + '">' + escapeHtml(formatGBP(acct.cash_balance)) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right">' + (acct.warn_cash > 0 ? escapeHtml(formatGBP(acct.warn_cash)) : "") + "</td>";
    html += '<td class="py-3 px-3 text-base text-right">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors mr-2" onclick="editAccount(' + acct.id + ')">Edit</button>';
    html += '<button class="bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 py-1 rounded transition-colors" onclick="viewHoldings(' + acct.id + ')">Holdings</button>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Show the add account form. Only shows account types not already used.
 */
async function showAddAccountForm() {
  document.getElementById("account-form-title").textContent = "Add Account";
  document.getElementById("account-id").value = "";
  document.getElementById("account-form").reset();
  document.getElementById("account-form-errors").textContent = "";
  document.getElementById("account-delete-btn").classList.add("hidden");

  // Disable account types already in use
  await filterAvailableAccountTypes();

  // Enable the type dropdown for new accounts
  document.getElementById("account-type").disabled = false;

  document.getElementById("account-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("account-type").focus();
  }, 50);
}

/**
 * @description Filter the account type dropdown to only show types not yet used.
 */
async function filterAvailableAccountTypes() {
  const select = document.getElementById("account-type");
  const options = select.querySelectorAll("option");

  // Re-enable all options first
  options.forEach(function (opt) {
    opt.disabled = false;
    opt.classList.remove("text-brand-300");
  });

  // Get existing account types for this user
  const result = await apiRequest("/api/users/" + selectedUserId + "/accounts");
  if (!result.ok) return;

  const existingTypes = result.data.map(function (a) {
    return a.account_type;
  });

  options.forEach(function (opt) {
    if (opt.value && existingTypes.includes(opt.value)) {
      opt.disabled = true;
      opt.classList.add("text-brand-300");
    }
  });
}

/**
 * @description Load an account into the form for editing.
 * @param {number} id - The account ID to edit
 */
async function editAccount(id) {
  const result = await apiRequest("/api/accounts/" + id);
  if (!result.ok) {
    showError("page-messages", "Failed to load account", result.detail || result.error);
    return;
  }

  const acct = result.data;
  document.getElementById("account-form-title").textContent = "Edit Account";
  document.getElementById("account-id").value = acct.id;
  document.getElementById("account-type").value = acct.account_type;
  document.getElementById("account-type").disabled = true; // Type cannot be changed
  document.getElementById("account-ref").value = acct.account_ref;
  document.getElementById("cash-balance").value = acct.cash_balance;
  document.getElementById("warn-cash").value = acct.warn_cash || "";
  document.getElementById("account-form-errors").textContent = "";

  const deleteBtn = document.getElementById("account-delete-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDelete("account", acct.id, formatAccountType(acct.account_type) + " account " + acct.account_ref);
  };

  document.getElementById("account-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("account-ref").focus();
  }, 50);
}

/**
 * @description Hide the account form modal.
 */
function hideAccountForm() {
  document.getElementById("account-form-container").classList.add("hidden");
}

/**
 * @description Handle account form submission (create or update).
 * @param {Event} event - The form submit event
 */
async function handleAccountSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("account-form-errors");
  errorsDiv.textContent = "";

  const accountId = document.getElementById("account-id").value;
  const isEditing = accountId !== "";

  const data = {
    account_type: document.getElementById("account-type").value,
    account_ref: document.getElementById("account-ref").value.trim(),
    cash_balance: Number(document.getElementById("cash-balance").value) || 0,
    warn_cash: Number(document.getElementById("warn-cash").value) || 0,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/accounts/" + accountId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/users/" + selectedUserId + "/accounts", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideAccountForm();
    await loadAccounts();
    showSuccess("page-messages", isEditing ? "Account updated successfully" : "Account added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

// ─── Holdings view ───────────────────────────────────────────────────

/**
 * @description Switch to the holdings view for a specific account.
 * @param {number} accountId - The account ID to show holdings for
 */
async function viewHoldings(accountId) {
  const result = await apiRequest("/api/accounts/" + accountId);
  if (!result.ok) {
    showError("page-messages", "Failed to load account", result.detail || result.error);
    return;
  }

  selectedAccount = result.data;

  // Find the user name
  const user = users.find(function (u) {
    return u.id === selectedAccount.user_id;
  });
  const userName = user ? user.first_name + " " + user.last_name : "";

  document.getElementById("holdings-header").textContent = userName + " — " + formatAccountType(selectedAccount.account_type) + " Account " + selectedAccount.account_ref;

  document.getElementById("accounts-view").classList.add("hidden");
  document.getElementById("holdings-view").classList.remove("hidden");

  await loadHoldings();
}

/**
 * @description Switch back to the accounts view.
 */
async function backToAccounts() {
  selectedAccount = null;
  currentHoldings = [];
  document.getElementById("holdings-view").classList.add("hidden");
  document.getElementById("accounts-view").classList.remove("hidden");
  await loadAccounts();
}

/**
 * @description Load and display holdings for the selected account.
 */
async function loadHoldings() {
  if (!selectedAccount) return;

  const container = document.getElementById("holdings-table-container");
  const result = await apiRequest("/api/accounts/" + selectedAccount.id + "/holdings");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load holdings</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p></div>";
    return;
  }

  currentHoldings = result.data;

  if (currentHoldings.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No holdings yet. Click "Add Holding" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Investment</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Quantity</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Average Cost</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < currentHoldings.length; i++) {
    const h = currentHoldings[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const publicIdText = h.investment_public_id ? " (" + h.investment_public_id + ")" : "";

    html += '<tr class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors">';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(h.investment_description) + '<span class="text-brand-400 text-sm">' + escapeHtml(publicIdText) + "</span></td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(h.currency_code) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatQuantity(h.quantity) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatPrice(h.average_cost) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="editHolding(' + h.id + ')">Edit</button>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Format a quantity or price value, stripping trailing zeros.
 * Shows up to 4 decimal places.
 * @param {number} value - The numeric value
 * @returns {string} Formatted string
 */
function formatQuantity(value) {
  if (value === 0) return "0";
  // Use up to 4 decimal places, strip trailing zeros
  let formatted = value.toFixed(4);
  // Remove trailing zeros after decimal point
  formatted = formatted.replace(/\.?0+$/, "");
  return formatted;
}

/**
 * @description Format a price or average cost value, stripping trailing zeros.
 * Shows up to 6 decimal places.
 * @param {number} value - The numeric value
 * @returns {string} Formatted string
 */
function formatPrice(value) {
  if (value === 0) return "0";
  let formatted = value.toFixed(6);
  formatted = formatted.replace(/\.?0+$/, "");
  return formatted;
}

/** @type {Array<Object>} Filtered investments available for the current add/edit */
let availableInvestments = [];

/**
 * Tracks which cost field the user last manually edited: "avg" or "book".
 * Used to determine which field to auto-calculate from the other.
 * @type {string|null}
 */
let lastCostFieldEdited = null;

/**
 * @description Auto-calculate Book Cost Value from Quantity and Average Cost,
 * or Average Cost from Quantity and Book Cost Value, depending on which
 * field was last edited.
 * @param {string} sourceField - Which field triggered the recalculation: "quantity", "avg", or "book"
 */
function recalculateCosts(sourceField) {
  const quantity = Number(document.getElementById("holding-quantity").value) || 0;
  const avgCost = Number(document.getElementById("holding-avg-cost").value) || 0;
  const bookCost = Number(document.getElementById("holding-book-cost").value) || 0;

  if (sourceField === "avg") {
    lastCostFieldEdited = "avg";
  } else if (sourceField === "book") {
    lastCostFieldEdited = "book";
  }

  // If quantity is zero or negative, can't calculate
  if (quantity <= 0) return;

  if (lastCostFieldEdited === "avg" && avgCost > 0) {
    // Calculate book cost from avg cost * quantity
    const calculatedBook = (avgCost * quantity).toFixed(2);
    document.getElementById("holding-book-cost").value = calculatedBook;
  } else if (lastCostFieldEdited === "book" && bookCost > 0) {
    // Calculate avg cost from book cost / quantity
    const calculatedAvg = (bookCost / quantity).toFixed(6);
    document.getElementById("holding-avg-cost").value = calculatedAvg;
  }
}

/**
 * @description Load all investments and show the add holding form.
 * Only shows investments not already held in this account.
 */
async function showAddHoldingForm() {
  document.getElementById("holding-form-title").textContent = "Add Holding";
  document.getElementById("holding-id").value = "";
  document.getElementById("holding-form").reset();
  document.getElementById("holding-book-cost").value = "";
  document.getElementById("holding-form-errors").textContent = "";
  document.getElementById("holding-delete-btn").classList.add("hidden");
  lastCostFieldEdited = null;

  // Clear and enable the search input
  document.getElementById("holding-investment").value = "";
  document.getElementById("holding-investment-search").value = "";
  document.getElementById("holding-investment-search").readOnly = false;
  document.getElementById("holding-investment-list").classList.add("hidden");

  await loadAvailableInvestments();

  document.getElementById("holding-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("holding-investment-search").focus();
  }, 50);
}

/**
 * @description Load investments into the availableInvestments list,
 * excluding those already held in the current account.
 * @param {number|null} [selectedInvestmentId=null] - Always include this investment (for edit mode)
 */
async function loadAvailableInvestments(selectedInvestmentId) {
  // Load all investments if not cached
  if (allInvestments.length === 0) {
    const result = await apiRequest("/api/investments");
    if (result.ok) {
      allInvestments = result.data;
    }
  }

  // Get IDs already held in this account
  const heldIds = currentHoldings.map(function (h) {
    return h.investment_id;
  });

  availableInvestments = [];
  for (const inv of allInvestments) {
    // When editing, always include the current investment; otherwise exclude held ones
    if (selectedInvestmentId !== inv.id && heldIds.includes(inv.id)) {
      continue;
    }
    availableInvestments.push(inv);
  }
}

/**
 * @description Filter and display the investment search results dropdown.
 * Matches against description and public_id, case-insensitive.
 * @param {string} searchText - The text typed by the user
 */
function filterInvestmentList(searchText) {
  const listEl = document.getElementById("holding-investment-list");
  const query = searchText.trim().toLowerCase();

  if (query.length === 0) {
    listEl.classList.add("hidden");
    return;
  }

  const matches = availableInvestments.filter(function (inv) {
    const desc = inv.description.toLowerCase();
    const pubId = (inv.public_id || "").toLowerCase();
    return desc.includes(query) || pubId.includes(query);
  });

  if (matches.length === 0) {
    listEl.innerHTML = '<div class="px-3 py-2 text-brand-400 text-sm">No matching investments</div>';
    listEl.classList.remove("hidden");
    return;
  }

  let html = "";
  for (const inv of matches) {
    const publicIdSuffix = inv.public_id ? " (" + escapeHtml(inv.public_id) + ")" : "";
    html += '<div class="px-3 py-2 hover:bg-brand-100 cursor-pointer text-base transition-colors" data-investment-id="' + inv.id + '">';
    html += escapeHtml(inv.description) + '<span class="text-brand-400 text-sm">' + publicIdSuffix + "</span>";
    html += "</div>";
  }

  listEl.innerHTML = html;
  listEl.classList.remove("hidden");
}

/**
 * @description Handle selection of an investment from the search results list.
 * @param {number} investmentId - The selected investment ID
 */
function selectInvestment(investmentId) {
  const inv = allInvestments.find(function (i) {
    return i.id === investmentId;
  });
  if (!inv) return;

  const publicIdSuffix = inv.public_id ? " (" + inv.public_id + ")" : "";
  document.getElementById("holding-investment").value = inv.id;
  document.getElementById("holding-investment-search").value = inv.description + publicIdSuffix;
  document.getElementById("holding-investment-list").classList.add("hidden");
}

/**
 * @description Load a holding into the form for editing.
 * @param {number} id - The holding ID to edit
 */
async function editHolding(id) {
  const result = await apiRequest("/api/holdings/" + id);
  if (!result.ok) {
    showError("holdings-messages", "Failed to load holding", result.detail || result.error);
    return;
  }

  const h = result.data;
  document.getElementById("holding-form-title").textContent = "Edit Holding";
  document.getElementById("holding-id").value = h.id;

  await loadAvailableInvestments(h.investment_id);
  const publicIdSuffix = h.investment_public_id ? " (" + h.investment_public_id + ")" : "";
  document.getElementById("holding-investment").value = h.investment_id;
  document.getElementById("holding-investment-search").value = h.investment_description + publicIdSuffix;
  document.getElementById("holding-investment-search").readOnly = true; // Investment cannot be changed
  document.getElementById("holding-investment-list").classList.add("hidden");

  document.getElementById("holding-quantity").value = h.quantity;
  document.getElementById("holding-avg-cost").value = h.average_cost;
  lastCostFieldEdited = "avg";

  // Pre-calculate book cost value from existing average cost and quantity
  if (h.quantity > 0 && h.average_cost > 0) {
    document.getElementById("holding-book-cost").value = (h.average_cost * h.quantity).toFixed(2);
  } else {
    document.getElementById("holding-book-cost").value = "";
  }

  document.getElementById("holding-form-errors").textContent = "";

  const deleteBtn = document.getElementById("holding-delete-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDelete("holding", h.id, h.investment_description);
  };

  document.getElementById("holding-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("holding-quantity").focus();
  }, 50);
}

/**
 * @description Hide the holding form modal.
 */
function hideHoldingForm() {
  document.getElementById("holding-form-container").classList.add("hidden");
}

/**
 * @description Handle holding form submission (create or update).
 * @param {Event} event - The form submit event
 */
async function handleHoldingSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("holding-form-errors");
  errorsDiv.textContent = "";

  const holdingId = document.getElementById("holding-id").value;
  const isEditing = holdingId !== "";

  const investmentValue = document.getElementById("holding-investment").value;
  if (!isEditing && !investmentValue) {
    errorsDiv.textContent = "Please select an investment";
    return;
  }

  const quantity = Number(document.getElementById("holding-quantity").value) || 0;
  let averageCost = Number(document.getElementById("holding-avg-cost").value) || 0;
  const bookCost = Number(document.getElementById("holding-book-cost").value) || 0;

  // If only book cost is provided (no average cost), derive average cost
  if (bookCost > 0 && averageCost === 0 && quantity > 0) {
    averageCost = bookCost / quantity;
  }

  // If both are provided, cross-validate consistency
  if (bookCost > 0 && averageCost > 0 && quantity > 0) {
    const expectedBook = averageCost * quantity;
    // Allow 1p tolerance for rounding differences
    if (Math.abs(expectedBook - bookCost) > 0.01) {
      errorsDiv.textContent = "Average Cost and Book Cost Value are inconsistent. " + "Average Cost \u00d7 Quantity = " + expectedBook.toFixed(2) + " but Book Cost Value = " + bookCost.toFixed(2);
      return;
    }
  }

  const data = {
    investment_id: Number(investmentValue),
    quantity: quantity,
    average_cost: averageCost,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/holdings/" + holdingId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/accounts/" + selectedAccount.id + "/holdings", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideHoldingForm();
    await loadHoldings();
    const msgContainer = "holdings-messages";
    showSuccess(msgContainer, isEditing ? "Holding updated successfully" : "Holding added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

// ─── Delete confirmation ─────────────────────────────────────────────

/**
 * @description Show the delete confirmation dialog.
 * @param {string} type - 'account' or 'holding'
 * @param {number} id - The ID to delete
 * @param {string} name - Display name for the confirmation message
 */
function confirmDelete(type, id, name) {
  pendingDelete = { type: type, id: id, name: name };
  document.getElementById("delete-item-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  pendingDelete = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the pending deletion after confirmation.
 */
async function executeDelete() {
  if (!pendingDelete) return;

  const type = pendingDelete.type;
  const id = pendingDelete.id;

  let url;
  if (type === "account") {
    url = "/api/accounts/" + id;
  } else {
    url = "/api/holdings/" + id;
  }

  const result = await apiRequest(url, { method: "DELETE" });

  hideDeleteDialog();

  if (type === "account") {
    hideAccountForm();
  } else {
    hideHoldingForm();
  }

  if (result.ok) {
    if (type === "account") {
      await loadAccounts();
      showSuccess("page-messages", "Account deleted successfully");
    } else {
      await loadHoldings();
      showSuccess("holdings-messages", "Holding deleted successfully");
    }
  } else {
    const msgContainer = type === "account" ? "page-messages" : "holdings-messages";
    showError(msgContainer, "Failed to delete " + type, result.detail || result.error);
  }
}

// ─── Initialisation ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function () {
  await loadUsers();

  // User selection
  document.getElementById("user-select").addEventListener("change", onUserSelected);

  // Account form
  document.getElementById("add-account-btn").addEventListener("click", showAddAccountForm);
  document.getElementById("account-cancel-btn").addEventListener("click", hideAccountForm);
  document.getElementById("account-form").addEventListener("submit", handleAccountSubmit);

  // Holdings view
  document.getElementById("back-to-accounts-btn").addEventListener("click", backToAccounts);
  document.getElementById("add-holding-btn").addEventListener("click", showAddHoldingForm);
  document.getElementById("holding-cancel-btn").addEventListener("click", hideHoldingForm);
  document.getElementById("holding-form").addEventListener("submit", handleHoldingSubmit);

  // Cost auto-calculation — recalculate when quantity, avg cost, or book cost changes
  document.getElementById("holding-quantity").addEventListener("input", function () {
    recalculateCosts("quantity");
  });
  document.getElementById("holding-avg-cost").addEventListener("input", function () {
    recalculateCosts("avg");
  });
  document.getElementById("holding-book-cost").addEventListener("input", function () {
    recalculateCosts("book");
  });

  // Investment search input — filter as user types
  const searchInput = document.getElementById("holding-investment-search");
  searchInput.addEventListener("input", function () {
    // If user edits text after selecting, clear the hidden value
    document.getElementById("holding-investment").value = "";
    filterInvestmentList(searchInput.value);
  });
  // Show dropdown on focus if there's text
  searchInput.addEventListener("focus", function () {
    if (searchInput.value.trim().length > 0 && !searchInput.readOnly) {
      filterInvestmentList(searchInput.value);
    }
  });

  // Investment dropdown list — handle clicks on items
  document.getElementById("holding-investment-list").addEventListener("click", function (event) {
    const item = event.target.closest("[data-investment-id]");
    if (item) {
      selectInvestment(Number(item.dataset.investmentId));
    }
  });

  // Close investment dropdown when clicking outside
  document.addEventListener("click", function (event) {
    const listEl = document.getElementById("holding-investment-list");
    const searchEl = document.getElementById("holding-investment-search");
    if (!listEl.contains(event.target) && event.target !== searchEl) {
      listEl.classList.add("hidden");
    }
  });

  // Delete dialog
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);

  // Close modals on backdrop click
  document.getElementById("account-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideAccountForm();
  });
  document.getElementById("holding-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideHoldingForm();
  });
  document.getElementById("delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) hideDeleteDialog();
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const deleteDialog = document.getElementById("delete-dialog");
      const accountForm = document.getElementById("account-form-container");
      const holdingForm = document.getElementById("holding-form-container");

      if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!holdingForm.classList.contains("hidden")) {
        hideHoldingForm();
      } else if (!accountForm.classList.contains("hidden")) {
        hideAccountForm();
      }
    }
  });
});
