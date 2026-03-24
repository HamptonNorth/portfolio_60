/**
 * @description Analysis page logic for Portfolio 60.
 * Handles four views: Comparison, League Table, Risk vs Return scatter,
 * Top/Bottom performers. Each view supports period selection, optional
 * benchmark overlay, and Print to PDF.
 */

/* globals apiRequest, escapeHtml, buildResearchLinkHtml, Chart */

// ─── State ──────────────────────────────────────────────────────

/** @type {string} Currently active tab */
var activeTab = "comparison";

/** @type {string} Currently selected period code (for league/scatter/topbottom) */
var activePeriod = "1y";

/** @type {string} Current sort column for league table */
var leagueSort = "return";

/** @type {string} Current sort direction for league table */
var leagueSortDir = "desc";

/** @type {string} Current limit for league table */
var leagueLimit = "all";

/** @type {Object|null} Cached league table data */
var leagueData = null;

/** @type {Object|null} Cached comparison data */
var comparisonData = null;

/** @type {Array<string>} Currently selected comparison periods */
var comparisonPeriods = ["3m", "6m", "1y", "3y"];

/** @type {number} Current comparison sort column index (0-3) */
var comparisonSortCol = 2;

/** @type {string} Current comparison sort direction */
var comparisonSortDir = "desc";

/** @type {Object|null} Chart.js scatter chart instance */
var scatterChart = null;

/** @type {Object|null} Chart.js top performers chart instance */
var topChart = null;

/** @type {Object|null} Chart.js bottom performers chart instance */
var bottomChart = null;

/** @type {Array<Object>} All configured benchmarks */
var allBenchmarks = [];

/** @type {Array<number>} Currently selected benchmark IDs (max 3) */
var selectedBenchmarkIds = [];

/** @type {Array<string>} All available period codes in order */
var ALL_PERIODS = ["1w", "1m", "3m", "6m", "1y", "2y", "3y"];

/** @type {Object<string, string>} Period code to display label */
var PERIOD_DISPLAY = { "1w": "1W", "1m": "1M", "3m": "3M", "6m": "6M", "1y": "1Y", "2y": "2Y", "3y": "3Y" };

/** @type {Object|null} Cached league benchmark data */
var leagueBenchmarkData = null;

/** @type {string} Current holdings filter value */
var holdingsFilter = "current";

/** @type {Array<Object>} All users loaded from the API */
var allUsers = [];

/** @type {Array<number>} Currently selected user IDs */
var selectedUserIds = [];

// ─── Initialisation ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function () {
  setupTabs();
  setupPeriodButtons();
  highlightActivePeriod();
  setupSortButtons();
  setupLeagueLimit();
  setupPrintButton();
  setupHoldingsFilter();
  setupUserFilter();
  loadBenchmarks();
  await loadUsers();
  activateTab("comparison");
});

// ─── Benchmarks ─────────────────────────────────────────────────

/**
 * @description Fetch all configured benchmarks and render the selector.
 */
async function loadBenchmarks() {
  try {
    var result = await apiRequest("/api/benchmarks");
    if (!result.ok || !Array.isArray(result.data)) return;
    allBenchmarks = result.data;
    if (allBenchmarks.length === 0) return;

    var container = document.getElementById("benchmark-selector");
    container.classList.remove("hidden");

    var checkboxes = document.getElementById("benchmark-checkboxes");
    var html = "";
    for (var i = 0; i < allBenchmarks.length; i++) {
      var bm = allBenchmarks[i];
      html += '<label class="inline-flex items-center gap-1 text-sm text-brand-700 cursor-pointer">';
      html += '<input type="checkbox" class="bm-checkbox" value="' + bm.id + '" />';
      html += escapeHtml(bm.description);
      html += "</label>";
    }
    checkboxes.innerHTML = html;

    // Set up change handlers
    var boxes = checkboxes.querySelectorAll(".bm-checkbox");
    for (var j = 0; j < boxes.length; j++) {
      boxes[j].addEventListener("change", handleBenchmarkChange);
    }
  } catch (err) {
    // Benchmarks are optional — silently ignore
  }
}

/**
 * @description Handle benchmark checkbox changes. Enforce max 3 selection.
 */
function handleBenchmarkChange() {
  var boxes = document.querySelectorAll(".bm-checkbox");
  var selected = [];
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].checked) selected.push(parseInt(boxes[i].value, 10));
  }

  // Enforce max 3
  if (selected.length > 3) {
    this.checked = false;
    document.getElementById("benchmark-max-msg").classList.remove("hidden");
    setTimeout(function () {
      document.getElementById("benchmark-max-msg").classList.add("hidden");
    }, 2000);
    return;
  }

  selectedBenchmarkIds = selected;

  // Clear cached data and reload
  leagueData = null;
  comparisonData = null;
  loadCurrentView();
}

/**
 * @description Build the benchmarks query parameter string.
 * @returns {string} e.g. "&benchmarks=1,3" or ""
 */
function benchmarksParam() {
  if (selectedBenchmarkIds.length === 0) return "";
  return "&benchmarks=" + selectedBenchmarkIds.join(",");
}

// ─── Investment filters ──────────────────────────────────────────

/**
 * @description Build the holdings and users query parameter string for API calls.
 * @returns {string} e.g. "&holdings=current&users=1,2"
 */
function filterParams() {
  var params = "&holdings=" + holdingsFilter;
  if (selectedUserIds.length > 0 && selectedUserIds.length < allUsers.length) {
    params += "&users=" + selectedUserIds.join(",");
  }
  return params;
}

/**
 * @description Clear all cached view data so the next load fetches fresh data.
 */
function clearCachedData() {
  leagueData = null;
  comparisonData = null;
  leagueBenchmarkData = null;
}

/**
 * @description Fetch all users and populate the user filter dropdown.
 */
async function loadUsers() {
  try {
    var result = await apiRequest("/api/users");
    if (!result.ok || !Array.isArray(result.data)) return;

    allUsers = result.data;
    selectedUserIds = allUsers.map(function (u) { return u.id; });

    renderUserDropdown();
    updateUserFilterLabel();
  } catch (err) {
    // Users are required — but if the API fails, degrade gracefully
  }
}

/**
 * @description Render the user filter dropdown checkboxes.
 */
