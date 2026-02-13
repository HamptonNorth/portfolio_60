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

/** @type {Object|null} The holding currently targeted by the action menu (from detail view summary data) */
let actionMenuHolding = null;

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
 * @description Format a number as GBP currency string rounded to whole pounds.
 * Used for summary display where pence-level precision is not needed.
 * @param {number} amount - The amount to format
 * @returns {string} Formatted string like "£1,234"
 */
function formatGBPWhole(amount) {
  if (amount === 0) return "£0";
  return "£" + Math.round(amount).toLocaleString("en-GB");
}

/**
 * @description Format account type for display (uppercase).
 * @param {string} type - Account type ('trading', 'isa', 'sipp')
 * @returns {string} Display string like "TRADING", "ISA", "SIPP"
 */
function formatAccountType(type) {
  return type.toUpperCase();
}

// ─── View routing ────────────────────────────────────────────────────

/** @type {string} Current active view: "summary" or "setup" */
let activeView = "summary";

/**
 * @description Determine the initial view from the URL query parameter.
 * Defaults to "summary" if no ?view= param is present.
 * @returns {string} "summary" or "setup"
 */
function getViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "setup") return "setup";
  return "summary";
}

/**
 * @description Show the specified view, hiding all others.
 * @param {string} view - "summary" or "setup"
 */
function showView(view) {
  activeView = view;

  const summaryView = document.getElementById("summary-view");
  const detailView = document.getElementById("detail-view");
  const accountsView = document.getElementById("accounts-view");
  const holdingsView = document.getElementById("holdings-view");

  if (view === "summary") {
    summaryView.classList.remove("hidden");
    detailView.classList.add("hidden");
    accountsView.classList.add("hidden");
    holdingsView.classList.add("hidden");
    loadSummary();
  } else {
    summaryView.classList.add("hidden");
    detailView.classList.add("hidden");
    accountsView.classList.remove("hidden");
    holdingsView.classList.add("hidden");
  }
}

// ─── Summary Valuation ──────────────────────────────────────────────

/** @type {Array<Object>} Cached portfolio summaries */
let summaryData = [];

/**
 * @description Populate the summary user dropdown with loaded users.
 */
function populateSummaryUserDropdown() {
  const select = document.getElementById("summary-user-select");
  select.innerHTML = '<option value="all">All Users</option>';
  for (const user of users) {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.first_name + " " + user.last_name;
    select.appendChild(option);
  }
}

/**
 * @description Load and display the portfolio summary.
 * Fetches all summaries or a single user's summary depending on dropdown selection.
 */
async function loadSummary() {
  const userValue = document.getElementById("summary-user-select").value;
  const container = document.getElementById("summary-container");

  let result;
  if (userValue === "all") {
    result = await apiRequest("/api/portfolio/summary");
  } else {
    result = await apiRequest("/api/portfolio/summary/" + userValue);
  }

  if (!result.ok) {
    container.innerHTML = '<p class="text-red-600">Failed to load portfolio summary.</p>';
    return;
  }

  // Normalise to array
  const summaries = Array.isArray(result.data) ? result.data : [result.data];
  summaryData = summaries;

  if (summaries.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No portfolio data available.</p>';
    return;
  }

  let html = "";
  for (const summary of summaries) {
    html += renderUserSummary(summary);
  }
  container.innerHTML = html;
}

/**
 * @description Render the summary table for a single user.
 * @param {Object} summary - The portfolio summary object from the API
 * @returns {string} HTML string
 */
