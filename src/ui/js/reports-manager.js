/**
 * @description Reports Manager page — provides visual CRUD UI for managing
 * PDF report definitions. Supports all report types: household assets,
 * portfolio summary, portfolio detail, chart, chart group, portfolio value
 * chart, and composite (multi-block) reports.
 */

/** @type {Array<Object>} Raw report definitions loaded from the server */
var reportDefinitions = [];

/** @type {Array<{param_key: string, param_value: string}>} Available token mappings */
var reportTokens = [];

// ─── Report type helpers ─────────────────────────────────────────────────────

/** @type {Object<string, string>} Mapping of pdfEndpoint patterns to type labels */
var REPORT_TYPE_LABELS = {
  household_assets: "Household Assets",
  portfolio_summary: "Portfolio Summary",
  portfolio_detail: "Portfolio Detail",
  chart: "Performance Chart",
  chart_group: "Chart Group",
  portfolio_value_chart: "Portfolio Value Chart",
  composite: "Composite",
};

/**
 * @description Detect the report type from its definition structure.
 * @param {Object} report - A report definition object
 * @returns {string} The report type key
 */
function detectReportType(report) {
  if (report.blocks && Array.isArray(report.blocks)) return "composite";
  if (report.charts && Array.isArray(report.charts)) return "chart_group";
  if (!report.pdfEndpoint) return "household_assets";
  if (report.pdfEndpoint.indexOf("portfolio-value") !== -1) return "portfolio_value_chart";
  if (report.pdfEndpoint.indexOf("chart-group") !== -1) return "chart_group";
  if (report.pdfEndpoint.indexOf("chart") !== -1) return "chart";
  if (report.pdfEndpoint.indexOf("portfolio-detail") !== -1) return "portfolio_detail";
  if (report.pdfEndpoint.indexOf("portfolio-summary") !== -1) return "portfolio_summary";
  if (report.pdfEndpoint.indexOf("household-assets") !== -1) return "household_assets";
  return "household_assets";
}

/**
 * @description Get a human-readable label for a report type.
 * @param {Object} report - A report definition object
 * @returns {string} Display label
 */
function getReportTypeLabel(report) {
  var type = detectReportType(report);
  var label = REPORT_TYPE_LABELS[type] || type;
  if (type === "composite" && report.blocks) {
    label += " (" + report.blocks.length + " block" + (report.blocks.length !== 1 ? "s" : "") + ")";
  }
  if (type === "chart_group" && report.charts) {
    label += " (" + report.charts.length + " chart" + (report.charts.length !== 1 ? "s" : "") + ")";
  }
  return label;
}

// ─── Data loading ────────────────────────────────────────────────────────────

/**
 * @description Load report definitions and tokens from the server, then render.
 */
async function loadReports() {
  var result = await apiRequest("/api/reports/raw");
  if (!result.ok) {
    showError("page-messages", result.error || "Failed to load reports", result.detail || "");
    return;
  }
  try {
    reportDefinitions = JSON.parse(result.data.content);
  } catch {
    showError("page-messages", "Failed to parse report definitions");
    return;
  }

  // Load tokens (non-blocking — used for hints in modals)
  try {
    var tokenResult = await apiRequest("/api/reports/tokens");
    if (tokenResult.ok) {
      reportTokens = tokenResult.data || [];
    }
  } catch {
    // Tokens are optional — continue without them
  }

  renderReportsTable();
}

// ─── Table rendering ─────────────────────────────────────────────────────────

/**
 * @description Render the main reports table showing all defined reports.
 */