function renderUserDropdown() {
  var dropdown = document.getElementById("user-filter-dropdown");
  var html = "";

  // "Select all" option
  html += '<label class="flex items-center gap-2 px-3 py-1.5 hover:bg-brand-50 cursor-pointer border-b border-brand-100">';
  html += '<input type="checkbox" id="user-select-all" checked class="rounded" />';
  html += '<span class="text-sm font-medium text-brand-700">Select all</span>';
  html += "</label>";

  // Individual user checkboxes
  for (var i = 0; i < allUsers.length; i++) {
    var user = allUsers[i];
    html += '<label class="flex items-center gap-2 px-3 py-1.5 hover:bg-brand-50 cursor-pointer">';
    html += '<input type="checkbox" class="user-checkbox rounded" value="' + user.id + '" checked />';
    html += '<span class="text-sm text-brand-700">' + escapeHtml(user.first_name + " " + user.last_name) + "</span>";
    html += "</label>";
  }

  dropdown.innerHTML = html;

  // Set up "Select all" handler
  var selectAll = document.getElementById("user-select-all");
  selectAll.addEventListener("change", function () {
    var boxes = dropdown.querySelectorAll(".user-checkbox");
    for (var j = 0; j < boxes.length; j++) {
      boxes[j].checked = selectAll.checked;
    }
    updateSelectedUserIds();
  });

  // Set up individual checkbox handlers
  var boxes = dropdown.querySelectorAll(".user-checkbox");
  for (var k = 0; k < boxes.length; k++) {
    boxes[k].addEventListener("change", function () {
      updateSelectAllState();
      updateSelectedUserIds();
    });
  }
}

/**
 * @description Sync the "Select all" checkbox state based on individual checkboxes.
 */
function updateSelectAllState() {
  var boxes = document.querySelectorAll(".user-checkbox");
  var allChecked = true;
  for (var i = 0; i < boxes.length; i++) {
    if (!boxes[i].checked) { allChecked = false; break; }
  }
  var selectAll = document.getElementById("user-select-all");
  if (selectAll) selectAll.checked = allChecked;
}

/**
 * @description Read selected user IDs from checkboxes, enforce at least one selected,
 * update state and reload the current view.
 */
function updateSelectedUserIds() {
  var boxes = document.querySelectorAll(".user-checkbox");
  var ids = [];
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].checked) ids.push(parseInt(boxes[i].value, 10));
  }

  // Enforce at least one user selected
  if (ids.length === 0) {
    // Re-check the first user
    if (boxes.length > 0) {
      boxes[0].checked = true;
      ids.push(parseInt(boxes[0].value, 10));
    }
    updateSelectAllState();
  }

  selectedUserIds = ids;
  updateUserFilterLabel();
  clearCachedData();
  loadCurrentView();
}

/**
 * @description Update the user filter button label based on the current selection.
 */
function updateUserFilterLabel() {
  var label = document.getElementById("user-filter-label");
  if (!label) return;

  if (selectedUserIds.length === allUsers.length) {
    label.textContent = "All users";
  } else if (selectedUserIds.length <= 2) {
    // Show user names when 1-2 selected
    var names = [];
    for (var i = 0; i < allUsers.length; i++) {
      for (var j = 0; j < selectedUserIds.length; j++) {
        if (allUsers[i].id === selectedUserIds[j]) {
          names.push(allUsers[i].first_name);
          break;
        }
      }
    }
    label.textContent = names.join(", ");
  } else {
    label.textContent = selectedUserIds.length + " of " + allUsers.length + " users";
  }
}

/**
 * @description Set up the holdings filter dropdown change handler.
 */
function setupHoldingsFilter() {
  var select = document.getElementById("holdings-filter");
  if (!select) return;

  select.addEventListener("change", function () {
    holdingsFilter = this.value;

    // Disable/enable user filter when "All investments" is selected
    var userBtn = document.getElementById("user-filter-btn");
    var userLabel = document.getElementById("user-filter-label-prefix");
    if (holdingsFilter === "all") {
      userBtn.disabled = true;
      userBtn.classList.add("opacity-50", "cursor-not-allowed");
      userLabel.classList.add("opacity-50");
    } else {
      userBtn.disabled = false;
      userBtn.classList.remove("opacity-50", "cursor-not-allowed");
      userLabel.classList.remove("opacity-50");
    }

    clearCachedData();
    loadCurrentView();
  });
}

/**
 * @description Set up the user filter dropdown toggle and close-on-outside-click behaviour.
 */
function setupUserFilter() {
  var btn = document.getElementById("user-filter-btn");
  var dropdown = document.getElementById("user-filter-dropdown");
  if (!btn || !dropdown) return;

  // Toggle dropdown on button click
  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    dropdown.classList.toggle("hidden");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function (evt) {
    var container = document.getElementById("user-filter-container");
    if (container && !container.contains(evt.target)) {
      dropdown.classList.add("hidden");
    }
  });
}

// ─── Tabs ────────────────────────────────────────────────────────

/**
 * @description Set up click handlers for the tab buttons.
 */
function setupTabs() {
  var tabs = document.querySelectorAll(".analysis-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () {
      activateTab(this.getAttribute("data-tab"));
    });
  }
}

/**
 * @description Activate a tab and show the corresponding view.
 * @param {string} tabName - "comparison", "league", "scatter", or "topbottom"
 */
function activateTab(tabName) {
  activeTab = tabName;

  // Update tab button styles
  var tabs = document.querySelectorAll(".analysis-tab");
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    if (tab.getAttribute("data-tab") === tabName) {
      tab.classList.add("bg-white", "text-brand-800", "border", "border-b-white", "border-brand-200", "-mb-px");
      tab.classList.remove("text-brand-500", "hover:text-brand-700");
    } else {
      tab.classList.remove("bg-white", "text-brand-800", "border", "border-b-white", "border-brand-200", "-mb-px");
      tab.classList.add("text-brand-500", "hover:text-brand-700");
    }
  }

  // Show/hide views
  var views = document.querySelectorAll(".analysis-view");
  for (var j = 0; j < views.length; j++) {
    views[j].classList.add("hidden");
  }
  var viewMap = {
    comparison: "comparison-view",
    league: "league-view",
    scatter: "scatter-view",
    topbottom: "topbottom-view",
  };
  document.getElementById(viewMap[tabName]).classList.remove("hidden");

  // Hide period selector for comparison tab (it has its own period dropdowns)
  var periodSelector = document.getElementById("period-selector");
  periodSelector.style.display = tabName === "comparison" ? "none" : "";

  loadCurrentView();
}

