/**
 * @description Report runner for Portfolio 60.
 * Loads a composite view definition from /api/views/:id and renders
 * each block in sequence into the given container. Blocks are grouped
 * into pages (split by "new_page" entries). Each page gets a consistent
 * header (logo + title) and footer (report title, page number, date).
 *
 * Report block types:
 *   - "household_assets"              → renderHouseholdAssets(id, params)
 *   - "portfolio_summary_valuation"   → renderPortfolioSummary(id, params)
 *   - "portfolio_detail_valuation"   → renderPortfolioDetailValuation(id, params)
 *   - "new_page"                      → starts a new page
 */

/**
 * @description Inject CSS named page rules for per-page layout control.
 * Uses the CSS "page" property to assign named page types to elements,
 * allowing portrait and landscape pages within the same print job.
 * Called once when the report runner starts.
 */
function injectPageLayoutStyles() {
  // Only inject once
  if (document.getElementById("report-layout-style")) return;

  var style = document.createElement("style");
  style.id = "report-layout-style";
  style.textContent =
    "@page report-portrait { size: A4 portrait; } " +
    "@page report-landscape { size: A4 landscape; } " +
    ".report-layout-portrait { page: report-portrait; } " +
    ".report-layout-landscape { page: report-landscape; }";
  document.head.appendChild(style);
}

/**
 * @description Determine the layout for a page from its blocks.
 * Uses the layout property of the first block that specifies one.
 * Defaults to "portrait" if no block specifies a layout.
 * @param {Array<Object>} pageBlocks - The blocks on this page
 * @returns {string} "portrait" or "landscape"
 */
function getPageLayout(pageBlocks) {
  for (var i = 0; i < pageBlocks.length; i++) {
    if (pageBlocks[i].layout) {
      return pageBlocks[i].layout === "landscape" ? "landscape" : "portrait";
    }
  }
  return "portrait";
}

/**
 * @description Registry mapping block type names to their render functions.
 * Each render function takes (containerId, params) and is async.
 * @type {Object<string, Function>}
 */
const REPORT_BLOCK_REGISTRY = {
  household_assets: renderHouseholdAssets,
  portfolio_summary_valuation: renderPortfolioSummary,
  portfolio_detail_valuation: renderPortfolioDetailValuation,
};

/**
 * @description Get today's date formatted as DD/MM/YYYY for the report footer.
 * @returns {string} Formatted date string
 */
function runnerTodayFormatted() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

/**
 * @description Build the page header HTML (logo + Portfolio 60).
 * @returns {string} HTML string for the page header
 */
function buildPageHeader() {
  return (
    '<div class="flex items-center gap-3 mb-4">' +
    '<img src="/images/redmug-logo.svg" alt="" class="h-6 w-6" />' +
    '<span class="text-lg font-semibold text-brand-800">Portfolio 60</span>' +
    "</div>"
  );
}

/**
 * @description Build the page footer HTML with report title, page number, and date.
 * @param {string} reportTitle - The composite report title
 * @param {number} pageNum - Current page number (1-based)
 * @param {number} totalPages - Total number of pages
 * @returns {string} HTML string for the page footer
 */
function buildPageFooter(reportTitle, pageNum, totalPages) {
  return (
    '<div class="pt-4 mt-6 border-t border-brand-200">' +
    '<span class="font-light text-xs text-brand-600">' +
    runnerTodayFormatted() +
    " - " +
    escapeHtml(reportTitle) +
    " page " +
    pageNum +
    "/" +
    totalPages +
    "</span>" +
    "</div>"
  );
}

/**
 * @description Run a composite report by loading its definition and rendering
 * each block in sequence into the given container element. Blocks are split
 * into pages by "new_page" entries, each page getting a header and footer.
 * @param {string} reportId - The view definition ID from user-views.json
 * @param {string} containerId - The ID of the container element to render into
 */
async function runCompositeReport(reportId, containerId) {
  const container = document.getElementById(containerId);

  // Load the specific report definition
  const result = await apiRequest("/api/views/" + encodeURIComponent(reportId));

  if (!result.ok) {
    container.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-sm font-semibold">Failed to load report definition</p>' +
      '<p class="text-xs mt-1">' +
      escapeHtml(result.detail || result.error || "Unknown error") +
      "</p></div>";
    return;
  }

  var report = result.data;

  // Inject CSS named page rules for per-page layout switching
  injectPageLayoutStyles();

  // Signal to block render functions to suppress their own footers
  window._compositeReport = true;

  // Split blocks into pages (groups separated by new_page entries)
  var pages = [[]];
  for (var i = 0; i < report.blocks.length; i++) {
    if (report.blocks[i].type === "new_page") {
      pages.push([]);
    } else {
      pages[pages.length - 1].push(report.blocks[i]);
    }
  }

  // Remove any empty trailing pages
  while (pages.length > 1 && pages[pages.length - 1].length === 0) {
    pages.pop();
  }

  var totalPages = pages.length;
  container.innerHTML = "";

  for (var p = 0; p < pages.length; p++) {
    // Determine page layout from its blocks (portrait or landscape)
    var pageLayout = getPageLayout(pages[p]);

    // Page wrapper — mb-16 for screen spacing between pages
    // report-layout-* class triggers the CSS named page for print orientation
    var pageDiv = document.createElement("div");
    pageDiv.className =
      "report-page mb-16 report-layout-" + pageLayout +
      (p > 0 ? " break-before-page" : "");

    // Page header
    var headerDiv = document.createElement("div");
    headerDiv.innerHTML = buildPageHeader();
    pageDiv.appendChild(headerDiv);

    // Page content area — in print, flex:1 pushes footer to bottom
    var contentDiv = document.createElement("div");
    contentDiv.className = "report-page-content";
    pageDiv.appendChild(contentDiv);

    // Append page to document first so block render functions can find
    // their containers via document.getElementById()
    container.appendChild(pageDiv);

    // Render each block into the content area
    var pageBlocks = pages[p];
    for (var b = 0; b < pageBlocks.length; b++) {
      var block = pageBlocks[b];
      var renderFn = REPORT_BLOCK_REGISTRY[block.type];

      if (!renderFn) {
        var errDiv = document.createElement("div");
        errDiv.className = "text-error text-sm py-2";
        errDiv.textContent = "Unknown report block type: " + block.type;
        contentDiv.appendChild(errDiv);
        continue;
      }

      var blockDiv = document.createElement("div");
      blockDiv.id = "report-block-" + p + "-" + b;
      contentDiv.appendChild(blockDiv);

      await renderFn(blockDiv.id, block.params || []);
    }

    // Page footer
    var footerDiv = document.createElement("div");
    footerDiv.innerHTML = buildPageFooter(report.title, p + 1, totalPages);
    pageDiv.appendChild(footerDiv);
  }

  // Clear composite mode flag
  window._compositeReport = false;
}