function renderReportsTable() {
  var container = document.getElementById("reports-list");
  if (!container) return;

  if (reportDefinitions.length === 0) {
    container.innerHTML = '<p class="text-brand-500 text-sm">No reports configured. Click "Add Report" to create one.</p>';
    return;
  }

  var html = '<table class="w-full text-sm">';
  html += '<thead><tr class="border-b border-brand-200 text-left">';
  html += '<th class="py-2 pr-2 w-8 font-medium text-brand-700">#</th>';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Title</th>';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Type</th>';
  html += '<th class="py-2 pr-2 w-16 font-medium text-brand-700">Order</th>';
  html += '<th class="py-2 text-right font-medium text-brand-700">Actions</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < reportDefinitions.length; i++) {
    var report = reportDefinitions[i];
    html += '<tr class="border-b border-brand-100">';
    html += '<td class="py-3 pr-2 text-brand-400">' + (i + 1) + '</td>';
    html += '<td class="py-3 pr-4">' + escapeHtml(report.title || "(untitled)") + '</td>';
    html += '<td class="py-3 pr-4 text-brand-600">' + escapeHtml(getReportTypeLabel(report)) + '</td>';

    // Reorder arrows
    html += '<td class="py-3 pr-2">';
    if (i > 0) {
      html += '<button class="text-brand-500 hover:text-brand-800 mr-1" onclick="moveReport(' + i + ', -1)" title="Move up">&#9650;</button>';
    }
    if (i < reportDefinitions.length - 1) {
      html += '<button class="text-brand-500 hover:text-brand-800" onclick="moveReport(' + i + ', 1)" title="Move down">&#9660;</button>';
    }
    html += '</td>';

    // Action buttons
    html += '<td class="py-3 text-right whitespace-nowrap">';
    html += '<button class="text-brand-600 hover:text-brand-800 mr-3" onclick="editReport(' + i + ')">Edit</button>';
    html += '<button class="text-brand-600 hover:text-brand-800 mr-3" onclick="duplicateReport(' + i + ')">Duplicate</button>';
    html += '<button class="text-red-600 hover:text-red-800" onclick="confirmDeleteReport(' + i + ')">Delete</button>';
    html += '</td></tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Reorder / Duplicate / Delete ────────────────────────────────────────────

/**
 * @description Move a report up or down in the list.
 * @param {number} index - Current index
 * @param {number} direction - -1 for up, +1 for down
 */
async function moveReport(index, direction) {
  var newIndex = index + direction;
  if (newIndex < 0 || newIndex >= reportDefinitions.length) return;

  var result = await apiRequest("/api/reports/reorder", {
    method: "PUT",
    body: { from: index, to: newIndex },
  });

  if (result.ok) {
    loadReports();
  } else {
    showError("page-messages", result.error || "Failed to reorder");
  }
}

/**
 * @description Duplicate a report definition.
 * @param {number} index - Index of the report to duplicate
 */
async function duplicateReport(index) {
  var result = await apiRequest("/api/reports/duplicate/" + index, { method: "POST" });
  if (result.ok) {
    showSuccess("page-messages", "Report duplicated");
    loadReports();
  } else {
    showError("page-messages", result.error || "Failed to duplicate");
  }
}

/**
 * @description Show confirmation before deleting a report.
 * @param {number} index - Index of the report to delete
 */
function confirmDeleteReport(index) {
  var report = reportDefinitions[index];
  if (!report) return;
  showConfirmDialog(
    "Delete Report",
    'Are you sure you want to delete "' + escapeHtml(report.title || report.id) + '"?',
    function () { deleteReport(index); }
  );
}

/**
 * @description Delete a report definition by index.
 * @param {number} index - Index to delete
 */
async function deleteReport(index) {
  var result = await apiRequest("/api/reports/definition/" + index, { method: "DELETE" });
  if (result.ok) {
    showSuccess("page-messages", "Report deleted");
    loadReports();
  } else {
    showError("page-messages", result.error || "Failed to delete");
  }
}

// ─── Edit report dispatcher ─────────────────────────────────────────────────

/**
 * @description Open the appropriate edit modal for a report's type.
 * @param {number} index - Index of the report to edit
 */
function editReport(index) {
  var report = reportDefinitions[index];
  if (!report) return;
  var type = detectReportType(report);
  showReportModal(type, index);
}

// ─── Token hint helper ───────────────────────────────────────────────────────

/**
 * @description Build a hint string showing available token mappings.
 * @returns {string} Formatted hint like "USER1 → BW, USER2 → AW"
 */
function tokenHint() {
  if (reportTokens.length === 0) return "";
  var parts = reportTokens.map(function (t) {
    return t.param_key + " \u2192 " + t.param_value;
  });
  return "Available tokens: " + parts.join(", ");
}

// ─── Shared modal utilities ──────────────────────────────────────────────────

/**
 * @description Close any open modal overlay.
 */
function closeModal() {
  var overlay = document.getElementById("reports-modal-overlay");
  if (overlay) overlay.remove();
}

/**
 * @description Create and show a modal overlay with given HTML content.
 * @param {string} innerHtml - The modal body HTML
 * @returns {HTMLElement} The overlay element
 */
function createModalOverlay(innerHtml) {
  closeModal();
  var overlay = document.createElement("div");
  overlay.id = "reports-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";
  overlay.innerHTML = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto">' + innerHtml + '</div>';
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  return overlay;
}

/**
 * @description Show a simple confirmation dialog with OK/Cancel.
 * @param {string} title - Dialog title
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback if user confirms
 */
function showConfirmDialog(title, message, onConfirm) {
  var overlay = document.createElement("div");
  overlay.id = "reports-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";

  var html = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-sm mx-4 p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-800 mb-3">' + title + '</h3>';
  html += '<p class="text-sm text-brand-700 mb-6">' + message + '</p>';
  html += '<div class="flex justify-end gap-3">';
  html += '<button id="confirm-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  html += '<button id="confirm-ok" class="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors">Delete</button>';
  html += '</div></div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
  document.getElementById("confirm-cancel").addEventListener("click", closeModal);
  document.getElementById("confirm-ok").addEventListener("click", function () {
    closeModal();
    onConfirm();
  });
}

// ─── Dynamic list helpers ────────────────────────────────────────────────────

/**
 * @description Build HTML for a dynamic text list with add/remove buttons.
 * @param {string} fieldId - Base ID for the list
 * @param {string} label - Label text
 * @param {Array<string>} values - Initial values
 * @param {string} placeholder - Placeholder for new inputs
 * @param {string} [hint] - Optional hint text below label
 * @returns {string} HTML string
 */
function buildDynamicList(fieldId, label, values, placeholder, hint) {
  var html = '<div>';
  html += '<label class="block text-sm font-medium text-brand-700 mb-1">' + label + '</label>';
  if (hint) {
    html += '<p class="text-xs text-brand-500 mb-2">' + escapeHtml(hint) + '</p>';
  }
  html += '<div id="' + fieldId + '-container">';
  for (var i = 0; i < values.length; i++) {
    html += buildDynamicListRow(fieldId, values[i], placeholder);
  }
  html += '</div>';
  html += '<button type="button" class="text-sm text-brand-600 hover:text-brand-800 mt-1" onclick="addDynamicListRow(\'' + fieldId + '\', \'' + escapeHtml(placeholder) + '\')">+ Add entry</button>';
  html += '</div>';
  return html;
}

/**
 * @description Build a single row for a dynamic list.
 * @param {string} fieldId - Base ID for the list
 * @param {string} value - Current value
 * @param {string} placeholder - Placeholder text
 * @returns {string} HTML string for one row
 */
function buildDynamicListRow(fieldId, value, placeholder) {
  return '<div class="flex items-center gap-2 mb-1 dynamic-row" data-field="' + fieldId + '">' +
    '<input type="text" class="flex-1 border border-brand-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" ' +
    'value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '" />' +
    '<button type="button" class="text-red-500 hover:text-red-700 text-lg leading-none" onclick="this.parentElement.remove()" title="Remove">&times;</button>' +
    '</div>';
}

/**
 * @description Add a new empty row to a dynamic list.
 * @param {string} fieldId - Base ID for the list container
 * @param {string} placeholder - Placeholder text for the new input
 */
function addDynamicListRow(fieldId, placeholder) {
  var container = document.getElementById(fieldId + "-container");
  if (!container) return;
  var row = document.createElement("div");
  row.className = "flex items-center gap-2 mb-1 dynamic-row";
  row.setAttribute("data-field", fieldId);
  row.innerHTML = '<input type="text" class="flex-1 border border-brand-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" ' +
    'value="" placeholder="' + escapeHtml(placeholder) + '" />' +
    '<button type="button" class="text-red-500 hover:text-red-700 text-lg leading-none" onclick="this.parentElement.remove()" title="Remove">&times;</button>';
  container.appendChild(row);
  row.querySelector("input").focus();
}

/**
 * @description Collect all non-empty values from a dynamic list.
 * @param {string} fieldId - Base ID for the list
 * @returns {Array<string>} Non-empty trimmed values
 */
function collectDynamicList(fieldId) {
  var container = document.getElementById(fieldId + "-container");
  if (!container) return [];
  var inputs = container.querySelectorAll("input[type='text']");
  var values = [];
  for (var i = 0; i < inputs.length; i++) {
    var val = inputs[i].value.trim();
    if (val) values.push(val);
  }
  return values;
}

// ─── Report modal builder ────────────────────────────────────────────────────

/**
 * @description Show the add/edit modal for a specific report type.
 * @param {string} type - The report type key
 * @param {number|null} editIndex - Index of report to edit, or null for new
 */
function showReportModal(type, editIndex) {
  var isEdit = editIndex !== null && editIndex >= 0;
  var report = isEdit ? JSON.parse(JSON.stringify(reportDefinitions[editIndex])) : {};
  var typeLabel = REPORT_TYPE_LABELS[type] || type;

  var html = '<h3 class="text-lg font-semibold text-brand-800 mb-4">' + (isEdit ? "Edit" : "Add") + " " + typeLabel + '</h3>';
  html += '<div class="space-y-4">';

  // Common fields: ID and Title
  html += buildTextField("rpt-id", "ID", report.id || "", "unique_report_id", "A unique identifier (no spaces). Used internally.");
  html += buildTextField("rpt-title", "Title", report.title || "", "e.g. Weekly Report", "Shown in the Reports dropdown menu.");

  // Type-specific fields
  if (type === "household_assets") {
    // No additional fields
  } else if (type === "portfolio_summary") {
    html += buildDynamicList("rpt-params", "Users", report.params || [""], "e.g. USER1 or USER1 + USER2", tokenHint());
    html += buildSelect("rpt-compareto", "Compare To (optional)", report.compareTo || "", [
      { value: "", label: "None" }, { value: "1m", label: "1 month" }, { value: "3m", label: "3 months" },
      { value: "6m", label: "6 months" }, { value: "1y", label: "1 year" }, { value: "3y", label: "3 years" },
    ]);
  } else if (type === "portfolio_detail") {
    html += buildDynamicList("rpt-params", "Detail Rows", report.params || [""], "USER1:ISA:1m,3m,1y,3y or new_page",
      'Format: USER:ACCOUNT_TYPE:PERIODS. Use "new_page" for page breaks. ' + tokenHint());
  } else if (type === "chart") {
    html += buildChartFields("rpt", report);
  } else if (type === "chart_group") {
    html += buildCheckbox("rpt-globalevents", "Show global events", report.showGlobalEvents || false);
    html += buildChartGroupFields(report);
  } else if (type === "portfolio_value_chart") {
    html += buildTextField("rpt-subtitle", "Subtitle", report.subTitle || "", "e.g. 36 month performance");
    html += buildSelect("rpt-months", "Months to Show", report.monthsToShow || "36", [
      { value: "6", label: "6 months" }, { value: "12", label: "12 months" },
      { value: "24", label: "24 months" }, { value: "36", label: "36 months" },
    ]);
    html += buildCheckbox("rpt-smooth", "Smooth lines", report.smooth || false);
    html += buildCheckbox("rpt-globalevents", "Show global events", report.showGlobalEvents || false);
    html += buildSelect("rpt-pctval", "Display As", report.showPercentOrValue || "percent", [
      { value: "percent", label: "Percentage change" }, { value: "value", label: "GBP value" },
    ]);
    html += buildDynamicList("rpt-params", "Portfolios", report.params || [""], "USER1:isa+sipp+trading",
      'Format: USER:ACCOUNT_TYPE (e.g. USER1:isa, USER2:isa+sipp+trading). ' + tokenHint());
  } else if (type === "composite") {
    html += buildCompositeBlocksEditor(report.blocks || []);
  }

  html += '</div>';
  html += '<div id="rpt-modal-messages" class="mt-3"></div>';
  html += '<div class="flex justify-end gap-3 mt-6">';
  html += '<button id="rpt-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  html += '<button id="rpt-save" class="px-4 py-2 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 transition-colors">' + (isEdit ? "Save Changes" : "Add Report") + '</button>';
  html += '</div>';

  createModalOverlay(html);

  // Focus ID field
  var idInput = document.getElementById("rpt-id");
  if (idInput) idInput.focus();

  document.getElementById("rpt-cancel").addEventListener("click", closeModal);
  document.getElementById("rpt-save").addEventListener("click", function () {
    saveReport(type, editIndex);
  });
}

// ─── Field builders ──────────────────────────────────────────────────────────

/**
 * @description Build a text input field with label and optional hint.
 * @param {string} id - Input element ID
 * @param {string} label - Label text
 * @param {string} value - Current value
 * @param {string} placeholder - Placeholder text
 * @param {string} [hint] - Optional hint text
 * @returns {string} HTML string
 */
function buildTextField(id, label, value, placeholder, hint) {
  var html = '<div>';
  html += '<label class="block text-sm font-medium text-brand-700 mb-1" for="' + id + '">' + label + '</label>';
  html += '<input id="' + id + '" type="text" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" value="' + escapeHtml(value) + '" placeholder="' + escapeHtml(placeholder) + '" />';
  if (hint) {
    html += '<p class="text-xs text-brand-500 mt-1">' + escapeHtml(hint) + '</p>';
  }
  html += '</div>';
  return html;
}

/**
 * @description Build a select dropdown with label.
 * @param {string} id - Select element ID
 * @param {string} label - Label text
 * @param {string} currentValue - Currently selected value
 * @param {Array<{value: string, label: string}>} options - Dropdown options
 * @returns {string} HTML string
 */
function buildSelect(id, label, currentValue, options) {
  var html = '<div>';
  html += '<label class="block text-sm font-medium text-brand-700 mb-1" for="' + id + '">' + label + '</label>';
  html += '<select id="' + id + '" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">';
  for (var i = 0; i < options.length; i++) {
    var sel = options[i].value === currentValue ? ' selected' : '';
    html += '<option value="' + escapeHtml(options[i].value) + '"' + sel + '>' + escapeHtml(options[i].label) + '</option>';
  }
  html += '</select></div>';
  return html;
}

/**
 * @description Build a checkbox with label.
 * @param {string} id - Checkbox element ID
 * @param {string} label - Label text
 * @param {boolean} checked - Whether currently checked
 * @returns {string} HTML string
 */
function buildCheckbox(id, label, checked) {
  return '<div class="flex items-center gap-2">' +
    '<input id="' + id + '" type="checkbox" class="rounded border-brand-300 text-brand-600 focus:ring-brand-400"' + (checked ? ' checked' : '') + ' />' +
    '<label class="text-sm text-brand-700" for="' + id + '">' + label + '</label></div>';
}

// ─── Chart-specific fields ───────────────────────────────────────────────────

/**
 * @description Build the chart-specific form fields (title, subtitle, months, etc.).
 * @param {string} prefix - ID prefix for the fields
 * @param {Object} data - Chart data object
 * @returns {string} HTML string
 */
function buildChartFields(prefix, data) {
  var html = '';
  html += buildTextField(prefix + "-subtitle", "Subtitle", data.subTitle || "", "e.g. 36 month performance versus FTSE 100");
  html += buildSelect(prefix + "-months", "Months to Show", data.monthsToShow || "36", [
    { value: "6", label: "6 months" }, { value: "12", label: "12 months" },
    { value: "24", label: "24 months" }, { value: "36", label: "36 months" },
  ]);
  html += buildCheckbox(prefix + "-smooth", "Smooth lines", data.smooth || false);
  html += buildCheckbox(prefix + "-globalevents", "Show global events", data.showGlobalEvents || false);
  html += buildDynamicList(prefix + "-params", "Data Series", data.params || [""], "inv:ISIN or inv:EXCHANGE:SYMBOL or bm:BENCHMARK",
    'Prefix with inv: for investments, bm: for benchmarks. E.g. inv:GB00B41YBW71, inv:LSE:RR., bm:FTSE 100');
  return html;
}

/**
 * @description Collect chart field values from a set of form inputs.
 * @param {string} prefix - ID prefix used when building the fields
 * @returns {Object} Chart properties object
 */
function collectChartFields(prefix) {
  return {
    subTitle: getVal(prefix + "-subtitle"),
    monthsToShow: getVal(prefix + "-months"),
    smooth: getChecked(prefix + "-smooth"),
    showGlobalEvents: getChecked(prefix + "-globalevents"),
    params: collectDynamicList(prefix + "-params"),
  };
}

// ─── Chart Group fields ──────────────────────────────────────────────────────

/**
 * @description Build the chart group editor with 1–4 sub-chart panels.
 * @param {Object} report - The chart group report definition
 * @returns {string} HTML string
 */
function buildChartGroupFields(report) {
  var charts = report.charts || [{}];
  var html = '<div id="chart-group-container">';
  html += '<label class="block text-sm font-medium text-brand-700 mb-2">Charts (1–4)</label>';

  for (var i = 0; i < charts.length; i++) {
    html += buildChartGroupPanel(i, charts[i]);
  }

  html += '</div>';
  html += '<button type="button" id="btn-add-chart-panel" class="text-sm text-brand-600 hover:text-brand-800 mt-1" onclick="addChartGroupPanel()">+ Add chart</button>';
  return html;
}

/**
 * @description Build a single chart panel within a chart group.
 * @param {number} index - Panel index
 * @param {Object} chart - Chart data
 * @returns {string} HTML string
 */
function buildChartGroupPanel(index, chart) {
  var prefix = "cg-" + index;
  var html = '<div class="border border-brand-200 rounded-md p-4 mb-3 chart-group-panel" data-panel-index="' + index + '">';
  html += '<div class="flex items-center justify-between mb-3">';
  html += '<span class="text-sm font-medium text-brand-700">Chart ' + (index + 1) + '</span>';
  html += '<button type="button" class="text-red-500 hover:text-red-700 text-sm" onclick="removeChartGroupPanel(this)">Remove</button>';
  html += '</div>';
  html += buildTextField(prefix + "-title", "Chart Title", chart.title || "", "e.g. UK Funds 36m");
  html += buildTextField(prefix + "-subtitle", "Subtitle", chart.subTitle || "", "e.g. 36 month performance");
  html += buildSelect(prefix + "-months", "Months to Show", chart.monthsToShow || "36", [
    { value: "6", label: "6 months" }, { value: "12", label: "12 months" },
    { value: "24", label: "24 months" }, { value: "36", label: "36 months" },
  ]);
  html += buildCheckbox(prefix + "-smooth", "Smooth lines", chart.smooth || false);
  html += buildDynamicList(prefix + "-params", "Data Series", chart.params || [""], "inv:ISIN or bm:BENCHMARK",
    'Prefix with inv: for investments, bm: for benchmarks.');
  html += '</div>';
  return html;
}

/**
 * @description Add a new chart panel to the chart group editor.
 */
function addChartGroupPanel() {
  var container = document.getElementById("chart-group-container");
  if (!container) return;
  var panels = container.querySelectorAll(".chart-group-panel");
  if (panels.length >= 4) {
    showError("rpt-modal-messages", "Maximum of 4 charts allowed");
    return;
  }
  var newIndex = panels.length;
  var temp = document.createElement("div");
  temp.innerHTML = buildChartGroupPanel(newIndex, {});
  container.appendChild(temp.firstElementChild);
}

/**
 * @description Remove a chart panel from the chart group editor.
 * @param {HTMLElement} btn - The remove button that was clicked
 */
function removeChartGroupPanel(btn) {
  var panel = btn.closest(".chart-group-panel");
  if (panel) panel.remove();
  // Re-number remaining panels
  var container = document.getElementById("chart-group-container");
  if (!container) return;
  var panels = container.querySelectorAll(".chart-group-panel");
  for (var i = 0; i < panels.length; i++) {
    var heading = panels[i].querySelector("span");
    if (heading) heading.textContent = "Chart " + (i + 1);
  }
}

/**
 * @description Collect all chart group panels into an array of chart objects.
 * @returns {Array<Object>} Array of chart definitions
 */
function collectChartGroupPanels() {
  var container = document.getElementById("chart-group-container");
  if (!container) return [];
  var panels = container.querySelectorAll(".chart-group-panel");
  var charts = [];
  for (var i = 0; i < panels.length; i++) {
    var prefix = "cg-" + panels[i].getAttribute("data-panel-index");
    charts.push({
      title: getVal(prefix + "-title"),
      subTitle: getVal(prefix + "-subtitle"),
      monthsToShow: getVal(prefix + "-months"),
      smooth: getChecked(prefix + "-smooth"),
      params: collectDynamicList(prefix + "-params"),
    });
  }
  return charts;
}

// ─── Composite block editor ──────────────────────────────────────────────────

/**
 * @description Build the composite blocks editor showing an ordered list of blocks.
 * @param {Array<Object>} blocks - Existing block definitions
 * @returns {string} HTML string
 */
function buildCompositeBlocksEditor(blocks) {
  var html = '<div>';
  html += '<label class="block text-sm font-medium text-brand-700 mb-2">Report Blocks</label>';
  html += '<div id="composite-blocks-container">';

  for (var i = 0; i < blocks.length; i++) {
    html += buildCompositeBlockCard(i, blocks[i]);
  }

  html += '</div>';

  // Add block dropdown
  html += '<div class="mt-2">';
  html += '<select id="add-block-type" class="border border-brand-300 rounded-md px-3 py-1.5 text-sm mr-2">';
  html += '<option value="household_assets">Household Assets</option>';
  html += '<option value="portfolio_summary">Portfolio Summary</option>';
  html += '<option value="portfolio_detail">Portfolio Detail</option>';
  html += '<option value="chart">Performance Chart</option>';
  html += '<option value="chart_group">Chart Group</option>';
  html += '<option value="portfolio_value_chart">Portfolio Value Chart</option>';
  html += '</select>';
  html += '<button type="button" class="text-sm text-brand-600 hover:text-brand-800" onclick="addCompositeBlock()">+ Add block</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

/**
 * @description Build a single collapsible block card for the composite editor.
 * @param {number} index - Block index
 * @param {Object} block - Block definition
 * @returns {string} HTML string
 */
function buildCompositeBlockCard(index, block) {
  var blockType = block.type || "household_assets";
  var typeLabel = REPORT_TYPE_LABELS[blockType] || blockType;
  var prefix = "blk-" + index;

  var html = '<div class="border border-brand-200 rounded-md mb-2 composite-block-card" data-block-index="' + index + '">';

  // Header bar with type label, order arrows, and remove button
  html += '<div class="flex items-center justify-between px-4 py-2 bg-brand-50 rounded-t-md cursor-pointer" onclick="toggleBlockCard(this)">';
  html += '<span class="text-sm font-medium text-brand-700">' + (index + 1) + '. ' + escapeHtml(typeLabel) + '</span>';
  html += '<div class="flex items-center gap-2">';
  html += '<button type="button" class="text-brand-500 hover:text-brand-800 text-xs" onclick="event.stopPropagation(); moveBlock(' + index + ', -1)" title="Move up">&#9650;</button>';
  html += '<button type="button" class="text-brand-500 hover:text-brand-800 text-xs" onclick="event.stopPropagation(); moveBlock(' + index + ', 1)" title="Move down">&#9660;</button>';
  html += '<button type="button" class="text-red-500 hover:text-red-700 text-sm ml-2" onclick="event.stopPropagation(); removeCompositeBlock(' + index + ')" title="Remove block">&times;</button>';
  html += '</div></div>';

  // Collapsible body with type-specific fields
  html += '<div class="p-4 space-y-3 block-body">';
  html += '<input type="hidden" id="' + prefix + '-type" value="' + blockType + '" />';

  if (blockType === "household_assets") {
    html += '<p class="text-sm text-brand-500">No additional parameters needed.</p>';
  } else if (blockType === "portfolio_summary") {
    html += buildDynamicList(prefix + "-params", "Users", block.params || [""], "e.g. USER1", tokenHint());
    html += buildSelect(prefix + "-compareto", "Compare To", block.compareTo || "", [
      { value: "", label: "None" }, { value: "1m", label: "1 month" }, { value: "3m", label: "3 months" },
      { value: "6m", label: "6 months" }, { value: "1y", label: "1 year" }, { value: "3y", label: "3 years" },
    ]);
  } else if (blockType === "portfolio_detail") {
    html += buildDynamicList(prefix + "-params", "Detail Rows", block.params || [""], "USER1:ISA:1m,3m,1y,3y", tokenHint());
  } else if (blockType === "chart") {
    html += buildTextField(prefix + "-title", "Chart Title", block.title || "", "e.g. Key Funds");
    html += buildTextField(prefix + "-subtitle", "Subtitle", block.subTitle || "", "e.g. 36 month performance");
    html += buildSelect(prefix + "-months", "Months to Show", block.monthsToShow || "36", [
      { value: "6", label: "6" }, { value: "12", label: "12" }, { value: "24", label: "24" }, { value: "36", label: "36" },
    ]);
    html += buildCheckbox(prefix + "-smooth", "Smooth lines", block.smooth || false);
    html += buildCheckbox(prefix + "-globalevents", "Show global events", block.showGlobalEvents || false);
    html += buildDynamicList(prefix + "-params", "Data Series", block.params || [""], "inv:ISIN or bm:BENCHMARK", "");
  } else if (blockType === "chart_group") {
    // Simplified chart group inside composite — use sub-panels
    html += buildCheckbox(prefix + "-globalevents", "Show global events", block.showGlobalEvents || false);
    var charts = block.charts || [{}];
    html += '<div id="' + prefix + '-charts-container">';
    for (var c = 0; c < charts.length; c++) {
      html += buildInlineChartPanel(prefix, c, charts[c]);
    }
    html += '</div>';
    html += '<button type="button" class="text-sm text-brand-600 hover:text-brand-800 mt-1" onclick="addInlineChartPanel(\'' + prefix + '\')">+ Add chart</button>';
  } else if (blockType === "portfolio_value_chart") {
    html += buildTextField(prefix + "-title", "Chart Title", block.title || "", "e.g. Portfolio Value");
    html += buildTextField(prefix + "-subtitle", "Subtitle", block.subTitle || "", "e.g. 36 month account values");
    html += buildSelect(prefix + "-months", "Months to Show", block.monthsToShow || "36", [
      { value: "6", label: "6" }, { value: "12", label: "12" }, { value: "24", label: "24" }, { value: "36", label: "36" },
    ]);
    html += buildCheckbox(prefix + "-smooth", "Smooth lines", block.smooth || false);
    html += buildCheckbox(prefix + "-globalevents", "Show global events", block.showGlobalEvents || false);
    html += buildSelect(prefix + "-pctval", "Display As", block.showPercentOrValue || "percent", [
      { value: "percent", label: "Percentage change" }, { value: "value", label: "GBP value" },
    ]);
    html += buildDynamicList(prefix + "-params", "Portfolios", block.params || [""], "USER1:isa+sipp+trading", tokenHint());
  }

  html += '</div></div>';
  return html;
}

/**
 * @description Build a mini chart panel for inside a composite chart_group block.
 * @param {string} blockPrefix - Parent block prefix
 * @param {number} chartIndex - Chart index within the group
 * @param {Object} chart - Chart data
 * @returns {string} HTML string
 */
function buildInlineChartPanel(blockPrefix, chartIndex, chart) {
  var prefix = blockPrefix + "-ch-" + chartIndex;
  var html = '<div class="border border-brand-100 rounded p-3 mb-2 inline-chart-panel" data-chart-index="' + chartIndex + '">';
  html += '<div class="flex items-center justify-between mb-2">';
  html += '<span class="text-xs font-medium text-brand-600">Chart ' + (chartIndex + 1) + '</span>';
  html += '<button type="button" class="text-red-500 hover:text-red-700 text-xs" onclick="this.closest(\'.inline-chart-panel\').remove()">Remove</button>';
  html += '</div>';
  html += buildTextField(prefix + "-title", "Title", chart.title || "", "Chart title");
  html += buildTextField(prefix + "-subtitle", "Subtitle", chart.subTitle || "", "Chart subtitle");
  html += buildSelect(prefix + "-months", "Months", chart.monthsToShow || "36", [
    { value: "6", label: "6" }, { value: "12", label: "12" }, { value: "24", label: "24" }, { value: "36", label: "36" },
  ]);
  html += buildCheckbox(prefix + "-smooth", "Smooth", chart.smooth || false);
  html += buildDynamicList(prefix + "-params", "Series", chart.params || [""], "inv:ISIN or bm:NAME", "");
  html += '</div>';
  return html;
}

/**
 * @description Add a new inline chart panel to a composite chart_group block.
 * @param {string} blockPrefix - Parent block prefix
 */
function addInlineChartPanel(blockPrefix) {
  var container = document.getElementById(blockPrefix + "-charts-container");
  if (!container) return;
  var panels = container.querySelectorAll(".inline-chart-panel");
  if (panels.length >= 4) return;
  var temp = document.createElement("div");
  temp.innerHTML = buildInlineChartPanel(blockPrefix, panels.length, {});
  container.appendChild(temp.firstElementChild);
}

/**
 * @description Toggle visibility of a composite block card body.
 * @param {HTMLElement} header - The header element that was clicked
 */
function toggleBlockCard(header) {
  var body = header.nextElementSibling;
  if (body) {
    body.classList.toggle("hidden");
  }
}

/**
 * @description Add a new block to the composite editor.
 */
function addCompositeBlock() {
  var typeSelect = document.getElementById("add-block-type");
  if (!typeSelect) return;
  var blockType = typeSelect.value;
  var container = document.getElementById("composite-blocks-container");
  if (!container) return;

  var existingCards = container.querySelectorAll(".composite-block-card");
  var newIndex = existingCards.length;
  var block = { type: blockType };

  var temp = document.createElement("div");
  temp.innerHTML = buildCompositeBlockCard(newIndex, block);
  container.appendChild(temp.firstElementChild);
}

/**
 * @description Remove a composite block by index and re-render all blocks.
 * @param {number} index - The block index to remove
 */
function removeCompositeBlock(index) {
  var container = document.getElementById("composite-blocks-container");
  if (!container) return;
  var cards = container.querySelectorAll(".composite-block-card");
  if (index < cards.length) {
    cards[index].remove();
  }
  // Re-number headers
  var remaining = container.querySelectorAll(".composite-block-card");
  for (var i = 0; i < remaining.length; i++) {
    var heading = remaining[i].querySelector("span");
    if (heading) {
      var typeText = heading.textContent.replace(/^\d+\.\s*/, "");
      heading.textContent = (i + 1) + ". " + typeText;
    }
  }
}

/**
 * @description Move a composite block up or down. Collects all current state,
 * swaps the blocks, and re-renders the entire container.
 * @param {number} index - Current block index
 * @param {number} direction - -1 for up, +1 for down
 */
function moveBlock(index, direction) {
  var blocks = collectCompositeBlocks();
  var newIndex = index + direction;
  if (newIndex < 0 || newIndex >= blocks.length) return;

  var item = blocks.splice(index, 1)[0];
  blocks.splice(newIndex, 0, item);

  // Re-render all blocks
  var container = document.getElementById("composite-blocks-container");
  if (!container) return;
  container.innerHTML = "";
  for (var i = 0; i < blocks.length; i++) {
    var temp = document.createElement("div");
    temp.innerHTML = buildCompositeBlockCard(i, blocks[i]);
    container.appendChild(temp.firstElementChild);
  }
}

/**
 * @description Collect all composite blocks from the editor into an array.
 * @returns {Array<Object>} Array of block definition objects
 */
function collectCompositeBlocks() {
  var container = document.getElementById("composite-blocks-container");
  if (!container) return [];
  var cards = container.querySelectorAll(".composite-block-card");
  var blocks = [];

  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var prefix = "blk-" + card.getAttribute("data-block-index");
    var typeInput = card.querySelector('input[type="hidden"]');
    var blockType = typeInput ? typeInput.value : "household_assets";
    var block = { type: blockType };

    if (blockType === "portfolio_summary") {
      block.params = collectDynamicList(prefix + "-params");
      var compareTo = getVal(prefix + "-compareto");
      if (compareTo) block.compareTo = compareTo;
    } else if (blockType === "portfolio_detail") {
      block.params = collectDynamicList(prefix + "-params");
    } else if (blockType === "chart") {
      block.title = getVal(prefix + "-title");
      block.subTitle = getVal(prefix + "-subtitle");
      block.monthsToShow = getVal(prefix + "-months");
      block.smooth = getChecked(prefix + "-smooth");
      block.showGlobalEvents = getChecked(prefix + "-globalevents");
      block.params = collectDynamicList(prefix + "-params");
    } else if (blockType === "chart_group") {
      block.showGlobalEvents = getChecked(prefix + "-globalevents");
      block.charts = collectInlineChartPanels(prefix);
    } else if (blockType === "portfolio_value_chart") {
      block.title = getVal(prefix + "-title");
      block.subTitle = getVal(prefix + "-subtitle");
      block.monthsToShow = getVal(prefix + "-months");
      block.smooth = getChecked(prefix + "-smooth");
      block.showGlobalEvents = getChecked(prefix + "-globalevents");
      block.showPercentOrValue = getVal(prefix + "-pctval");
      block.params = collectDynamicList(prefix + "-params");
    }

    blocks.push(block);
  }

  return blocks;
}

/**
 * @description Collect inline chart panels from a composite chart_group block.
 * @param {string} blockPrefix - The parent block prefix
 * @returns {Array<Object>} Array of chart objects
 */
function collectInlineChartPanels(blockPrefix) {
  var container = document.getElementById(blockPrefix + "-charts-container");
  if (!container) return [];
  var panels = container.querySelectorAll(".inline-chart-panel");
  var charts = [];
  for (var i = 0; i < panels.length; i++) {
    var chartIndex = panels[i].getAttribute("data-chart-index");
    var prefix = blockPrefix + "-ch-" + chartIndex;
    charts.push({
      title: getVal(prefix + "-title"),
      subTitle: getVal(prefix + "-subtitle"),
      monthsToShow: getVal(prefix + "-months"),
      smooth: getChecked(prefix + "-smooth"),
      params: collectDynamicList(prefix + "-params"),
    });
  }
  return charts;
}

// ─── Value getters ───────────────────────────────────────────────────────────

/**
 * @description Get the trimmed value of an input/select by ID.
 * @param {string} id - Element ID
 * @returns {string} Trimmed value or empty string
 */
function getVal(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

/**
 * @description Get the checked state of a checkbox by ID.
 * @param {string} id - Element ID
 * @returns {boolean} Whether the checkbox is checked
 */
function getChecked(id) {
  var el = document.getElementById(id);
  return el ? el.checked : false;
}

// ─── Save report ─────────────────────────────────────────────────────────────

/**
 * @description Collect form data and save a report definition (add or update).
 * @param {string} type - The report type key
 * @param {number|null} editIndex - Index to update, or null for new
 */
async function saveReport(type, editIndex) {
  var id = getVal("rpt-id");
  var title = getVal("rpt-title");

  if (!id) {
    showError("rpt-modal-messages", "ID is required");
    return;
  }
  if (!title) {
    showError("rpt-modal-messages", "Title is required");
    return;
  }

  var report = { id: id, title: title };

  if (type === "household_assets") {
    report.pdfEndpoint = "/api/reports/pdf/household-assets";
    report.params = [];
  } else if (type === "portfolio_summary") {
    report.pdfEndpoint = "/api/reports/pdf/portfolio-summary";
    report.params = collectDynamicList("rpt-params");
    var compareTo = getVal("rpt-compareto");
    if (compareTo) report.compareTo = compareTo;
  } else if (type === "portfolio_detail") {
    report.pdfEndpoint = "/api/reports/pdf/portfolio-detail";
    report.params = collectDynamicList("rpt-params");
  } else if (type === "chart") {
    report.pdfEndpoint = "/api/reports/pdf/chart";
    var chartFields = collectChartFields("rpt");
    report.subTitle = chartFields.subTitle;
    report.monthsToShow = chartFields.monthsToShow;
    report.smooth = chartFields.smooth;
    report.showGlobalEvents = chartFields.showGlobalEvents;
    report.params = chartFields.params;
  } else if (type === "chart_group") {
    report.pdfEndpoint = "/api/reports/pdf/chart-group";
    report.showGlobalEvents = getChecked("rpt-globalevents");
    report.charts = collectChartGroupPanels();
    if (report.charts.length === 0) {
      showError("rpt-modal-messages", "At least one chart is required");
      return;
    }
    if (report.charts.length > 4) {
      showError("rpt-modal-messages", "Maximum of 4 charts allowed");
      return;
    }
  } else if (type === "portfolio_value_chart") {
    report.pdfEndpoint = "/api/reports/pdf/portfolio-value-chart";
    report.subTitle = getVal("rpt-subtitle");
    report.monthsToShow = getVal("rpt-months");
    report.smooth = getChecked("rpt-smooth");
    report.showGlobalEvents = getChecked("rpt-globalevents");
    report.showPercentOrValue = getVal("rpt-pctval");
    report.params = collectDynamicList("rpt-params");
  } else if (type === "composite") {
    report.blocks = collectCompositeBlocks();
    if (report.blocks.length === 0) {
      showError("rpt-modal-messages", "At least one block is required");
      return;
    }
  }

  var isEdit = editIndex !== null && editIndex >= 0;
  var url = isEdit
    ? "/api/reports/definition/" + editIndex
    : "/api/reports/definition";
  var method = isEdit ? "PUT" : "POST";

  var result = await apiRequest(url, { method: method, body: report });

  if (!result.ok) {
    showError("rpt-modal-messages", result.error || "Failed to save", result.detail || "");
    return;
  }

  closeModal();
  showSuccess("page-messages", isEdit ? "Report updated" : "Report added");
  loadReports();
}

// ─── Initialisation ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  loadReports();

  // Add Report dropdown toggle
  var addBtn = document.getElementById("btn-add-report");
  var addMenu = document.getElementById("add-report-menu");

  if (addBtn && addMenu) {
    addBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      addMenu.classList.toggle("hidden");
    });

    // Close menu when clicking outside
    document.addEventListener("click", function () {
      addMenu.classList.add("hidden");
    });

    // Handle type selection from the Add Report menu
    var typeButtons = addMenu.querySelectorAll("button[data-type]");
    for (var i = 0; i < typeButtons.length; i++) {
      typeButtons[i].addEventListener("click", function () {
        addMenu.classList.add("hidden");
        showReportModal(this.getAttribute("data-type"), null);
      });
    }
  }

  // Edit as JSON button — opens the existing raw editor from app.js
  var jsonBtn = document.getElementById("btn-edit-json");
  if (jsonBtn) {
    jsonBtn.addEventListener("click", function () {
      if (typeof showEditReportsModal === "function") {
        showEditReportsModal();
      } else {
        showError("page-messages", "JSON editor not available on this page");
      }
    });
  }
});