// ─── Period buttons ──────────────────────────────────────────────

/**
 * @description Set up click handlers for the period buttons.
 */
function setupPeriodButtons() {
  var btns = document.querySelectorAll(".period-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      activatePeriod(this.getAttribute("data-period"));
    });
  }
}

/**
 * @description Highlight the period button matching activePeriod and reset others.
 */
function highlightActivePeriod() {
  var btns = document.querySelectorAll(".period-btn");
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    if (btn.getAttribute("data-period") === activePeriod) {
      btn.classList.add("bg-brand-700", "text-white", "border-brand-700");
      btn.classList.remove("border-brand-300", "text-brand-600", "hover:bg-brand-50");
    } else {
      btn.classList.remove("bg-brand-700", "text-white", "border-brand-700");
      btn.classList.add("border-brand-300", "text-brand-600", "hover:bg-brand-50");
    }
  }
}

/**
 * @description Activate a period and reload the current view.
 * @param {string} period - Period code (e.g. "1y")
 */
function activatePeriod(period) {
  activePeriod = period;
  leagueData = null;
  highlightActivePeriod();

  loadCurrentView();
}

// ─── Sort buttons (league table) ─────────────────────────────────

/**
 * @description Set up click handlers for the sort buttons.
 */
function setupSortButtons() {
  var btns = document.querySelectorAll(".sort-btn");
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      var sortKey = this.getAttribute("data-sort");
      if (sortKey === leagueSort) {
        leagueSortDir = leagueSortDir === "desc" ? "asc" : "desc";
      } else {
        leagueSort = sortKey;
        leagueSortDir = this.getAttribute("data-dir") || "asc";
      }
      updateSortButtonStyles();
      if (leagueData) {
        renderLeagueTable(leagueData);
      }
    });
  }
}

/**
 * @description Update sort button styles to reflect current sort state.
 */
function updateSortButtonStyles() {
  var btns = document.querySelectorAll(".sort-btn");
  for (var i = 0; i < btns.length; i++) {
    var btn = btns[i];
    var key = btn.getAttribute("data-sort");
    if (key === leagueSort) {
      btn.classList.add("underline");
      var arrow = leagueSortDir === "desc" ? " \u2193" : " \u2191";
      btn.textContent = (key === "return" ? "Return" : key === "name" ? "Name" : "Type") + arrow;
    } else {
      btn.classList.remove("underline");
      btn.textContent = key === "return" ? "Return" : key === "name" ? "Name" : "Type";
    }
  }
}

// ─── League limit ────────────────────────────────────────────────

/**
 * @description Set up the league table limit selector.
 */
function setupLeagueLimit() {
  var sel = document.getElementById("league-limit");
  if (!sel) return;
  sel.addEventListener("change", function () {
    leagueLimit = this.value;
    if (leagueData) {
      renderLeagueTable(leagueData);
    }
  });
}

// ─── Data loading ────────────────────────────────────────────────

/**
 * @description Load data for the currently active view.
 */
async function loadCurrentView() {
  if (activeTab === "comparison") {
    await loadComparison();
  } else if (activeTab === "league") {
    await loadLeagueTable();
  } else if (activeTab === "scatter") {
    await loadScatter();
  } else if (activeTab === "topbottom") {
    await loadTopBottom();
  }
}

// ─── Comparison table ────────────────────────────────────────────

/**
 * @description Fetch and render the multi-period comparison table.
 */
async function loadComparison() {
  var container = document.getElementById("comparison-table-container");
  container.innerHTML = '<p class="text-brand-500">Loading comparison...</p>';

  var url = "/api/analysis/comparison?periods=" + comparisonPeriods.join(",") + benchmarksParam() + filterParams();
  var result = await apiRequest(url);
  if (!result.ok) {
    container.innerHTML = '<p class="text-error">' + escapeHtml(result.error) + "</p>";
    return;
  }

  comparisonData = result.data;
  renderComparisonTable(result.data);
}

/**
 * @description Render the comparison table with sortable period columns.
 * @param {Object} data - Comparison data from the API
 */