function renderUserSummary(summary) {
  const user = summary.user;
  const dateStr = formatDateUK(summary.valuation_date);

  let html = '<div class="mb-8">';
  html += '<h3 class="text-xl font-semibold text-brand-800 mb-3">';
  html += escapeHtml(user.first_name + " " + user.last_name);
  html += '<span class="text-brand-400 text-base font-normal ml-3">Summary valuation  ' + escapeHtml(dateStr) + "</span>";
  html += "</h3>";

  if (summary.accounts.length === 0) {
    html += '<p class="text-brand-500 mb-4">No accounts set up for this user.</p>';
    html += "</div>";
    return html;
  }

  html += '<div class="overflow-x-auto">';
  html += '<table class="w-full border-collapse">';
  html += "<tbody>";

  for (let i = 0; i < summary.accounts.length; i++) {
    const acct = summary.accounts[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const cashWarningHtml = acct.cash_warning ? '<span class="text-red-600 font-medium ml-2">** min cash ' + formatGBPWhole(acct.warn_cash) + "</span>" : "";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-3 px-3 text-base font-semibold text-brand-700 w-24">' + formatAccountType(acct.account_type) + "</td>";
    html += '<td class="py-3 px-3 text-base text-brand-600">Account ' + escapeHtml(acct.account_ref) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right text-brand-500">Investments</td>';
    html += '<td class="py-3 px-3 text-base text-right font-mono w-32">' + formatGBPWhole(acct.investments_total) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right text-brand-500">Cash</td>';
    html += '<td class="py-3 px-3 text-base text-right font-mono w-28">' + formatGBPWhole(acct.cash_balance) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right font-mono w-32 bg-brand-38">' + formatGBPWhole(acct.account_total) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + cashWarningHtml + "</td>";
    html += '<td class="py-3 px-3 text-right">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" ';
    html += "onclick=\"showDetail('" + user.id + "', '" + acct.id + "')\">View</button>";
    html += "</td>";
    html += "</tr>";
  }

  // Totals row
  html += '<tr class="border-t-2 border-brand-300 bg-white">';
  html += '<td class="py-3 px-3" colspan="2"></td>';
  html += '<td class="py-3 px-3 text-base text-right font-semibold text-brand-700">Total</td>';
  html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatGBPWhole(summary.totals.investments) + "</td>";
  html += '<td class="py-3 px-3"></td>';
  html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatGBPWhole(summary.totals.cash) + "</td>";
  html += '<td class="py-3 px-3 text-base text-right font-mono bg-brand-38">' + formatGBPWhole(summary.totals.grand_total) + "</td>";
  html += '<td colspan="2"></td>';
  html += "</tr>";

  html += "</tbody></table></div></div>";
  return html;
}

/**
 * @description Show the holdings detail drill-down for a specific account.
 * @param {number|string} userId - The user ID
 * @param {number|string} accountId - The account ID
 */
async function showDetail(userId, accountId) {
  // Find the account in cached summaryData
  let targetSummary = null;
  let targetAccount = null;

  for (const summary of summaryData) {
    if (summary.user.id === Number(userId)) {
      targetSummary = summary;
      for (const acct of summary.accounts) {
        if (acct.id === Number(accountId)) {
          targetAccount = acct;
          break;
        }
      }
      break;
    }
  }

  if (!targetSummary || !targetAccount) return;

  // Load full account data for cash movements
  const acctResult = await apiRequest("/api/accounts/" + accountId);
  if (acctResult.ok) {
    selectedAccount = acctResult.data;
  }

  cashViewContext = "detail";
  currentDetailAccount = targetAccount;

  document.getElementById("summary-view").classList.add("hidden");
  document.getElementById("detail-view").classList.remove("hidden");

  renderDetailHeader(targetSummary.user, targetAccount);
  renderDetailHoldings(targetAccount);

  // Set up cash balance and reset transactions section
  updateCashBalanceDisplay();
  cashTxExpanded = false;
  document.getElementById("detail-cash-tx-list-container").classList.add("hidden");
  document.getElementById("detail-cash-tx-toggle-icon").innerHTML = "Show &#9662;";
}

/**
 * @description Render the detail view header with account info.
 * @param {Object} user - The user object { first_name, last_name }
 * @param {Object} account - The account summary object
 */
function renderDetailHeader(user, account) {
  const cashWarningHtml = account.cash_warning ? '<span class="text-red-600 font-medium">** min cash ' + formatGBP(account.warn_cash) + "</span>" : "";

  let html = '<h3 class="text-xl font-semibold text-brand-800 mb-2">';
  html += escapeHtml(user.first_name + " " + user.last_name) + " — ";
  html += formatAccountType(account.account_type) + "  Account " + escapeHtml(account.account_ref);
  html += "</h3>";
  html += '<div class="flex gap-6 text-base text-brand-600 mb-4">';
  html += '<span>Investments <strong class="font-mono">' + formatGBPWhole(account.investments_total) + "</strong></span>";
  html += '<span>Cash <strong class="font-mono">' + formatGBPWhole(account.cash_balance) + "</strong></span>";
  html += '<span>Total <strong class="font-mono font-bold">' + formatGBPWhole(account.account_total) + "</strong></span>";
  html += cashWarningHtml;
  html += "</div>";

  document.getElementById("detail-header").innerHTML = html;
}

/**
 * @description Render the holdings detail table for an account.
 * @param {Object} account - The account summary with holdings array
 */
function renderDetailHoldings(account) {
  const container = document.getElementById("detail-container");
  const holdings = account.holdings;

  if (holdings.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No holdings in this account.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full border-collapse text-base">';
  html += "<thead>";
  html += '<tr class="bg-brand-100 text-brand-700">';
  html += '<th class="py-3 px-1 w-8"></th>';
  html += '<th class="py-3 px-3 text-left text-sm font-semibold">Investment</th>';
  html += '<th class="py-3 px-3 text-left text-sm font-semibold">Currency</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Quantity</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Price</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Rate</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Value</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Value GBP</th>';
  html += '<th class="py-3 px-3 text-right text-sm font-semibold">Avg Cost Price</th>';
  html += "</tr></thead><tbody>";

  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const isGBP = h.currency_code === "GBP";
    const publicIdText = h.public_id || "";
    const priceStr = h.price > 0 ? formatDetailPrice(h.price) : "No price";
    const priceDate = h.price_date || "";
    const rateStr = h.rate ? h.rate.toFixed(4) : "";
    const valueLocalStr = h.value_local > 0 ? formatDetailValue(h.value_local) : "";
    const valueGBPStr = h.value_gbp > 0 ? formatGBPWhole(h.value_gbp) : h.price > 0 ? "£0" : "";

    // For GBP holdings, show value only in Value GBP column (skip Value column)
    const showLocalValue = !isGBP && h.value_local > 0;

    // Average cost with currency suffix for non-GBP
    const avgCostStr = h.average_cost > 0 ? formatDetailPrice(h.average_cost) + (isGBP ? "" : " " + h.currency_code) : "";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';

    // Action button (3-dot menu)
    html += '<td class="py-2 px-1 text-center align-top">';
    html += '<button class="holding-action-btn text-brand-400 hover:text-brand-700 text-lg leading-none px-1 py-1 rounded transition-colors" data-holding-index="' + i + '" title="Buy or Sell">';
    html += "&#8942;"; // vertical ellipsis
    html += "</button></td>";

    // Investment: public_id on line 1, name on line 2
    html += '<td class="py-2 px-3">';
    if (publicIdText) {
      html += '<div class="text-sm font-medium text-brand-500">' + escapeHtml(publicIdText) + "</div>";
    }
    html += '<div class="text-base">' + escapeHtml(h.description) + "</div>";
    if (priceDate) {
      html += '<div class="text-xs text-brand-400">Price date: ' + formatDateUK(priceDate) + "</div>";
    }
    html += "</td>";

    html += '<td class="py-2 px-3 text-base">' + escapeHtml(h.currency_code) + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + formatQuantity(h.quantity) + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + priceStr + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + rateStr + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + (showLocalValue ? formatDetailValue(h.value_local) : "") + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono bg-brand-38">' + valueGBPStr + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + avgCostStr + "</td>";

    html += "</tr>";
  }

  // Total row
  html += '<tr class="border-t-2 border-brand-300 bg-white">';
  html += '<td colspan="7" class="py-3 px-3 text-right font-semibold text-brand-700">Total Investments GBP</td>';
  html += '<td class="py-3 px-3 text-right font-mono bg-brand-38">' + formatGBPWhole(account.investments_total) + "</td>";
  html += '<td class="py-3 px-3"></td>';
  html += "</tr>";

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Go back from detail view to summary view.
 */
function backToSummary() {
  selectedAccount = null;
  currentDetailAccount = null;
  cashViewContext = "holdings";
  document.getElementById("detail-view").classList.add("hidden");
  document.getElementById("summary-view").classList.remove("hidden");
}

/**
 * @description Format a date from ISO-8601 (YYYY-MM-DD) to UK format (DD/MM/YYYY).
 * @param {string} isoDate - The ISO date string
 * @returns {string} UK formatted date
 */
function formatDateUK(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

/**
 * @description Format a price for the detail view.
 * Shows up to 4 decimal places; if the price has more precision, shows up to 6dp.
 * Trailing zeros are stripped for cleaner display.
 * @param {number} value - The price value in pounds
 * @returns {string} Formatted price string
 */
function formatDetailPrice(value) {
  if (value === 0) return "0.00";
  const at4dp = parseFloat(value.toFixed(4));
  const at6dp = parseFloat(value.toFixed(6));
  if (at4dp !== at6dp) {
    return value.toFixed(6).replace(/0+$/, "");
  }
  // Always show at least 2dp, strip zeros beyond that
  let formatted = value.toFixed(4);
  // Remove trailing zeros but keep at least 2 decimal places
  formatted = formatted.replace(/(\.\d{2}\d*?)0+$/, "$1");
  return formatted;
}

/**
 * @description Format a monetary value for the detail view with commas but no currency symbol.
 * Shows whole numbers without decimals, fractional amounts with 2dp.
 * @param {number} value - The value to format
 * @returns {string} Formatted value string
 */
function formatDetailValue(value) {
  if (value === 0) return "0";
  const isWhole = Math.abs(value - Math.round(value)) < 0.005;
  if (isWhole) {
    return Math.round(value).toLocaleString("en-GB");
  }
  return value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  populateSummaryUserDropdown();
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
    document.getElementById("test-drawdown-btn").classList.add("hidden");
    document.getElementById("accounts-table-container").innerHTML = '<p class="text-brand-500">Select a user to view their accounts.</p>';
    return;
  }

  selectedUserId = userId;
  document.getElementById("add-account-btn").classList.remove("hidden");
  document.getElementById("test-drawdown-btn").classList.remove("hidden");
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

  // Reset ref dropdown
  populateAccountRefDropdown("");

  document.getElementById("account-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("account-type").focus();
  }, 50);
}

/**
 * @description Populate the account reference dropdown based on the selected account type.
 * Uses the selected user's trading_ref, isa_ref, or sipp_ref field.
 * @param {string} accountType - The account type ('trading', 'isa', 'sipp') or empty
 * @param {string} [currentRef=""] - The current ref value to pre-select (for editing)
 */
function populateAccountRefDropdown(accountType, currentRef) {
  const select = document.getElementById("account-ref");
  select.innerHTML = "";

  if (!accountType) {
    select.innerHTML = '<option value="">Select account type first...</option>';
    return;
  }

  const user = users.find(function (u) {
    return u.id === selectedUserId;
  });
  if (!user) return;

  const refMap = {
    trading: user.trading_ref,
    isa: user.isa_ref,
    sipp: user.sipp_ref,
  };
  const ref = refMap[accountType];

  if (ref) {
    const option = document.createElement("option");
    option.value = ref;
    option.textContent = ref;
    option.selected = true;
    select.appendChild(option);
  } else {
    select.innerHTML = '<option value="">No ' + accountType.toUpperCase() + " reference set for this user</option>";
  }
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
  populateAccountRefDropdown(acct.account_type, acct.account_ref);
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

  cashViewContext = "holdings";

  document.getElementById("accounts-view").classList.add("hidden");
  document.getElementById("holdings-view").classList.remove("hidden");

  updateCashBalanceDisplay();

  // Reset cash transactions section to collapsed
  cashTxExpanded = false;
  document.getElementById("cash-tx-list-container").classList.add("hidden");
  document.getElementById("cash-tx-toggle-icon").innerHTML = "Show &#9662;";

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
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Avg Cost Price</th>';
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
      errorsDiv.textContent = "Avg Cost Price and Book Cost Value are inconsistent. " + "Avg Cost Price \u00d7 Quantity = " + expectedBook.toFixed(2) + " but Book Cost Value = " + bookCost.toFixed(2);
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

  // Show passphrase confirmation for account deletes (cascade through child tables)
  const passphraseSection = document.getElementById("delete-passphrase-section");
  const passphraseInput = document.getElementById("delete-passphrase");
  const passphraseError = document.getElementById("delete-passphrase-error");
  if (type === "account") {
    passphraseSection.classList.remove("hidden");
    passphraseInput.value = "";
    passphraseError.classList.add("hidden");
  } else {
    passphraseSection.classList.add("hidden");
  }

  document.getElementById("delete-dialog").classList.remove("hidden");

  if (type === "account") {
    passphraseInput.focus();
  }
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  pendingDelete = null;
  document.getElementById("delete-dialog").classList.add("hidden");
  document.getElementById("delete-passphrase").value = "";
  document.getElementById("delete-passphrase-error").classList.add("hidden");
  document.getElementById("delete-passphrase-section").classList.add("hidden");
}

/**
 * @description Execute the pending deletion after confirmation.
 */
async function executeDelete() {
  if (!pendingDelete) return;

  const type = pendingDelete.type;
  const id = pendingDelete.id;

  // For account deletes, require passphrase confirmation
  let passphrase = null;
  if (type === "account") {
    passphrase = document.getElementById("delete-passphrase").value;
    const passphraseError = document.getElementById("delete-passphrase-error");
    if (!passphrase) {
      passphraseError.textContent = "Passphrase is required";
      passphraseError.classList.remove("hidden");
      return;
    }
    passphraseError.classList.add("hidden");
  }

  let url;
  let options;
  if (type === "account") {
    url = "/api/accounts/" + id;
    options = { method: "DELETE", body: JSON.stringify({ passphrase: passphrase }) };
  } else {
    url = "/api/holdings/" + id;
    options = { method: "DELETE" };
  }

  const result = await apiRequest(url, options);

  // If passphrase was wrong, show error but keep dialog open
  if (!result.ok && type === "account" && result.error === "Incorrect passphrase") {
    const passphraseError = document.getElementById("delete-passphrase-error");
    passphraseError.textContent = "Incorrect passphrase";
    passphraseError.classList.remove("hidden");
    document.getElementById("delete-passphrase").value = "";
    document.getElementById("delete-passphrase").focus();
    return;
  }

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

// ─── Cash Movements ──────────────────────────────────────────────────

/** @type {number} Current transaction list limit */
let cashTxLimit = 20;

/** @type {boolean} Whether the cash transactions section is expanded */
let cashTxExpanded = false;

/** @type {number|null} ID of the cash transaction pending deletion */
let pendingCashTxDelete = null;

/**
 * @type {string} Which view is currently showing cash elements: "holdings" or "detail".
 * Used to target the correct DOM elements since both views have cash balance bars.
 */
let cashViewContext = "holdings";

/**
 * @description Get the correct element ID prefix for the current cash view context.
 * The detail view uses "detail-" prefixed IDs; the holdings view uses unprefixed IDs.
 * @returns {string} The prefix string ("detail-" or "")
 */
function cashPrefix() {
  return cashViewContext === "detail" ? "detail-" : "";
}

/**
 * @description Update the cash balance display bar with the current account's balance.
 * Shows a warning if balance is below the warn threshold.
 * Works in both holdings and detail views based on cashViewContext.
 */
function updateCashBalanceDisplay() {
  if (!selectedAccount) return;

  const prefix = cashPrefix();
  const displayEl = document.getElementById(prefix + "cash-balance-display");
  const warningEl = document.getElementById(prefix + "cash-balance-warning");

  displayEl.textContent = formatGBP(selectedAccount.cash_balance);

  if (selectedAccount.warn_cash > 0 && selectedAccount.cash_balance < selectedAccount.warn_cash) {
    warningEl.textContent = "Below minimum (" + formatGBP(selectedAccount.warn_cash) + ")";
    warningEl.classList.remove("hidden");
  } else {
    warningEl.classList.add("hidden");
  }
}

/**
 * @description Reload the selected account data from the server (to get updated cash_balance).
 */
async function refreshSelectedAccount() {
  if (!selectedAccount) return;
  const result = await apiRequest("/api/accounts/" + selectedAccount.id);
  if (result.ok) {
    selectedAccount = result.data;
  }
}

/**
 * @description Load and display cash transactions for the selected account.
 * @param {number} [limit=20] - Maximum number of transactions to fetch
 */
async function loadCashTransactions(limit) {
  if (!selectedAccount) return;

  limit = limit || cashTxLimit;
  const prefix = cashPrefix();
  const container = document.getElementById(prefix + "cash-tx-list");
  const result = await apiRequest("/api/accounts/" + selectedAccount.id + "/cash-transactions?limit=" + (limit + 1));

  if (!result.ok) {
    container.innerHTML = '<p class="text-red-600 text-sm">Failed to load transactions.</p>';
    return;
  }

  const transactions = result.data;
  const hasMore = transactions.length > limit;
  const displayTx = hasMore ? transactions.slice(0, limit) : transactions;

  if (displayTx.length === 0) {
    container.innerHTML = '<p class="text-brand-500 text-sm">No cash transactions recorded.</p>';
    document.getElementById(prefix + "cash-tx-show-more").classList.add("hidden");
    return;
  }

  // Calculate running balance: transactions are newest-first, so work backwards
  // to compute the balance after each transaction
  let runningBalances = [];
  if (selectedAccount && displayTx.length > 0) {
    // Start from current account balance and work backwards through the displayed transactions
    // Each transaction's balance = what the balance was AFTER that transaction
    // We reconstruct by reversing the effect of newer transactions
    let balance = selectedAccount.cash_balance;
    // First, reverse any transactions beyond our display (those newer than page limit)
    // Since displayTx is already sliced from the full newest-first list, balance is current
    runningBalances = new Array(displayTx.length);
    for (let i = 0; i < displayTx.length; i++) {
      runningBalances[i] = balance;
      // Reverse this transaction's effect to get the balance before it
      const txType = displayTx[i].transaction_type;
      if (txType === "deposit" || txType === "sell") {
        balance -= displayTx[i].amount;
      } else {
        balance += displayTx[i].amount;
      }
    }
  }

  let html = '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += "<tr>";
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700">Type</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700 text-right">Quantity</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700 text-right">Total</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700 text-right">Deductible</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700 text-right">Revised</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700 text-right">Cash</th>';
  html += '<th class="pt-2 px-3 text-sm font-semibold text-brand-700">Notes</th>';
  html += "</tr>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="pb-2 px-3"></th>';
  html += '<th class="pb-2 px-3"></th>';
  html += '<th class="pb-2 px-3"></th>';
  html += '<th class="pb-2 px-3"></th>';
  html += '<th class="pb-2 px-3 text-sm font-semibold text-brand-700 text-right">Costs</th>';
  html += '<th class="pb-2 px-3 text-sm font-semibold text-brand-700 text-right">Avg Cost</th>';
  html += '<th class="pb-2 px-3 text-sm font-semibold text-brand-700 text-right">Balance</th>';
  html += '<th class="pb-2 px-3"></th>';
  html += "</tr>";
  html += "</thead><tbody>";

  for (let i = 0; i < displayTx.length; i++) {
    const tx = displayTx[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    const typeLabel = tx.transaction_type.charAt(0).toUpperCase() + tx.transaction_type.slice(1);
    const typeClass = tx.transaction_type === "deposit" || tx.transaction_type === "sell" ? "text-green-700" : tx.transaction_type === "withdrawal" || tx.transaction_type === "buy" ? "text-amber-700" : "text-brand-600";
    const hasMoveData = tx.quantity !== undefined && tx.quantity !== null;

    // Total column: for buy/sell show total_consideration from movement; for deposits/withdrawals show the amount
    const totalValue = hasMoveData ? tx.total_consideration : tx.amount;
    const notesText = tx.notes || "";
    const truncatedNotes = notesText.length > 40 ? notesText.substring(0, 40) + "..." : notesText;

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-2 px-3 text-sm">' + formatDateUK(tx.transaction_date) + "</td>";
    html += '<td class="py-2 px-3 text-sm font-medium ' + typeClass + '">' + escapeHtml(typeLabel) + "</td>";
    html += '<td class="py-2 px-3 text-sm text-right font-mono">' + (hasMoveData ? formatQuantity(tx.quantity) : "") + "</td>";
    html += '<td class="py-2 px-3 text-sm text-right font-mono">' + formatGBP(totalValue) + "</td>";
    html += '<td class="py-2 px-3 text-sm text-right font-mono">' + (hasMoveData && tx.deductible_costs > 0 ? formatGBP(tx.deductible_costs) : "") + "</td>";
    html += '<td class="py-2 px-3 text-sm text-right font-mono">' + (tx.transaction_type === "buy" && tx.revised_avg_cost ? formatDetailPrice(tx.revised_avg_cost) : "") + "</td>";
    html += '<td class="py-2 px-3 text-sm text-right font-mono">' + (runningBalances.length > 0 ? formatGBP(runningBalances[i]) : "") + "</td>";
    html += '<td class="py-2 px-3 text-sm text-brand-500 max-w-xs truncate" title="' + escapeHtml(notesText) + '">' + escapeHtml(truncatedNotes) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  container.innerHTML = html;

  // Show/hide "Show more" button
  const moreContainer = document.getElementById(prefix + "cash-tx-show-more");
  if (hasMore) {
    moreContainer.classList.remove("hidden");
  } else {
    moreContainer.classList.add("hidden");
  }
}

/**
 * @description Toggle the cash transactions section visibility.
 */
function toggleCashTransactions() {
  cashTxExpanded = !cashTxExpanded;
  const prefix = cashPrefix();
  const container = document.getElementById(prefix + "cash-tx-list-container");
  const icon = document.getElementById(prefix + "cash-tx-toggle-icon");

  if (cashTxExpanded) {
    container.classList.remove("hidden");
    icon.innerHTML = "Hide &#9652;";
    loadCashTransactions();
  } else {
    container.classList.add("hidden");
    icon.innerHTML = "Show &#9662;";
  }
}

/**
 * @description Show the deposit form modal. Sets up the form for a deposit transaction.
 */
function showDepositForm() {
  document.getElementById("cash-tx-form-title").textContent = "Deposit";
  document.getElementById("cash-tx-type").value = "deposit";
  document.getElementById("cash-tx-form").reset();
  document.getElementById("cash-tx-date").value = getTodayISO();
  document.getElementById("cash-tx-form-errors").textContent = "";
  document.getElementById("cash-tx-available").classList.add("hidden");

  // Green submit button for deposit
  const submitBtn = document.getElementById("cash-tx-submit-btn");
  submitBtn.className = "bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2 rounded-lg transition-colors";
  submitBtn.textContent = "Deposit";

  document.getElementById("cash-tx-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("cash-tx-amount").focus();
  }, 50);
}

/**
 * @description Show the withdrawal form modal. Shows available balance and sets up validation.
 */
function showWithdrawForm() {
  document.getElementById("cash-tx-form-title").textContent = "Withdraw";
  document.getElementById("cash-tx-type").value = "withdrawal";
  document.getElementById("cash-tx-form").reset();
  document.getElementById("cash-tx-date").value = getTodayISO();
  document.getElementById("cash-tx-form-errors").textContent = "";

  // Show available balance
  const availableDiv = document.getElementById("cash-tx-available");
  availableDiv.classList.remove("hidden");
  document.getElementById("cash-tx-available-amount").textContent = formatGBP(selectedAccount.cash_balance);

  // Amber submit button for withdrawal
  const submitBtn = document.getElementById("cash-tx-submit-btn");
  submitBtn.className = "bg-amber-600 hover:bg-amber-700 text-white font-medium px-5 py-2 rounded-lg transition-colors";
  submitBtn.textContent = "Withdraw";

  document.getElementById("cash-tx-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("cash-tx-amount").focus();
  }, 50);
}

/**
 * @description Hide the cash transaction form modal.
 */
function hideCashTxForm() {
  document.getElementById("cash-tx-form-container").classList.add("hidden");
}

/**
 * @description Handle cash transaction form submission (deposit or withdrawal).
 * @param {Event} event - The form submit event
 */
async function handleCashTxSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("cash-tx-form-errors");
  errorsDiv.textContent = "";

  const transactionType = document.getElementById("cash-tx-type").value;
  const amount = Number(document.getElementById("cash-tx-amount").value);
  const transactionDate = document.getElementById("cash-tx-date").value;
  const notes = document.getElementById("cash-tx-notes").value.trim();

  // Client-side withdrawal check
  if (transactionType === "withdrawal" && amount > selectedAccount.cash_balance) {
    errorsDiv.textContent = "Withdrawal amount exceeds available balance of " + formatGBP(selectedAccount.cash_balance);
    return;
  }

  const data = {
    transaction_type: transactionType,
    transaction_date: transactionDate,
    amount: amount,
    notes: notes || null,
  };

  const result = await apiRequest("/api/accounts/" + selectedAccount.id + "/cash-transactions", {
    method: "POST",
    body: data,
  });

  if (result.ok) {
    hideCashTxForm();
    await refreshSelectedAccount();
    updateCashBalanceDisplay();
    if (cashTxExpanded) {
      await loadCashTransactions();
    }
    const msgContainer = cashViewContext === "detail" ? "detail-header" : "holdings-messages";
    showSuccess(msgContainer, transactionType === "deposit" ? "Deposit recorded successfully" : "Withdrawal recorded successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog for a cash transaction.
 * @param {number} txId - The transaction ID to delete
 * @param {string} typeLabel - Display label for the transaction type
 * @param {number} amount - The transaction amount
 * @param {string} dateStr - The ISO date string of the transaction
 */
function confirmCashTxDelete(txId, typeLabel, amount, dateStr) {
  pendingCashTxDelete = txId;
  document.getElementById("cash-tx-delete-message").textContent = "Delete this " + formatGBP(amount) + " " + typeLabel.toLowerCase() + " from " + formatDateUK(dateStr) + "?";
  document.getElementById("cash-tx-delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the cash transaction delete dialog.
 */
function hideCashTxDeleteDialog() {
  pendingCashTxDelete = null;
  document.getElementById("cash-tx-delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the pending cash transaction deletion.
 */
async function executeCashTxDelete() {
  if (!pendingCashTxDelete) return;

  const txId = pendingCashTxDelete;
  hideCashTxDeleteDialog();

  const result = await apiRequest("/api/cash-transactions/" + txId, { method: "DELETE" });

  const msgContainer = cashViewContext === "detail" ? "detail-header" : "holdings-messages";
  if (result.ok) {
    await refreshSelectedAccount();
    updateCashBalanceDisplay();
    if (cashTxExpanded) {
      await loadCashTransactions();
    }
    showSuccess(msgContainer, "Transaction deleted successfully");
  } else {
    showError(msgContainer, "Failed to delete transaction", result.detail || result.error);
  }
}

/**
 * @description Get today's date as an ISO-8601 string (YYYY-MM-DD).
 * @returns {string} Today's date
 */
function getTodayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

// ─── Buy / Sell Movements ────────────────────────────────────────────

/** @type {Object|null} The currently displayed detail account (from summary data) */
let currentDetailAccount = null;

/**
 * @description Show the 3-dot action menu next to a holding row button.
 * The menu is positioned absolutely relative to the clicked button.
 * @param {number} holdingIndex - Index into currentDetailAccount.holdings
 * @param {HTMLElement} buttonEl - The clicked button element
 */
function showActionMenu(holdingIndex, buttonEl) {
  const menu = document.getElementById("holding-action-menu");

  if (!currentDetailAccount || !currentDetailAccount.holdings[holdingIndex]) {
    return;
  }

  actionMenuHolding = currentDetailAccount.holdings[holdingIndex];

  // Disable Sell if quantity is zero
  const sellBtn = document.getElementById("action-sell-btn");
  if (actionMenuHolding.quantity <= 0) {
    sellBtn.disabled = true;
    sellBtn.classList.add("text-brand-300", "cursor-not-allowed");
    sellBtn.classList.remove("hover:bg-brand-50");
  } else {
    sellBtn.disabled = false;
    sellBtn.classList.remove("text-brand-300", "cursor-not-allowed");
    sellBtn.classList.add("hover:bg-brand-50");
  }

  // Position the menu below the button
  const rect = buttonEl.getBoundingClientRect();
  menu.style.top = rect.bottom + window.scrollY + "px";
  menu.style.left = rect.left + window.scrollX + "px";
  menu.classList.remove("hidden");
}

/**
 * @description Hide the holding action menu.
 */
function hideActionMenu() {
  document.getElementById("holding-action-menu").classList.add("hidden");
  actionMenuHolding = null;
}

/**
 * @description Show the Buy form modal for the selected holding.
 */
function showBuyForm() {
  if (!actionMenuHolding || !selectedAccount) return;

  const h = actionMenuHolding;
  hideActionMenu();

  document.getElementById("movement-form-title").textContent = "Buy";
  document.getElementById("movement-type").value = "buy";
  document.getElementById("movement-holding-id").value = h.holding_id;
  document.getElementById("movement-form").reset();
  document.getElementById("movement-date").value = getTodayISO();
  document.getElementById("movement-deductible").value = "0";
  document.getElementById("movement-form-errors").textContent = "";

  // Holding info
  const publicIdText = h.public_id ? " (" + h.public_id + ")" : "";
  document.getElementById("movement-form-holding-info").innerHTML = "<strong>" + escapeHtml(h.description) + "</strong>" + escapeHtml(publicIdText) + '<br><span class="text-sm">Current quantity: ' + formatQuantity(h.quantity) + "</span>";

  // Show available cash info
  document.getElementById("movement-cash-info").textContent = "Available cash: " + formatGBP(selectedAccount.cash_balance);
  document.getElementById("movement-qty-info").textContent = "";

  // Show deductible costs, hide book cost display
  document.getElementById("movement-deductible-hint").textContent = "e.g. stamp duty, commission — excluded from average cost";
  document.getElementById("movement-bookcost-row").classList.add("hidden");

  // Submit button style
  const submitBtn = document.getElementById("movement-submit-btn");
  submitBtn.className = "bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2 rounded-lg transition-colors";
  submitBtn.textContent = "Confirm Buy";

  document.getElementById("movement-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("movement-quantity").focus();
  }, 50);
}

/**
 * @description Show the Sell form modal for the selected holding.
 */
function showSellForm() {
  if (!actionMenuHolding || !selectedAccount) return;

  const h = actionMenuHolding;
  hideActionMenu();

  document.getElementById("movement-form-title").textContent = "Sell";
  document.getElementById("movement-type").value = "sell";
  document.getElementById("movement-holding-id").value = h.holding_id;
  document.getElementById("movement-form").reset();
  document.getElementById("movement-date").value = getTodayISO();
  document.getElementById("movement-deductible").value = "0";
  document.getElementById("movement-form-errors").textContent = "";

  // Holding info
  const publicIdText = h.public_id ? " (" + h.public_id + ")" : "";
  document.getElementById("movement-form-holding-info").innerHTML = "<strong>" + escapeHtml(h.description) + "</strong>" + escapeHtml(publicIdText) + '<br><span class="text-sm">Current quantity: ' + formatQuantity(h.quantity) + " | Avg cost: " + formatDetailPrice(h.average_cost) + "</span>";

  // Show quantity info
  document.getElementById("movement-qty-info").textContent = "Maximum: " + formatQuantity(h.quantity);
  document.getElementById("movement-cash-info").textContent = "";

  // Show deductible costs and book cost display
  document.getElementById("movement-deductible-hint").textContent = "e.g. commission — usually zero for mutual funds";
  document.getElementById("movement-bookcost-row").classList.remove("hidden");
  document.getElementById("movement-bookcost-display").textContent = "";

  // Submit button style
  const submitBtn = document.getElementById("movement-submit-btn");
  submitBtn.className = "bg-amber-600 hover:bg-amber-700 text-white font-medium px-5 py-2 rounded-lg transition-colors";
  submitBtn.textContent = "Confirm Sell";

  document.getElementById("movement-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("movement-quantity").focus();
  }, 50);
}

/**
 * @description Update the book cost display when the sell quantity changes.
 * Book cost = sell quantity x average cost.
 */
function updateSellBookCost() {
  const movementType = document.getElementById("movement-type").value;
  if (movementType !== "sell") return;

  const qty = Number(document.getElementById("movement-quantity").value) || 0;
  const holdingId = Number(document.getElementById("movement-holding-id").value);

  // Find the holding's average cost from the detail account data
  let avgCost = 0;
  if (currentDetailAccount) {
    const h = currentDetailAccount.holdings.find(function (x) {
      return x.holding_id === holdingId;
    });
    if (h) avgCost = h.average_cost;
  }

  if (qty > 0 && avgCost > 0) {
    const bookCost = qty * avgCost;
    document.getElementById("movement-bookcost-display").textContent = formatGBP(bookCost);
  } else {
    document.getElementById("movement-bookcost-display").textContent = "";
  }
}

/**
 * @description Hide the movement form modal.
 */
function hideMovementForm() {
  document.getElementById("movement-form-container").classList.add("hidden");
}

/**
 * @description Handle movement form submission (buy or sell).
 * Posts to the API, then refreshes the detail view.
 * @param {Event} event - The form submit event
 */
async function handleMovementSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("movement-form-errors");
  errorsDiv.textContent = "";

  const holdingId = Number(document.getElementById("movement-holding-id").value);
  const movementType = document.getElementById("movement-type").value;
  const movementDate = document.getElementById("movement-date").value;
  const quantity = Number(document.getElementById("movement-quantity").value);
  const totalConsideration = Number(document.getElementById("movement-consideration").value);
  const deductibleCosts = Number(document.getElementById("movement-deductible").value) || 0;
  const notes = document.getElementById("movement-notes").value.trim();

  // Client-side validation
  if (movementType === "buy" && totalConsideration > selectedAccount.cash_balance) {
    errorsDiv.textContent = "Total consideration exceeds available cash of " + formatGBP(selectedAccount.cash_balance);
    return;
  }

  if (movementType === "sell" && currentDetailAccount) {
    const h = currentDetailAccount.holdings.find(function (x) {
      return x.holding_id === holdingId;
    });
    if (h && quantity > h.quantity) {
      errorsDiv.textContent = "Sell quantity exceeds holding quantity of " + formatQuantity(h.quantity);
      return;
    }
  }

  const data = {
    movement_type: movementType,
    movement_date: movementDate,
    quantity: quantity,
    total_consideration: totalConsideration,
    deductible_costs: deductibleCosts,
    notes: notes || null,
  };

  const result = await apiRequest("/api/holdings/" + holdingId + "/movements", {
    method: "POST",
    body: data,
  });

  if (result.ok) {
    hideMovementForm();

    // Refresh the account data
    await refreshSelectedAccount();
    updateCashBalanceDisplay();

    // Reload the portfolio summary to get updated quantities and valuations
    const userValue = document.getElementById("summary-user-select").value;
    let summaryResult;
    if (userValue === "all" || !userValue) {
      summaryResult = await apiRequest("/api/portfolio/summary");
    } else {
      summaryResult = await apiRequest("/api/portfolio/summary/" + userValue);
    }

    if (summaryResult.ok) {
      const summaries = Array.isArray(summaryResult.data) ? summaryResult.data : [summaryResult.data];
      summaryData = summaries;

      // Find the updated account in the refreshed summary
      for (const summary of summaryData) {
        for (const acct of summary.accounts) {
          if (acct.id === selectedAccount.id) {
            currentDetailAccount = acct;
            renderDetailHeader(summary.user, acct);
            renderDetailHoldings(acct);
            break;
          }
        }
      }
    }

    // Refresh cash transactions if expanded
    if (cashTxExpanded) {
      await loadCashTransactions();
    }

    const action = movementType === "buy" ? "Buy" : "Sell";
    showSuccess("detail-header", action + " recorded successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

// ─── Drawdown Preview ────────────────────────────────────────────────

/**
 * @description Call the drawdown processor dry-run endpoint and display
 * the results in a modal. No database changes are made.
 */
async function testDrawdownProcessor() {
  const btn = document.getElementById("test-drawdown-btn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Testing...";

  try {
    const result = await apiRequest("/api/drawdown-schedules/preview", {
      method: "POST",
    });

    if (result.ok) {
      showDrawdownPreviewResults(result.data);
    } else {
      showError("page-messages", "Drawdown test failed", result.detail || result.error);
    }
  } catch (error) {
    showError("page-messages", "Drawdown test failed", error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * @description Render the drawdown preview results inside the modal and show it.
 * @param {Object} data - The preview response from the API
 */
function showDrawdownPreviewResults(data) {
  const container = document.getElementById("drawdown-preview-content");
  const items = data.would_process || [];
  const alreadyExist = data.already_exist || 0;
  const totalAmount = data.total_amount || 0;

  let html = "";

  // Summary counts
  html += '<div class="grid grid-cols-3 gap-3 mb-4">';
  html += '<div class="bg-green-50 border border-green-200 rounded-lg p-3 text-center">';
  html += '<div class="text-sm text-green-700">Would Create</div>';
  html += '<div class="text-2xl font-semibold text-green-800">' + items.length + "</div>";
  html += "</div>";
  html += '<div class="bg-brand-50 border border-brand-200 rounded-lg p-3 text-center">';
  html += '<div class="text-sm text-brand-600">Already Exist</div>';
  html += '<div class="text-2xl font-semibold text-brand-800">' + alreadyExist + "</div>";
  html += "</div>";
  html += '<div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">';
  html += '<div class="text-sm text-amber-700">Total Amount</div>';
  html += '<div class="text-2xl font-semibold text-amber-800">&pound;' + formatDetailValue(totalAmount) + "</div>";
  html += "</div>";
  html += "</div>";

  if (items.length === 0 && alreadyExist === 0) {
    html += '<p class="text-brand-500">No active drawdown schedules found.</p>';
  } else if (items.length === 0) {
    html += '<p class="text-brand-500">All due drawdowns have already been processed. Nothing new to create.</p>';
  } else {
    // Warnings
    const warnings = items.filter(function (item) {
      return item.warning !== null;
    });
    if (warnings.length > 0) {
      html += '<div class="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">';
      html += '<div class="text-sm font-semibold text-red-700 mb-2">Warnings (' + warnings.length + ")</div>";
      html += '<ul class="text-sm text-red-700 space-y-1">';
      for (const w of warnings) {
        html += "<li>" + escapeHtml(w.account_ref + " on " + formatDateUK(w.date) + ": " + w.warning) + "</li>";
      }
      html += "</ul></div>";
    }

    // Detail table
    html += '<table class="w-full text-left border-collapse">';
    html += '<thead><tr class="border-b-2 border-brand-200">';
    html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Date</th>';
    html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Account</th>';
    html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700 text-right">Amount</th>';
    html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Notes</th>';
    html += "</tr></thead><tbody>";

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowClass = i % 2 === 1 ? ' class="bg-brand-25"' : "";
      const warningClass = item.warning ? ' class="text-red-700"' : "";
      html += "<tr" + rowClass + ">";
      html += '<td class="py-1.5 px-2 text-sm"' + warningClass + ">" + formatDateUK(item.date) + "</td>";
      html += '<td class="py-1.5 px-2 text-sm">' + escapeHtml(item.account_ref) + "</td>";
      html += '<td class="py-1.5 px-2 text-sm text-right">&pound;' + formatDetailValue(item.amount) + "</td>";
      html += '<td class="py-1.5 px-2 text-sm text-brand-500">' + escapeHtml(item.notes || "") + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table>";
  }

  container.innerHTML = html;
  document.getElementById("drawdown-preview-modal").classList.remove("hidden");
}

/**
 * @description Hide the drawdown preview modal.
 */
function hideDrawdownPreview() {
  document.getElementById("drawdown-preview-modal").classList.add("hidden");
}

// ─── Initialisation ──────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function () {
  await loadUsers();

  // Determine view from URL query parameter
  const initialView = getViewFromUrl();
  showView(initialView);

  // Summary user selection
  document.getElementById("summary-user-select").addEventListener("change", function () {
    loadSummary();
  });

  // Back to summary button
  document.getElementById("back-to-summary-btn").addEventListener("click", backToSummary);

  // User selection (setup tab)
  document.getElementById("user-select").addEventListener("change", onUserSelected);

  // Account form
  document.getElementById("add-account-btn").addEventListener("click", showAddAccountForm);
  document.getElementById("account-cancel-btn").addEventListener("click", hideAccountForm);
  document.getElementById("account-form").addEventListener("submit", handleAccountSubmit);
  document.getElementById("account-type").addEventListener("change", function () {
    populateAccountRefDropdown(this.value);
  });

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

  // Cash movements — holdings view
  document.getElementById("deposit-btn").addEventListener("click", showDepositForm);
  document.getElementById("withdraw-btn").addEventListener("click", showWithdrawForm);
  document.getElementById("cash-tx-toggle").addEventListener("click", toggleCashTransactions);
  document.getElementById("cash-tx-more-btn").addEventListener("click", function () {
    cashTxLimit += 20;
    loadCashTransactions(cashTxLimit);
  });

  // Cash movements — detail view
  document.getElementById("detail-deposit-btn").addEventListener("click", showDepositForm);
  document.getElementById("detail-withdraw-btn").addEventListener("click", showWithdrawForm);
  document.getElementById("detail-cash-tx-toggle").addEventListener("click", toggleCashTransactions);
  document.getElementById("detail-cash-tx-more-btn").addEventListener("click", function () {
    cashTxLimit += 20;
    loadCashTransactions(cashTxLimit);
  });

  // Cash movements — shared form and delete dialog
  document.getElementById("cash-tx-form").addEventListener("submit", handleCashTxSubmit);
  document.getElementById("cash-tx-cancel-btn").addEventListener("click", hideCashTxForm);
  document.getElementById("cash-tx-delete-cancel-btn").addEventListener("click", hideCashTxDeleteDialog);
  document.getElementById("cash-tx-delete-confirm-btn").addEventListener("click", executeCashTxDelete);

  // Buy/Sell movement form
  document.getElementById("action-buy-btn").addEventListener("click", showBuyForm);
  document.getElementById("action-sell-btn").addEventListener("click", showSellForm);
  document.getElementById("movement-form").addEventListener("submit", handleMovementSubmit);
  document.getElementById("movement-cancel-btn").addEventListener("click", hideMovementForm);
  document.getElementById("movement-quantity").addEventListener("input", updateSellBookCost);

  // Action menu — delegate clicks on 3-dot buttons in the detail holdings table
  document.getElementById("detail-container").addEventListener("click", function (event) {
    const btn = event.target.closest(".holding-action-btn");
    if (btn) {
      event.stopPropagation();
      const index = Number(btn.dataset.holdingIndex);
      // Toggle: if menu is already open for this holding, close it
      const menu = document.getElementById("holding-action-menu");
      if (!menu.classList.contains("hidden") && actionMenuHolding && currentDetailAccount && currentDetailAccount.holdings[index] === actionMenuHolding) {
        hideActionMenu();
      } else {
        showActionMenu(index, btn);
      }
    }
  });

  // Close action menu when clicking outside
  document.addEventListener("click", function (event) {
    const menu = document.getElementById("holding-action-menu");
    if (!menu.classList.contains("hidden") && !menu.contains(event.target) && !event.target.closest(".holding-action-btn")) {
      hideActionMenu();
    }
  });

  // Drawdown preview
  document.getElementById("test-drawdown-btn").addEventListener("click", testDrawdownProcessor);
  document.getElementById("drawdown-preview-close-btn").addEventListener("click", hideDrawdownPreview);

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
  document.getElementById("drawdown-preview-modal").addEventListener("click", function (event) {
    if (event.target === this) hideDrawdownPreview();
  });
  document.getElementById("cash-tx-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideCashTxForm();
  });
  document.getElementById("cash-tx-delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) hideCashTxDeleteDialog();
  });
  document.getElementById("movement-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideMovementForm();
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const movementForm = document.getElementById("movement-form-container");
      const cashTxDeleteDialog = document.getElementById("cash-tx-delete-dialog");
      const cashTxForm = document.getElementById("cash-tx-form-container");
      const deleteDialog = document.getElementById("delete-dialog");
      const accountForm = document.getElementById("account-form-container");
      const holdingForm = document.getElementById("holding-form-container");
      const drawdownPreview = document.getElementById("drawdown-preview-modal");
      const actionMenu = document.getElementById("holding-action-menu");

      if (!actionMenu.classList.contains("hidden")) {
        hideActionMenu();
      } else if (!movementForm.classList.contains("hidden")) {
        hideMovementForm();
      } else if (!cashTxDeleteDialog.classList.contains("hidden")) {
        hideCashTxDeleteDialog();
      } else if (!cashTxForm.classList.contains("hidden")) {
        hideCashTxForm();
      } else if (!drawdownPreview.classList.contains("hidden")) {
        hideDrawdownPreview();
      } else if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!holdingForm.classList.contains("hidden")) {
        hideHoldingForm();
      } else if (!accountForm.classList.contains("hidden")) {
        hideAccountForm();
      }
    }
  });
});