function renderComparisonTable(data) {
  var periods = data.periods;
  var investments = data.investments.slice();
  var benchmarks = data.benchmarks || [];

  // Sort investments by the active sort column
  var sortCode = periods[comparisonSortCol] ? periods[comparisonSortCol].code : null;
  if (sortCode) {
    investments.sort(function (a, b) {
      var aVal = a.returns[sortCode];
      var bVal = b.returns[sortCode];
      // Nulls go to bottom
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      var diff = aVal - bVal;
      return comparisonSortDir === "desc" ? -diff : diff;
    });
  }

  var html = '<table class="w-full text-base">';

  // Header row with period dropdowns
  html += '<thead><tr class="bg-brand-100 text-brand-700 text-sm">';
  html += '<th class="px-3 py-2 text-left w-10">#</th>';
  html += '<th class="px-3 py-2 text-left">Investment</th>';
  html += '<th class="px-3 py-2 text-left w-16">Type</th>';

  for (var p = 0; p < periods.length; p++) {
    var arrow = "";
    if (p === comparisonSortCol) {
      arrow = comparisonSortDir === "desc" ? " \u2193" : " \u2191";
    }
    html += '<th class="px-3 py-2 text-right w-28">';
    html += '<select class="comparison-period-select text-xs border border-brand-300 rounded px-1 py-0.5 bg-white mr-1" data-col="' + p + '">';
    for (var ap = 0; ap < ALL_PERIODS.length; ap++) {
      var sel = ALL_PERIODS[ap] === periods[p].code ? " selected" : "";
      html += '<option value="' + ALL_PERIODS[ap] + '"' + sel + '>' + PERIOD_DISPLAY[ALL_PERIODS[ap]] + "</option>";
    }
    html += "</select>";
    html += '<span class="comparison-sort-btn cursor-pointer hover:text-brand-900" data-col="' + p + '">Return' + arrow + "</span>";
    html += "</th>";
  }
  html += "</tr></thead><tbody>";

  // Benchmark rows (grey background)
  for (var b = 0; b < benchmarks.length; b++) {
    var bm = benchmarks[b];
    html += '<tr class="bg-brand-50 border-b border-brand-100">';
    html += '<td class="px-3 py-2 text-brand-400 text-sm"></td>';
    html += '<td class="px-3 py-2 font-medium text-brand-600">' + escapeHtml(bm.description) + "</td>";
    html += '<td class="px-3 py-2 text-sm text-brand-400">Benchmark</td>';
    for (var bp = 0; bp < periods.length; bp++) {
      var bmVal = bm.returns[periods[bp].code];
      html += '<td class="px-3 py-2 text-right font-medium ' + returnColourClass(bmVal) + '">' + formatReturn(bmVal) + "</td>";
    }
    html += "</tr>";
  }

  // Investment rows
  for (var i = 0; i < investments.length; i++) {
    var inv = investments[i];
    var rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-25";
    var nameHtml = buildResearchLinkHtml(inv.description, inv.publicId, inv.currencyCode, inv.morningstarId);

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="px-3 py-2 text-brand-400 text-sm">' + (i + 1) + "</td>";
    html += '<td class="px-3 py-2">' + nameHtml + "</td>";
    html += '<td class="px-3 py-2 text-sm text-brand-500">' + escapeHtml(properCase(inv.typeShort)) + "</td>";
    for (var ip = 0; ip < periods.length; ip++) {
      var val = inv.returns[periods[ip].code];
      html += '<td class="px-3 py-2 text-right font-medium ' + returnColourClass(val) + '">' + formatReturn(val) + "</td>";
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  var container = document.getElementById("comparison-table-container");
  container.innerHTML = html;

  // Set up period dropdown change handlers
  var selects = container.querySelectorAll(".comparison-period-select");
  for (var s = 0; s < selects.length; s++) {
    selects[s].addEventListener("change", function () {
      var col = parseInt(this.getAttribute("data-col"), 10);
      comparisonPeriods[col] = this.value;
      comparisonData = null;
      loadComparison();
    });
  }

  // Set up column sort handlers
  var sortBtns = container.querySelectorAll(".comparison-sort-btn");
  for (var sb = 0; sb < sortBtns.length; sb++) {
    sortBtns[sb].addEventListener("click", function () {
      var col = parseInt(this.getAttribute("data-col"), 10);
      if (col === comparisonSortCol) {
        comparisonSortDir = comparisonSortDir === "desc" ? "asc" : "desc";
      } else {
        comparisonSortCol = col;
        comparisonSortDir = "desc";
      }
      if (comparisonData) renderComparisonTable(comparisonData);
    });
  }
}

/**
 * @description Convert an uppercase string to proper case (e.g. "SHARE" → "Share").
 * @param {string} str - The string to convert
 * @returns {string} Proper case string
 */
function properCase(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * @description Get the CSS colour class for a return value.
 * @param {number|null} val - Return percentage
 * @returns {string} Tailwind colour class
 */
function returnColourClass(val) {
  if (val === null || val === undefined) return "text-brand-400";
  return val >= 0 ? "text-green-700" : "text-red-600";
}

/**
 * @description Format a return value for display.
 * @param {number|null} val - Return percentage
 * @returns {string} Formatted string like "+5.23%" or "—"
 */
function formatReturn(val) {
  if (val === null || val === undefined) return "\u2014";
  var sign = val >= 0 ? "+" : "";
  return sign + val.toFixed(2) + "%";
}

// ─── League table ────────────────────────────────────────────────

/**
 * @description Fetch and render the league table.
 */
async function loadLeagueTable() {
  var container = document.getElementById("league-table-container");
  container.innerHTML = '<p class="text-brand-500">Loading league table...</p>';

  var result = await apiRequest("/api/analysis/league-table?period=" + activePeriod + filterParams());
  if (!result.ok) {
    container.innerHTML = '<p class="text-error">' + escapeHtml(result.error) + "</p>";
    return;
  }

  // Fetch benchmark returns for the same period if benchmarks are selected
  leagueBenchmarkData = null;
  if (selectedBenchmarkIds.length > 0) {
    var bmResult = await apiRequest("/api/analysis/risk-return?period=" + activePeriod + benchmarksParam());
    if (bmResult.ok && bmResult.data.benchmarks) {
      leagueBenchmarkData = bmResult.data.benchmarks;
    }
  }

  leagueData = result.data;
  document.getElementById("period-info").textContent = result.data.periodLabel + " \u2014 " + result.data.investments.length + " investments \u2014 as of " + result.data.asOf;
  renderLeagueTable(result.data);
}

/**
 * @description Render the league table HTML from data, applying current sort and limit.
 * @param {Object} data - League table data from the API
 */
function renderLeagueTable(data) {
  // First sort by return desc to determine top/bottom for limit filtering
  var byReturn = data.investments.slice().sort(function (a, b) {
    return b.returnPct - a.returnPct;
  });

  // Apply limit filter
  var filtered;
  var totalCount = byReturn.length;
  if (leagueLimit === "top10") {
    filtered = byReturn.slice(0, Math.min(10, totalCount));
  } else if (leagueLimit === "top20") {
    filtered = byReturn.slice(0, Math.min(20, totalCount));
  } else if (leagueLimit === "bottom10") {
    filtered = byReturn.slice(Math.max(0, totalCount - 10));
  } else if (leagueLimit === "bottom20") {
    filtered = byReturn.slice(Math.max(0, totalCount - 20));
  } else {
    filtered = byReturn;
  }

  // Now apply the display sort to the filtered set
  var investments = filtered.slice();
  investments.sort(function (a, b) {
    var val;
    if (leagueSort === "return") {
      val = a.returnPct - b.returnPct;
    } else if (leagueSort === "name") {
      val = a.description.localeCompare(b.description);
    } else if (leagueSort === "type") {
      val = (a.typeShort || "").localeCompare(b.typeShort || "");
    } else {
      val = 0;
    }
    return leagueSortDir === "desc" ? -val : val;
  });

  // Update period info with limit context
  var limitLabel = "";
  if (leagueLimit !== "all") {
    var limitMap = { top10: "Top 10", top20: "Top 20", bottom10: "Bottom 10", bottom20: "Bottom 20" };
    limitLabel = limitMap[leagueLimit] + " of ";
  }
  document.getElementById("period-info").textContent = data.periodLabel + " \u2014 " + limitLabel + totalCount + " investments \u2014 as of " + data.asOf;

  var html = '<table class="w-full text-base">';
  html += '<thead><tr class="bg-brand-100 text-brand-700 text-sm">';
  html += '<th class="px-3 py-2 text-left w-10">#</th>';
  html += '<th class="px-3 py-2 text-left">Investment</th>';
  html += '<th class="px-3 py-2 text-left w-16">Type</th>';
  html += '<th class="px-3 py-2 text-center w-32">Trend</th>';
  html += '<th class="px-3 py-2 text-right w-24">Return</th>';
  html += "</tr></thead><tbody>";

  // Benchmark rows at top (grey background, no sparkline)
  var bmRows = leagueBenchmarkData || [];
  for (var bm = 0; bm < bmRows.length; bm++) {
    var bmItem = bmRows[bm];
    var bmReturnClass = bmItem.returnPct >= 0 ? "text-green-700" : "text-red-600";
    var bmReturnSign = bmItem.returnPct >= 0 ? "+" : "";
    html += '<tr class="bg-brand-50 border-b border-brand-100">';
    html += '<td class="px-3 py-2 text-brand-400 text-sm"></td>';
    html += '<td class="px-3 py-2 font-medium text-brand-600">' + escapeHtml(bmItem.description) + "</td>";
    html += '<td class="px-3 py-2 text-sm text-brand-400">Benchmark</td>';
    html += '<td class="px-3 py-2 text-center"></td>';
    html += '<td class="px-3 py-2 text-right font-medium ' + bmReturnClass + '">' + bmReturnSign + bmItem.returnPct.toFixed(2) + "%</td>";
    html += "</tr>";
  }

  for (var i = 0; i < investments.length; i++) {
    var inv = investments[i];
    var rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-25";
    var returnClass = inv.returnPct >= 0 ? "text-green-700" : "text-red-600";
    var returnSign = inv.returnPct >= 0 ? "+" : "";
    var nameHtml = buildResearchLinkHtml(inv.description, inv.publicId, inv.currencyCode, inv.morningstarId);

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="px-3 py-2 text-brand-400 text-sm">' + (i + 1) + "</td>";
    html += '<td class="px-3 py-2">' + nameHtml + "</td>";
    html += '<td class="px-3 py-2 text-sm text-brand-500">' + escapeHtml(properCase(inv.typeShort)) + "</td>";
    html += '<td class="px-3 py-2 text-center"><canvas id="spark-' + inv.id + '" width="120" height="30" class="inline-block"></canvas></td>';
    html += '<td class="px-3 py-2 text-right font-medium ' + returnClass + '">' + returnSign + inv.returnPct.toFixed(2) + "%</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  document.getElementById("league-table-container").innerHTML = html;

  // Render sparklines after DOM update
  requestAnimationFrame(function () {
    for (var j = 0; j < investments.length; j++) {
      renderSparkline(investments[j]);
    }
  });
}

/**
 * @description Render a sparkline chart in a small canvas for a league table row.
 * @param {Object} inv - Investment object with id, sparkline array, returnPct
 */
function renderSparkline(inv) {
  var canvas = document.getElementById("spark-" + inv.id);
  if (!canvas || !inv.sparkline || inv.sparkline.length < 2) return;

  var ctx = canvas.getContext("2d");
  var lineColour = inv.returnPct >= 0 ? "rgba(21, 128, 61, 0.8)" : "rgba(220, 38, 38, 0.8)";

  var labels = [];
  var dataPoints = [];
  for (var i = 0; i < inv.sparkline.length; i++) {
    if (inv.sparkline[i] !== null) {
      labels.push(i);
      dataPoints.push(inv.sparkline[i]);
    }
  }

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        data: dataPoints,
        borderColor: lineColour,
        borderWidth: 1.5,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      }],
    },
    options: {
      animation: false,
      responsive: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
    },
  });
}

// ─── Scatter plot ────────────────────────────────────────────────

/**
 * @description Fetch and render the risk vs return scatter plot.
 */
async function loadScatter() {
  document.getElementById("period-info").textContent = "Loading...";

  var url = "/api/analysis/risk-return?period=" + activePeriod + benchmarksParam() + filterParams();
  var result = await apiRequest(url);
  if (!result.ok) {
    document.getElementById("period-info").textContent = result.error;
    return;
  }

  var bmCount = result.data.benchmarks ? result.data.benchmarks.length : 0;
  var bmLabel = bmCount > 0 ? " + " + bmCount + " benchmark" + (bmCount > 1 ? "s" : "") : "";
  document.getElementById("period-info").textContent = result.data.periodLabel + " \u2014 " + result.data.investments.length + " investments" + bmLabel + " \u2014 as of " + result.data.asOf;
  renderScatter(result.data);
}

/**
 * @description Render the scatter plot using Chart.js with quadrant labels and legend.
 * @param {Object} data - Risk/return data from the API
 */
function renderScatter(data) {
  if (scatterChart) {
    scatterChart.destroy();
    scatterChart = null;
  }

  var canvas = document.getElementById("scatter-chart");
  var ctx = canvas.getContext("2d");

  var points = data.investments.map(function (inv) {
    return { x: inv.volatility, y: inv.returnPct, label: inv.description };
  });

  // Calculate medians for quadrant lines
  var xValues = points.map(function (p) { return p.x; }).sort(function (a, b) { return a - b; });
  var yValues = points.map(function (p) { return p.y; }).sort(function (a, b) { return a - b; });
  var medianX = xValues.length > 0 ? xValues[Math.floor(xValues.length / 2)] : 0;
  var medianY = yValues.length > 0 ? yValues[Math.floor(yValues.length / 2)] : 0;

  var datasets = [{
    label: "Investments",
    data: points,
    backgroundColor: points.map(function (p) {
      if (p.y >= medianY && p.x <= medianX) return "rgba(21, 128, 61, 0.7)";
      if (p.y < medianY && p.x > medianX) return "rgba(220, 38, 38, 0.7)";
      return "rgba(59, 130, 246, 0.7)";
    }),
    pointRadius: 7,
    pointHoverRadius: 10,
  }];

  // Add benchmark points as triangles if present
  var hasBenchmarks = data.benchmarks && data.benchmarks.length > 0;
  if (hasBenchmarks) {
    var bmPoints = [];
    for (var b = 0; b < data.benchmarks.length; b++) {
      var bm = data.benchmarks[b];
      if (bm.volatility !== null) {
        bmPoints.push({ x: bm.volatility, y: bm.returnPct, label: bm.description });
      }
    }
    if (bmPoints.length > 0) {
      datasets.push({
        label: "Benchmarks",
        data: bmPoints,
        backgroundColor: "rgba(107, 114, 128, 0.8)",
        pointStyle: "triangle",
        pointRadius: 9,
        pointHoverRadius: 12,
      });
    }
  }

  scatterChart = new Chart(ctx, {
    type: "scatter",
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              var pt = context.raw;
              return pt.label + ": Return " + pt.y.toFixed(2) + "%, Volatility " + pt.x.toFixed(2) + "%";
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Volatility (annualised %)", font: { size: 14 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y: {
          title: { display: true, text: "Return (%)", font: { size: 14 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
      },
    },
    plugins: [{
      id: "quadrantLines",
      afterDraw: function (chart) {
        var xAxis = chart.scales.x;
        var yAxis = chart.scales.y;
        var ctxDraw = chart.ctx;

        ctxDraw.save();

        // Draw median dashed lines
        ctxDraw.strokeStyle = "rgba(0,0,0,0.15)";
        ctxDraw.lineWidth = 1;
        ctxDraw.setLineDash([5, 5]);

        var medXPx = xAxis.getPixelForValue(medianX);
        ctxDraw.beginPath();
        ctxDraw.moveTo(medXPx, yAxis.top);
        ctxDraw.lineTo(medXPx, yAxis.bottom);
        ctxDraw.stroke();

        var medYPx = yAxis.getPixelForValue(medianY);
        ctxDraw.beginPath();
        ctxDraw.moveTo(xAxis.left, medYPx);
        ctxDraw.lineTo(xAxis.right, medYPx);
        ctxDraw.stroke();

        // Draw quadrant labels
        ctxDraw.setLineDash([]);
        ctxDraw.fillStyle = "rgba(0,0,0,0.10)";
        ctxDraw.font = "13px sans-serif";

        // Top-left: Strong & Steady
        ctxDraw.textAlign = "left";
        ctxDraw.textBaseline = "top";
        ctxDraw.fillText("Strong & Steady", xAxis.left + 8, yAxis.top + 8);

        // Top-right: High Reward, High Risk
        ctxDraw.textAlign = "right";
        ctxDraw.textBaseline = "top";
        ctxDraw.fillText("High Reward, High Risk", xAxis.right - 8, yAxis.top + 8);

        // Bottom-left: Steady but Weak
        ctxDraw.textAlign = "left";
        ctxDraw.textBaseline = "bottom";
        ctxDraw.fillText("Steady but Weak", xAxis.left + 8, yAxis.bottom - 8);

        // Bottom-right: Review
        ctxDraw.textAlign = "right";
        ctxDraw.textBaseline = "bottom";
        ctxDraw.fillText("Review", xAxis.right - 8, yAxis.bottom - 8);

        ctxDraw.restore();
      },
    }],
  });

  // Build colour legend
  var legendHtml = "";
  legendHtml += '<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-full" style="background:rgba(21,128,61,0.7)"></span>High return, low volatility</span>';
  legendHtml += '<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-full" style="background:rgba(220,38,38,0.7)"></span>Low return, high volatility</span>';
  legendHtml += '<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-full" style="background:rgba(59,130,246,0.7)"></span>Other</span>';
  if (hasBenchmarks) {
    legendHtml += '<span class="inline-flex items-center gap-1.5"><span class="inline-block" style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid rgba(107,114,128,0.8)"></span>Benchmark</span>';
  }
  document.getElementById("scatter-legend").innerHTML = legendHtml;
}

// ─── Top / Bottom performers ─────────────────────────────────────

/** @type {Array<string>} Line colours matching the PDF report palette for visual consistency */
var LINE_COLOURS = [
  "rgb(59, 130, 245)",  // blue
  "rgb(250, 115, 23)",  // orange
  "rgb(240, 69, 69)",   // red
  "rgb(33, 196, 94)",   // green
  "rgb(168, 85, 247)",  // purple
  "rgb(5, 181, 212)",   // cyan
  "rgb(237, 74, 153)",  // pink
  "rgb(235, 179, 8)",   // yellow
  "rgb(99, 102, 241)",  // indigo
  "rgb(20, 184, 166)",  // teal
];

/** @type {Array<string>} Colours for top performers — first 5 from shared palette */
var TOP_COLOURS = LINE_COLOURS.slice(0, 5);

/** @type {Array<string>} Colours for bottom performers — next 5 from shared palette */
var BOTTOM_COLOURS = LINE_COLOURS.slice(5, 10);

/** @type {Array<string>} Distinct colours for benchmark reference lines */
var BENCHMARK_COLOURS = [
  "rgb(107, 114, 128)", // grey
  "rgb(71, 85, 105)",   // slate
  "rgb(120, 113, 108)", // stone
];

/**
 * @description Get dash pattern and line width for a benchmark line based on
 * its index and the total number of benchmarks shown.
 * 1 benchmark:  dotted / medium (1.5)
 * 2 benchmarks: dotted / light (1) then dashed / bold (2.5)
 * 3 benchmarks: dotted / light (1) then dashed / medium (1.5) then dash-dot / bold (2.5)
 * @param {number} index - Zero-based index of this benchmark
 * @param {number} total - Total number of benchmarks (1-3)
 * @returns {{borderDash: Array<number>, borderWidth: number}}
 */
function getBenchmarkLineStyle(index, total) {
  if (total === 1) {
    return { borderDash: [2, 3], borderWidth: 1.5 };
  }
  if (total === 2) {
    if (index === 0) return { borderDash: [2, 3], borderWidth: 1 };
    return { borderDash: [8, 4], borderWidth: 2.5 };
  }
  // total === 3
  if (index === 0) return { borderDash: [2, 3], borderWidth: 1 };
  if (index === 1) return { borderDash: [8, 4], borderWidth: 1.5 };
  return { borderDash: [8, 3, 2, 3], borderWidth: 2.5 };
}

/**
 * @description Fetch and render the top/bottom performers as two separate charts.
 */
async function loadTopBottom() {
  document.getElementById("period-info").textContent = "Loading...";

  var url = "/api/analysis/top-bottom?period=" + activePeriod + "&count=5" + benchmarksParam() + filterParams();
  var result = await apiRequest(url);
  if (!result.ok) {
    document.getElementById("period-info").textContent = result.error;
    return;
  }

  var d = result.data;
  document.getElementById("period-info").textContent = d.periodLabel + " \u2014 Top " + d.topSeries.length + " and Bottom " + d.bottomSeries.length + " \u2014 as of " + d.asOf;

  var bmSeries = d.benchmarkSeries || [];

  renderPerformanceChart("top-chart", "top-legend", d.topSeries, TOP_COLOURS, bmSeries, d.sampleDates);
  renderPerformanceChart("bottom-chart", "bottom-legend", d.bottomSeries, BOTTOM_COLOURS, bmSeries, d.sampleDates);
}

/** @type {Array<string>} Short month names for UK date formatting */
var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * @description Format an ISO date string as "DD Mon" for short periods or "Mon YY" for long.
 * Short periods (1W, 1M, 3M) need day resolution; longer periods benefit from year context.
 * @param {string} isoDate - Date in YYYY-MM-DD format
 * @param {boolean} longPeriod - True for periods ≥6M where "Mon YY" is more useful
 * @returns {string} Formatted date label
 */
function formatDateLabel(isoDate, longPeriod) {
  var parts = isoDate.split("-");
  var day = parseInt(parts[2], 10);
  var monthIdx = parseInt(parts[1], 10) - 1;
  if (longPeriod) {
    return MONTH_NAMES[monthIdx] + " " + parts[0].substring(2);
  }
  return day + " " + MONTH_NAMES[monthIdx];
}

/** @type {Object} Period codes that are considered "long" (≥6 months) for date formatting */
var LONG_PERIODS = { "6m": true, "1y": true, "2y": true, "3y": true };

/**
 * @description Format an ISO date string as full UK date for tooltips (e.g. "16 Mar 2025").
 * @param {string} isoDate - Date in YYYY-MM-DD format
 * @returns {string} Formatted date with year
 */
function formatDateFull(isoDate) {
  var parts = isoDate.split("-");
  var day = parseInt(parts[2], 10);
  var monthIdx = parseInt(parts[1], 10) - 1;
  return day + " " + MONTH_NAMES[monthIdx] + " " + parts[0];
}

/**
 * @description Build year boundary info from ISO date strings for year-band shading.
 * Returns array of objects marking where each calendar year starts in the label array.
 * @param {Array<string>} isoDates - ISO date strings
 * @returns {Array<{index: number, year: string}>} Year boundary positions
 */
function getYearBoundaries(isoDates) {
  var boundaries = [];
  var currentYear = "";
  for (var i = 0; i < isoDates.length; i++) {
    var year = isoDates[i].substring(0, 4);
    if (year !== currentYear) {
      boundaries.push({ index: i, year: year });
      currentYear = year;
    }
  }
  return boundaries;
}

/**
 * @description Chart.js plugin that draws faint alternating year-band shading
 * and year labels. Only draws bands when data spans more than one calendar year.
 */
var yearBandsPlugin = {
  id: "yearBands",
  beforeDraw: function (chart) {
    var boundaries = chart.options._yearBoundaries;
    if (!boundaries || boundaries.length < 2) return;

    var xAxis = chart.scales.x;
    var yAxis = chart.scales.y;
    var ctx = chart.ctx;
    ctx.save();

    for (var i = 0; i < boundaries.length; i++) {
      var startIdx = boundaries[i].index;
      var endIdx = (i + 1 < boundaries.length) ? boundaries[i + 1].index : chart.data.labels.length - 1;

      var x1 = xAxis.getPixelForValue(startIdx);
      var x2 = xAxis.getPixelForValue(endIdx);

      // Alternating faint shading on even-indexed bands
      if (i % 2 === 1) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
        ctx.fillRect(x1, yAxis.top, x2 - x1, yAxis.bottom - yAxis.top);
      }

      // Year label at the start of each band
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(boundaries[i].year, x1 + 4, yAxis.top + 4);
    }

    ctx.restore();
  },
};

/**
 * @description Render a performance line chart (used for both top and bottom charts).
 * @param {string} canvasId - Canvas element ID
 * @param {string} legendId - Legend container element ID
 * @param {Array<Object>} series - Investment series data
 * @param {Array<string>} colours - Colour palette for investment lines
 * @param {Array<Object>} bmSeries - Benchmark series data (grey dashed lines)
 * @param {Array<string>} isoDates - ISO date strings (YYYY-MM-DD) for x-axis
 */
function renderPerformanceChart(canvasId, legendId, series, colours, bmSeries, isoDates) {
  var isLong = LONG_PERIODS[activePeriod] || false;
  var labels = isoDates.map(function (d) { return formatDateLabel(d, isLong); });

  // Destroy existing chart on this canvas
  var canvas = document.getElementById(canvasId);
  var existingChart = Chart.getChart(canvas);
  if (existingChart) existingChart.destroy();

  var ctx = canvas.getContext("2d");
  var datasets = [];

  // Investment series (solid lines, wide hit radius for hover detection)
  for (var i = 0; i < series.length; i++) {
    var s = series[i];
    var sign = s.returnPct >= 0 ? "+" : "";
    datasets.push({
      label: s.label + " (" + sign + s.returnPct.toFixed(1) + "%)",
      data: s.values,
      borderColor: colours[i % colours.length],
      borderWidth: 2,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 12,
      tension: 0.2,
    });
  }

  // Benchmark series (distinct dash patterns per benchmark count)
  for (var b = 0; b < bmSeries.length; b++) {
    var bm = bmSeries[b];
    var bmSign = bm.returnPct !== null && bm.returnPct >= 0 ? "+" : "";
    var bmLabel = bm.label + (bm.returnPct !== null ? " (" + bmSign + bm.returnPct.toFixed(1) + "%)" : "");
    var bmStyle = getBenchmarkLineStyle(b, bmSeries.length);
    datasets.push({
      label: bmLabel,
      data: bm.values,
      borderColor: BENCHMARK_COLOURS[b % BENCHMARK_COLOURS.length],
      borderWidth: bmStyle.borderWidth,
      borderDash: bmStyle.borderDash,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 12,
      tension: 0.2,
    });
  }

  var yearBoundaries = getYearBoundaries(isoDates);

  var chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      _yearBoundaries: yearBoundaries,
      _isoDates: isoDates,
      interaction: {
        mode: "nearest",
        axis: "xy",
        intersect: false,
      },
      hover: {
        mode: "dataset",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "nearest",
          intersect: false,
          callbacks: {
            title: function (items) {
              if (items.length > 0) return items[0].dataset.label;
              return "";
            },
            afterTitle: function (items) {
              if (items.length > 0) {
                var dates = items[0].chart.options._isoDates;
                if (dates && dates[items[0].dataIndex]) {
                  return formatDateFull(dates[items[0].dataIndex]);
                }
              }
              return "";
            },
            label: function (context) {
              return "Change: " + (context.parsed.y !== null ? context.parsed.y.toFixed(2) + "%" : "N/A");
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.08)" },
          ticks: { maxTicksLimit: 12, font: { size: 11 } },
        },
        y: {
          title: { display: false },
          grid: { color: "rgba(0,0,0,0.08)" },
          ticks: {
            callback: function (value) { return value + "%"; },
          },
        },
      },
    },
    plugins: [yearBandsPlugin, {
      id: "zeroLine",
      afterDraw: function (chart) {
        var yAxis = chart.scales.y;
        var xAxis = chart.scales.x;
        var zeroY = yAxis.getPixelForValue(0);
        if (zeroY >= yAxis.top && zeroY <= yAxis.bottom) {
          var ctxDraw = chart.ctx;
          ctxDraw.save();
          ctxDraw.strokeStyle = "rgba(0,0,0,0.4)";
          ctxDraw.lineWidth = 1.5;
          ctxDraw.beginPath();
          ctxDraw.moveTo(xAxis.left, zeroY);
          ctxDraw.lineTo(xAxis.right, zeroY);
          ctxDraw.stroke();
          ctxDraw.restore();
        }
      },
    }],
  });

  // Build legend with research links and click-to-highlight
  var legendContainer = document.getElementById(legendId);
  var legendHtml = '<div class="flex flex-wrap gap-4 text-sm">';
  for (var sl = 0; sl < series.length; sl++) {
    var ser = series[sl];
    var colour = colours[sl % colours.length];
    var linkHtml = buildResearchLinkHtml(ser.label, ser.publicId, ser.currencyCode, ser.morningstarId);
    legendHtml += '<span class="legend-item inline-flex items-center gap-1 cursor-pointer rounded px-1 py-0.5 hover:bg-brand-100 transition-colors" data-ds-index="' + sl + '">';
    legendHtml += '<span class="inline-block w-3 h-3 rounded-sm" style="background:' + colour + '"></span>';
    legendHtml += linkHtml;
    legendHtml += "</span>";
  }
  for (var bl = 0; bl < bmSeries.length; bl++) {
    var bmColour = BENCHMARK_COLOURS[bl % BENCHMARK_COLOURS.length];
    var bmLegendStyle = getBenchmarkLineStyle(bl, bmSeries.length);
    var strokeW = Math.max(1, Math.round(bmLegendStyle.borderWidth));
    var dashAttr = bmLegendStyle.borderDash.join(",");
    legendHtml += '<span class="legend-item inline-flex items-center gap-1 cursor-pointer rounded px-1 py-0.5 hover:bg-brand-100 transition-colors" data-ds-index="' + (series.length + bl) + '">';
    legendHtml += '<svg width="20" height="6" class="inline-block"><line x1="0" y1="3" x2="20" y2="3" stroke="' + bmColour + '" stroke-width="' + strokeW + '" stroke-dasharray="' + dashAttr + '"/></svg>';
    legendHtml += '<span class="text-brand-500">' + escapeHtml(bmSeries[bl].label) + "</span>";
    legendHtml += "</span>";
  }
  legendHtml += "</div>";
  legendContainer.innerHTML = legendHtml;

  // Legend click: highlight one series, dim others
  var legendItems = legendContainer.querySelectorAll(".legend-item");
  for (var li = 0; li < legendItems.length; li++) {
    legendItems[li].addEventListener("click", function (evt) {
      // Don't interfere with research link clicks
      if (evt.target.tagName === "A" || evt.target.closest("a")) return;

      var dsIndex = parseInt(this.getAttribute("data-ds-index"), 10);
      var meta = chartInstance.getDatasetMeta(dsIndex);

      // Check if this dataset is already highlighted (others are dimmed)
      var isHighlighted = this.classList.contains("ring-2");

      if (isHighlighted) {
        // Reset all datasets to full opacity
        for (var r = 0; r < chartInstance.data.datasets.length; r++) {
          chartInstance.data.datasets[r].borderWidth = r < series.length ? 2.5 : 1.5;
          var origAlpha = r < series.length ? 1 : 1;
          // No opacity change needed — just restore widths
        }
        // Remove highlight ring from all legend items
        var allItems = legendContainer.querySelectorAll(".legend-item");
        for (var ai = 0; ai < allItems.length; ai++) {
          allItems[ai].classList.remove("ring-2", "ring-brand-400", "bg-brand-50");
        }
      } else {
        // Highlight this dataset, dim others
        for (var h = 0; h < chartInstance.data.datasets.length; h++) {
          if (h === dsIndex) {
            chartInstance.data.datasets[h].borderWidth = 4;
          } else {
            chartInstance.data.datasets[h].borderWidth = 1;
          }
        }
        // Update legend styling
        var allLegendItems = legendContainer.querySelectorAll(".legend-item");
        for (var ali = 0; ali < allLegendItems.length; ali++) {
          allLegendItems[ali].classList.remove("ring-2", "ring-brand-400", "bg-brand-50");
        }
        this.classList.add("ring-2", "ring-brand-400", "bg-brand-50");
      }
      chartInstance.update();
    });
  }
}

// ─── Print to PDF ────────────────────────────────────────────────

/**
 * @description Set up the Print to PDF button.
 */
function setupPrintButton() {
  document.getElementById("print-pdf-btn").addEventListener("click", function () {
    var url;
    var bm = benchmarksParam();
    var fp = filterParams();
    if (activeTab === "comparison") {
      url = "/api/analysis/pdf/comparison?periods=" + comparisonPeriods.join(",") + bm + fp;
    } else if (activeTab === "league") {
      url = "/api/analysis/pdf/league-table?period=" + activePeriod + "&sort=" + leagueSort + "&dir=" + leagueSortDir + "&limit=" + leagueLimit + bm + fp;
    } else if (activeTab === "scatter") {
      url = "/api/analysis/pdf/risk-return?period=" + activePeriod + bm + fp;
    } else {
      url = "/api/analysis/pdf/top-bottom?period=" + activePeriod + "&count=5" + bm + fp;
    }
    window.open(url, "_blank");
  });
}
