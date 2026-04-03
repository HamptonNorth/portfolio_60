import { PDF, rgb } from "@libpdf/core";
import { embedRobotoFonts } from "./pdf-fonts.js";
import { getPortfolioSummary, getPortfolioSummaryAtDate } from "../services/portfolio-service.js";
import { getAllUsers } from "../db/users-db.js";
import { getReportParams } from "../db/report-params-db.js";
import { isTestMode } from "../test-mode.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";

/**
 * @description Brand colours converted to RGB 0-1 range for PDF rendering.
 * Matches the Tailwind brand palette used in the HTML report.
 */
const COLOURS = {
  brand800: rgb(0.15, 0.23, 0.42),
  brand700: rgb(0.2, 0.3, 0.5),
  brand600: rgb(0.35, 0.42, 0.55),
  brand200: rgb(0.82, 0.85, 0.9),
  brand100: rgb(0.91, 0.93, 0.96),
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
  green100: rgb(0.86, 0.94, 0.87),
  green700: rgb(0.17, 0.53, 0.34),
  red600: rgb(0.76, 0.07, 0.12),
  grey400: rgb(0.55, 0.6, 0.65),
};

/** @description A4 page dimensions in points */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const USABLE_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

/**
 * @description Account type display labels. ISA and SIPP are uppercase
 * (initialisms), Trading is proper case.
 * @type {Object<string, string>}
 */
const ACCOUNT_TYPE_LABELS = {
  isa: "ISA",
  sipp: "SIPP",
  trading: "Trading",
};

/**
 * @description Column definitions for the portfolio summary table.
 * x is relative to MARGIN_LEFT, width in points.
 * @type {Array<{key: string, label: string, x: number, width: number, align: string}>}
 */
const COLUMNS = [
  { key: "account", label: "Account", x: 0, width: 80, align: "left" },
  { key: "reference", label: "Reference", x: 80, width: 100, align: "left" },
  { key: "investments", label: "Investments", x: 180, width: 100, align: "right" },
  { key: "cash", label: "Cash", x: 280, width: 100, align: "right" },
  { key: "total", label: "Total", x: 380, width: 100, align: "right" },
];

/** @description Font sizes used in the report */
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_USER_HEADING = 10;
const FONT_SIZE_HEADER = 7;
const FONT_SIZE_ROW = 7;
const FONT_SIZE_TOTAL = 7;
const FONT_SIZE_COMBINED_HEADING = 10;
const FONT_SIZE_FOOTER = 6;

/** @description Row heights in points */
const ROW_HEIGHT = 14;
const HEADER_ROW_HEIGHT = 16;
const USER_HEADING_HEIGHT = 20;

/**
 * @description Format a decimal GBP value as a whole-pounds string
 * with thousand separators. No currency symbol.
 * @param {number} value - Decimal GBP value (e.g. 1234.56)
 * @returns {string} Formatted string like "1,234"
 */
function formatGBP(value) {
  if (value === 0) return "0";
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * @description Draw text right-aligned within a column.
 * @param {Object} page - PDFPage instance
 * @param {string} text - The text to draw
 * @param {number} x - Left edge of column (absolute)
 * @param {number} colWidth - Column width in points
 * @param {number} y - Y position (baseline)
 * @param {Object} font - Embedded font object
 * @param {number} fontSize - Font size in points
 * @param {Object} color - RGB colour
 */
function drawRightAligned(page, text, x, colWidth, y, font, fontSize, color) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  page.drawText(text, {
    x: x + colWidth - textWidth - 2,
    y: y,
    font: font,
    size: fontSize,
    color: color,
  });
}

/**
 * @description Truncate text to fit within a given width, appending "..." if needed.
 * @param {string} text - The text to truncate
 * @param {Object} font - Embedded font object
 * @param {number} fontSize - Font size in points
 * @param {number} maxWidth - Maximum width in points
 * @returns {string} Truncated text
 */
function truncateText(text, font, fontSize, maxWidth) {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

/**
 * @description Parse a compareTo string like "3m" or "1y" into an ISO date.
 * Supports Nm (months) and Ny (years) formats.
 * @param {string|undefined} compareTo - The comparison period string
 * @returns {string|null} ISO date string (YYYY-MM-DD) or null if not set/invalid
 */
export function parseCompareToDate(compareTo) {
  if (!compareTo || typeof compareTo !== "string") return null;

  const match = compareTo.trim().match(/^(\d+)(m|y)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const months = unit === "y" ? value * 12 : value;

  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * @description Format an ISO date as DD/MM/YYYY for UK display.
 * @param {string} isoDate - ISO date string (YYYY-MM-DD)
 * @returns {string} Formatted date like "23/12/2025"
 */
function formatDateUK(isoDate) {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

/**
 * @description Format a difference value and percentage for a PDF cell.
 * Returns a string like "+£1,234 (+5.2%)" or "£-1,234 (-5.2%)".
 * @param {number|null} diff - The value difference
 * @param {number|null} base - The historic base value (for % calculation)
 * @returns {string} Formatted difference string
 */
function formatDiffCell(diff, base) {
  if (diff === null || diff === undefined) return "N/A";

  // Format value part
  const sign = diff > 0 ? "+" : "";
  const valueStr = sign + formatGBP(diff);

  // Format percent part
  let pctStr;
  if (base === null || base === undefined || base === 0) {
    pctStr = "(n/a)";
  } else {
    const pct = (diff / base) * 100;
    const pctSign = pct > 0 ? "+" : "";
    pctStr = "(" + pctSign + pct.toFixed(1) + "%)";
  }

  return valueStr + " " + pctStr;
}

/**
 * @description Resolve report params tokens to build the params array.
 * Replaces tokens like "USER1" with actual values from report_params.
 * @param {Array<string>} params - Raw params array from the report definition
 * @returns {Array<string>} Params with tokens substituted
 */
function resolveParams(params) {
  if (!params || params.length === 0) return [];
  try {
    const tokenMap = getReportParams();
    const tokens = Object.keys(tokenMap);
    return params.map(function (param) {
      let result = param;
      for (let i = 0; i < tokens.length; i++) {
        result = result.split(tokens[i]).join(tokenMap[tokens[i]]);
      }
      return result;
    });
  } catch {
    return params;
  }
}

/**
 * @description Build a lookup map of user initials (uppercase) to their
 * portfolio summary object.
 * @param {Array<Object>} summaries - All user summaries
 * @returns {Object} Map of initials to summary
 */
function buildInitialsMap(summaries) {
  const map = {};
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    if (s.accounts && s.accounts.length > 0 && s.user.initials) {
      map[s.user.initials.toUpperCase()] = s;
    }
  }
  return map;
}

/**
 * @description Render the Portfolio Summary Valuation block into a shared PDF context.
 * Draws the block title, per-user account tables, and optional combined totals.
 * Does not add footers — the caller is responsible for that.
 * @param {Object} ctx - Shared rendering context
 * @param {Object} ctx.pdf - The PDF document
 * @param {Object} ctx.page - Current page (updated in place on ctx)
 * @param {Array<Object>} ctx.pages - Array of all pages (pushed to when new pages added)
 * @param {number} ctx.y - Current y position (updated in place on ctx)
 * @param {Array<number>} ctx.pageWidths - Per-page usable widths (pushed to when new pages added)
 * @param {Array<string>} [params] - Optional params array controlling which
 *   users and combined sections to render (e.g. ["AW", "BW", "AW + BW"]).
 *   Tokens like "USER1" are substituted from report_params.
 *   When empty, all users with accounts are shown with combined totals.
 * @param {Object} [blockDef] - Optional block definition from composite reports.
 *   May contain `compareTo` (e.g. "3m", "1y") to enable comparison mode.
 */
export function renderPortfolioSummaryBlock(ctx, params, blockDef) {
  const pdf = ctx.pdf;
  let page = ctx.page;
  const pages = ctx.pages;
  let y = ctx.y;
  const fonts = ctx.fonts;

  // Fetch all user summaries
  const users = getAllUsers();
  const summaries = [];
  for (const user of users) {
    const summary = getPortfolioSummary(user.id);
    if (summary) {
      summaries.push(summary);
    }
  }

  // Filter to users with accounts
  const activeUsers = summaries.filter(function (s) {
    return s.accounts && s.accounts.length > 0;
  });

  const testMode = isTestMode();
  const headerRowColour = testMode ? COLOURS.green100 : COLOURS.brand100;

  /**
   * @description Check if there is enough vertical space for the next section.
   * If not, add a new page with header and reset y.
   * @param {number} needed - Points of vertical space needed
   */
  function ensureSpace(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage({ size: "a4", orientation: "portrait" });
      pages.push(page);
      if (ctx.pageWidths) ctx.pageWidths.push(USABLE_WIDTH);
      y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP, fonts);
    }
  }

  /**
   * @description Draw the column header row for a summary table.
   */
  function drawHeaderRow() {
    ensureSpace(HEADER_ROW_HEIGHT + ROW_HEIGHT + 4);

    // Header background
    page.drawRectangle({
      x: MARGIN_LEFT,
      y: y - HEADER_ROW_HEIGHT,
      width: USABLE_WIDTH,
      height: HEADER_ROW_HEIGHT,
      color: headerRowColour,
    });

    // Header text
    for (const col of COLUMNS) {
      if (col.align === "right") {
        drawRightAligned(
          page, col.label, MARGIN_LEFT + col.x, col.width,
          y - HEADER_ROW_HEIGHT + 5, fonts.bold,
          FONT_SIZE_HEADER, COLOURS.brand700,
        );
      } else {
        page.drawText(col.label, {
          x: MARGIN_LEFT + col.x + 2,
          y: y - HEADER_ROW_HEIGHT + 5,
          font: fonts.bold,
          size: FONT_SIZE_HEADER,
          color: COLOURS.brand700,
        });
      }
    }

    // Header bottom border
    page.drawLine({
      start: { x: MARGIN_LEFT, y: y - HEADER_ROW_HEIGHT },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y - HEADER_ROW_HEIGHT },
      color: COLOURS.brand200,
      thickness: 0.5,
    });
    y -= HEADER_ROW_HEIGHT;
  }

  /**
   * @description Draw a single data row in the summary table.
   * @param {Object} values - Cell values keyed by column key
   * @param {boolean} isBold - Whether to use bold font
   * @param {Object} bgColour - Optional background colour for the row
   */
  function drawDataRow(values, isBold, bgColour) {
    ensureSpace(ROW_HEIGHT + 2);
    const rowY = y - ROW_HEIGHT;
    const textY = rowY + 4;
    const font = isBold ? fonts.bold : fonts.medium;

    if (bgColour) {
      page.drawRectangle({
        x: MARGIN_LEFT,
        y: rowY,
        width: USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: bgColour,
      });
    }

    for (const col of COLUMNS) {
      let cellText = values[col.key] || "";
      cellText = truncateText(cellText, font, FONT_SIZE_ROW, col.width - 4);

      if (col.align === "right") {
        drawRightAligned(
          page, cellText, MARGIN_LEFT + col.x, col.width,
          textY, font, FONT_SIZE_ROW, COLOURS.black,
        );
      } else {
        page.drawText(cellText, {
          x: MARGIN_LEFT + col.x + 2,
          y: textY,
          font: font,
          size: FONT_SIZE_ROW,
          color: COLOURS.black,
        });
      }
    }

    // Row bottom border
    page.drawLine({
      start: { x: MARGIN_LEFT, y: rowY },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: rowY },
      color: COLOURS.brand100,
      thickness: 0.3,
    });
    y -= ROW_HEIGHT;
  }

  /**
   * @description Draw a data row with coloured difference values.
   * Uses green for positive, red for negative, grey for N/A.
   * @param {Object} values - Cell values keyed by column key
   * @param {Object} diffs - Numeric diff values keyed by column key (for colour selection)
   * @param {boolean} isBold - Whether to use bold font
   * @param {Object} bgColour - Optional background colour for the row
   */
  function drawDiffDataRow(values, diffs, isBold, bgColour) {
    ensureSpace(ROW_HEIGHT + 2);
    const rowY = y - ROW_HEIGHT;
    const textY = rowY + 4;
    const font = isBold ? fonts.bold : fonts.medium;

    if (bgColour) {
      page.drawRectangle({
        x: MARGIN_LEFT,
        y: rowY,
        width: USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: bgColour,
      });
    }

    for (const col of COLUMNS) {
      let cellText = values[col.key] || "";
      const diffVal = diffs ? diffs[col.key] : null;

      // Choose colour based on diff value (null = N/A grey, >0 green, <0 red)
      let textColour;
      if (col.key === "account" || col.key === "reference") {
        textColour = COLOURS.black;
      } else if (cellText === "N/A") {
        textColour = COLOURS.grey400;
      } else if (diffVal !== null && diffVal !== undefined && diffVal > 0) {
        textColour = COLOURS.green700;
      } else if (diffVal !== null && diffVal !== undefined && diffVal < 0) {
        textColour = COLOURS.red600;
      } else {
        textColour = COLOURS.grey400;
      }

      cellText = truncateText(cellText, font, FONT_SIZE_ROW, col.width - 4);

      if (col.align === "right") {
        drawRightAligned(
          page, cellText, MARGIN_LEFT + col.x, col.width,
          textY, font, FONT_SIZE_ROW, textColour,
        );
      } else {
        page.drawText(cellText, {
          x: MARGIN_LEFT + col.x + 2,
          y: textY,
          font: font,
          size: FONT_SIZE_ROW,
          color: textColour,
        });
      }
    }

    // Row bottom border
    page.drawLine({
      start: { x: MARGIN_LEFT, y: rowY },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: rowY },
      color: COLOURS.brand100,
      thickness: 0.3,
    });
    y -= ROW_HEIGHT;
  }

  /**
   * @description Draw a section sub-heading (e.g., "Valuation at 23/12/2025").
   * Smaller than a user heading, used to label comparison sub-sections.
   * @param {string} text - The heading text
   */
  function drawSubHeading(text) {
    ensureSpace(16);
    page.drawText(text, {
      x: MARGIN_LEFT + 2,
      y: y - 8,
      font: fonts.medium,
      size: 7,
      color: COLOURS.brand600,
    });
    y -= 14;
  }

  /**
   * @description Render a summary table body (header + account rows + total row).
   * Reusable for both current and historic sections.
   * @param {Object} summary - A user's portfolio summary
   */
  function renderSummaryTable(summary) {
    drawHeaderRow();

    for (let a = 0; a < summary.accounts.length; a++) {
      const account = summary.accounts[a];
      const typeLabel = ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type;
      const cashNA = account.cash_available === false;

      drawDataRow({
        account: typeLabel,
        reference: account.account_ref,
        investments: formatGBP(account.investments_total),
        cash: cashNA ? "N/A" : formatGBP(account.cash_balance),
        total: cashNA ? "N/A" : formatGBP(account.account_total),
      }, false, null);
    }

    const totalsCashNA = summary.totals.cash_available === false;
    drawDataRow({
      account: "",
      reference: "",
      investments: formatGBP(summary.totals.investments),
      cash: totalsCashNA ? "N/A" : formatGBP(summary.totals.cash),
      total: totalsCashNA ? "N/A" : formatGBP(summary.totals.grand_total),
    }, true, headerRowColour);
  }

  /**
   * @description Render a difference table for a single user.
   * Shows value + percentage change per account row.
   * @param {Object} current - Current portfolio summary
   * @param {Object} historic - Historic portfolio summary
   */
  function renderDiffTable(current, historic) {
    drawHeaderRow();

    for (let a = 0; a < current.accounts.length; a++) {
      const acct = current.accounts[a];
      let hAcct = null;
      for (let h = 0; h < historic.accounts.length; h++) {
        if (historic.accounts[h].id === acct.id) {
          hAcct = historic.accounts[h];
          break;
        }
      }

      const typeLabel = ACCOUNT_TYPE_LABELS[acct.account_type] || acct.account_type;
      const cashUnavailable = (acct.cash_available === false) || (hAcct && hAcct.cash_available === false);

      const invDiff = hAcct ? acct.investments_total - hAcct.investments_total : null;
      const invBase = hAcct ? hAcct.investments_total : null;
      const cashDiff = (!cashUnavailable && hAcct) ? acct.cash_balance - hAcct.cash_balance : null;
      const cashBase = (!cashUnavailable && hAcct) ? hAcct.cash_balance : null;
      const totalDiff = (!cashUnavailable && hAcct) ? acct.account_total - hAcct.account_total : null;
      const totalBase = (!cashUnavailable && hAcct) ? hAcct.account_total : null;

      drawDiffDataRow({
        account: typeLabel,
        reference: acct.account_ref,
        investments: formatDiffCell(invDiff, invBase),
        cash: cashUnavailable ? "N/A" : formatDiffCell(cashDiff, cashBase),
        total: cashUnavailable ? "N/A" : formatDiffCell(totalDiff, totalBase),
      }, {
        investments: invDiff,
        cash: cashDiff,
        total: totalDiff,
      }, false, null);
    }

    // Totals row
    const anyNA = current.accounts.some(function (a) { return a.cash_available === false; }) ||
                historic.accounts.some(function (a) { return a.cash_available === false; });
    const totalsNA = anyNA || current.totals.cash_available === false || historic.totals.cash_available === false;

    const invTotalDiff = current.totals.investments - historic.totals.investments;
    const invTotalBase = historic.totals.investments;
    const cashTotalDiff = totalsNA ? null : current.totals.cash - historic.totals.cash;
    const cashTotalBase = totalsNA ? null : historic.totals.cash;
    const grandTotalDiff = totalsNA ? null : current.totals.grand_total - historic.totals.grand_total;
    const grandTotalBase = totalsNA ? null : historic.totals.grand_total;

    drawDiffDataRow({
      account: "",
      reference: "",
      investments: formatDiffCell(invTotalDiff, invTotalBase),
      cash: totalsNA ? "N/A" : formatDiffCell(cashTotalDiff, cashTotalBase),
      total: totalsNA ? "N/A" : formatDiffCell(grandTotalDiff, grandTotalBase),
    }, {
      investments: invTotalDiff,
      cash: cashTotalDiff,
      total: grandTotalDiff,
    }, true, headerRowColour);
  }

  /**
   * @description Render comparison sections for a single user:
   * historic valuation, current valuation, and difference.
   * @param {Object} currentSummary - Current portfolio summary
   * @param {Object} historicSummary - Historic portfolio summary
   * @param {string} dateStr - Formatted comparison date (DD/MM/YYYY)
   */
  function renderUserComparisonSections(currentSummary, historicSummary, dateStr) {
    const user = currentSummary.user;
    const userName = user.first_name + " " + user.last_name;

    // User heading
    ensureSpace(USER_HEADING_HEIGHT + HEADER_ROW_HEIGHT + ROW_HEIGHT);
    page.drawText(userName, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_USER_HEADING,
      font: fonts.bold,
      size: FONT_SIZE_USER_HEADING,
      color: COLOURS.brand800,
    });
    y -= USER_HEADING_HEIGHT;

    // Historic section
    drawSubHeading("Valuation at " + dateStr);
    renderSummaryTable(historicSummary);
    y -= 4;

    // Current section
    drawSubHeading("Valuation using latest prices");
    renderSummaryTable(currentSummary);
    y -= 4;

    // Difference section
    drawSubHeading("Difference");
    renderDiffTable(currentSummary, historicSummary);
    y -= 8;
  }

  /**
   * @description Render comparison sections for combined totals.
   * Aggregates multiple users by account type for historic, current, and difference.
   * @param {Array<Object>} currentSummaries - Current user summaries
   * @param {Array<Object>} historicSummaries - Historic user summaries
   * @param {string} dateStr - Formatted comparison date (DD/MM/YYYY)
   */
  function renderCombinedComparisonSections(currentSummaries, historicSummaries, dateStr) {
    // Build aggregated summary objects for current and historic
    const currentAgg = aggregateSummaries(currentSummaries);
    const historicAgg = aggregateSummaries(historicSummaries);

    // Separator line and heading
    ensureSpace(30 + HEADER_ROW_HEIGHT + ROW_HEIGHT * 4);
    page.drawLine({
      start: { x: MARGIN_LEFT, y: y },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y },
      color: COLOURS.brand200,
      thickness: 1.5,
    });
    y -= 14;

    page.drawText("Combined Totals", {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_COMBINED_HEADING,
      font: fonts.bold,
      size: FONT_SIZE_COMBINED_HEADING,
      color: COLOURS.brand800,
    });
    y -= FONT_SIZE_COMBINED_HEADING + 6;

    // Historic combined
    drawSubHeading("Valuation at " + dateStr);
    renderAggregatedTable(historicAgg);
    y -= 4;

    // Current combined
    drawSubHeading("Valuation using latest prices");
    renderAggregatedTable(currentAgg);
    y -= 4;

    // Difference combined
    drawSubHeading("Difference");
    renderAggregatedDiffTable(currentAgg, historicAgg);
    y -= 8;
  }

  /**
   * @description Aggregate multiple user summaries by account type.
   * Returns an object with byType map and overall totals.
   * @param {Array<Object>} userSummaries - Array of user summaries
   * @returns {Object} { byType, totalInvestments, totalCash, totalGrand, cashAvailable }
   */
  function aggregateSummaries(userSummaries) {
    const byType = {};
    let totalInvestments = 0;
    let totalCash = 0;
    let totalGrand = 0;
    let anyCashUnavailable = false;

    for (let u = 0; u < userSummaries.length; u++) {
      const summary = userSummaries[u];
      for (let a = 0; a < summary.accounts.length; a++) {
        const account = summary.accounts[a];
        if (!byType[account.account_type]) {
          byType[account.account_type] = { investments: 0, cash: 0, total: 0, cashAvailable: true };
        }
        byType[account.account_type].investments += account.investments_total;
        if (account.cash_available === false) {
          byType[account.account_type].cashAvailable = false;
          anyCashUnavailable = true;
        } else {
          byType[account.account_type].cash += account.cash_balance || 0;
          byType[account.account_type].total += account.account_total || 0;
        }
      }
      totalInvestments += summary.totals.investments;
      if (summary.totals.cash_available === false) {
        anyCashUnavailable = true;
      } else {
        totalCash += summary.totals.cash || 0;
        totalGrand += summary.totals.grand_total || 0;
      }
    }

    return {
      byType: byType,
      totalInvestments: totalInvestments,
      totalCash: totalCash,
      totalGrand: totalGrand,
      cashAvailable: !anyCashUnavailable,
    };
  }

  /**
   * @description Render an aggregated (combined) table from pre-aggregated data.
   * @param {Object} agg - Aggregated data from aggregateSummaries()
   */
  function renderAggregatedTable(agg) {
    drawHeaderRow();

    const typeOrder = ["isa", "sipp", "trading"];
    for (let t = 0; t < typeOrder.length; t++) {
      const type = typeOrder[t];
      const totals = agg.byType[type];
      if (!totals) continue;

      drawDataRow({
        account: ACCOUNT_TYPE_LABELS[type] || type,
        reference: "",
        investments: formatGBP(totals.investments),
        cash: totals.cashAvailable ? formatGBP(totals.cash) : "N/A",
        total: totals.cashAvailable ? formatGBP(totals.total) : "N/A",
      }, false, null);
    }

    drawDataRow({
      account: "",
      reference: "",
      investments: formatGBP(agg.totalInvestments),
      cash: agg.cashAvailable ? formatGBP(agg.totalCash) : "N/A",
      total: agg.cashAvailable ? formatGBP(agg.totalGrand) : "N/A",
    }, true, headerRowColour);
  }

  /**
   * @description Render an aggregated difference table comparing current vs historic.
   * @param {Object} currentAgg - Current aggregated data
   * @param {Object} historicAgg - Historic aggregated data
   */
  function renderAggregatedDiffTable(currentAgg, historicAgg) {
    drawHeaderRow();

    const typeOrder = ["isa", "sipp", "trading"];
    for (let t = 0; t < typeOrder.length; t++) {
      const type = typeOrder[t];
      const cTotals = currentAgg.byType[type];
      const hTotals = historicAgg.byType[type];
      if (!cTotals && !hTotals) continue;

      const cInv = cTotals ? cTotals.investments : 0;
      const hInv = hTotals ? hTotals.investments : 0;
      const cashNA = (cTotals && !cTotals.cashAvailable) || (hTotals && !hTotals.cashAvailable);
      const invDiff = cInv - hInv;

      let cashDiff = null;
      let cashBase = null;
      let totalDiff = null;
      let totalBase = null;
      if (!cashNA && cTotals && hTotals) {
        cashDiff = cTotals.cash - hTotals.cash;
        cashBase = hTotals.cash;
        totalDiff = cTotals.total - hTotals.total;
        totalBase = hTotals.total;
      }

      drawDiffDataRow({
        account: ACCOUNT_TYPE_LABELS[type] || type,
        reference: "",
        investments: formatDiffCell(invDiff, hInv),
        cash: cashNA ? "N/A" : formatDiffCell(cashDiff, cashBase),
        total: cashNA ? "N/A" : formatDiffCell(totalDiff, totalBase),
      }, {
        investments: invDiff,
        cash: cashDiff,
        total: totalDiff,
      }, false, null);
    }

    // Grand total diff
    const totalsNA = !currentAgg.cashAvailable || !historicAgg.cashAvailable;
    const invTotalDiff = currentAgg.totalInvestments - historicAgg.totalInvestments;
    const cashTDiff = totalsNA ? null : currentAgg.totalCash - historicAgg.totalCash;
    const grandTDiff = totalsNA ? null : currentAgg.totalGrand - historicAgg.totalGrand;

    drawDiffDataRow({
      account: "",
      reference: "",
      investments: formatDiffCell(invTotalDiff, historicAgg.totalInvestments),
      cash: totalsNA ? "N/A" : formatDiffCell(cashTDiff, historicAgg.totalCash),
      total: totalsNA ? "N/A" : formatDiffCell(grandTDiff, historicAgg.totalGrand),
    }, {
      investments: invTotalDiff,
      cash: cashTDiff,
      total: grandTDiff,
    }, true, headerRowColour);
  }

  /**
   * @description Render a single user's section: heading, header row,
   * account rows, and per-user total row.
   * @param {Object} summary - A user's portfolio summary
   */
  function renderUserSection(summary) {
    const user = summary.user;

    // User heading
    ensureSpace(USER_HEADING_HEIGHT + HEADER_ROW_HEIGHT + ROW_HEIGHT);
    page.drawText(user.first_name + " " + user.last_name, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_USER_HEADING,
      font: fonts.bold,
      size: FONT_SIZE_USER_HEADING,
      color: COLOURS.brand800,
    });
    y -= USER_HEADING_HEIGHT;

    // Header row
    drawHeaderRow();

    // Account rows
    for (let a = 0; a < summary.accounts.length; a++) {
      const account = summary.accounts[a];
      const typeLabel = ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type;
      const cashSuffix = account.cash_warning ? " *" : "";

      drawDataRow({
        account: typeLabel,
        reference: account.account_ref,
        investments: formatGBP(account.investments_total),
        cash: formatGBP(account.cash_balance) + cashSuffix,
        total: formatGBP(account.account_total),
      }, false, null);
    }

    // Per-user total row
    drawDataRow({
      account: "",
      reference: "",
      investments: formatGBP(summary.totals.investments),
      cash: formatGBP(summary.totals.cash),
      total: formatGBP(summary.totals.grand_total),
    }, true, headerRowColour);

    y -= 4; // gap after user section
  }

  /**
   * @description Render a combined totals section aggregating multiple users.
   * @param {Array<Object>} userSummaries - Array of user summaries to aggregate
   */
  function renderCombinedSection(userSummaries) {
    // Aggregate by account type
    const byType = {};
    let totalInvestments = 0;
    let totalCash = 0;
    let totalGrand = 0;

    for (let u = 0; u < userSummaries.length; u++) {
      const summary = userSummaries[u];
      for (let a = 0; a < summary.accounts.length; a++) {
        const account = summary.accounts[a];
        if (!byType[account.account_type]) {
          byType[account.account_type] = { investments: 0, cash: 0, total: 0 };
        }
        byType[account.account_type].investments += account.investments_total;
        byType[account.account_type].cash += account.cash_balance;
        byType[account.account_type].total += account.account_total;
      }
      totalInvestments += summary.totals.investments;
      totalCash += summary.totals.cash;
      totalGrand += summary.totals.grand_total;
    }

    // Separator line and heading
    ensureSpace(30 + HEADER_ROW_HEIGHT + ROW_HEIGHT * 4);

    page.drawLine({
      start: { x: MARGIN_LEFT, y: y },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y },
      color: COLOURS.brand200,
      thickness: 1.5,
    });
    y -= 14;

    page.drawText("Combined Totals", {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_COMBINED_HEADING,
      font: fonts.bold,
      size: FONT_SIZE_COMBINED_HEADING,
      color: COLOURS.brand800,
    });
    y -= FONT_SIZE_COMBINED_HEADING + 6;

    // Header row
    drawHeaderRow();

    // Account type rows
    const typeOrder = ["isa", "sipp", "trading"];
    for (let t = 0; t < typeOrder.length; t++) {
      const type = typeOrder[t];
      const totals = byType[type];
      if (!totals) continue;

      drawDataRow({
        account: ACCOUNT_TYPE_LABELS[type] || type,
        reference: "",
        investments: formatGBP(totals.investments),
        cash: formatGBP(totals.cash),
        total: formatGBP(totals.total),
      }, false, null);
    }

    // Grand total row
    drawDataRow({
      account: "",
      reference: "",
      investments: formatGBP(totalInvestments),
      cash: formatGBP(totalCash),
      total: formatGBP(totalGrand),
    }, true, headerRowColour);
  }

  // --- Comparison mode ---
  const compareTo = blockDef && blockDef.compareTo ? blockDef.compareTo : null;
  const compareDate = parseCompareToDate(compareTo);
  const compareDateStr = compareDate ? formatDateUK(compareDate) : null;

  // Fetch historic summaries if comparing
  const historicSummaries = [];
  let historicInitialsMap = {};
  if (compareDate) {
    for (const user of users) {
      const hSummary = getPortfolioSummaryAtDate(user.id, compareDate);
      if (hSummary) {
        historicSummaries.push(hSummary);
      }
    }
    historicInitialsMap = buildInitialsMap(historicSummaries);
  }

  // --- Report title ---
  page.drawText("Portfolio Summary Valuation", {
    x: MARGIN_LEFT,
    y: y - FONT_SIZE_TITLE,
    font: fonts.bold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.brand800,
  });
  y -= FONT_SIZE_TITLE + 4;

  if (compareDateStr) {
    page.drawText("Compared with " + compareDateStr, {
      x: MARGIN_LEFT,
      y: y - 8,
      font: fonts.medium,
      size: 8,
      color: COLOURS.brand600,
    });
    y -= 16;
  } else {
    y -= 8;
  }

  // --- Render sections based on params ---
  const resolvedParams = resolveParams(params);

  if (!resolvedParams || resolvedParams.length === 0) {
    // No params: show all users + combined if 2+ users
    if (compareDate) {
      for (let u = 0; u < activeUsers.length; u++) {
        const hUser = historicInitialsMap[activeUsers[u].user.initials.toUpperCase()];
        if (hUser) {
          renderUserComparisonSections(activeUsers[u], hUser, compareDateStr);
        } else {
          renderUserSection(activeUsers[u]);
        }
      }
      if (activeUsers.length > 1) {
        const hActiveUsers = historicSummaries.filter(function (s) {
          return s.accounts && s.accounts.length > 0;
        });
        renderCombinedComparisonSections(activeUsers, hActiveUsers, compareDateStr);
      }
    } else {
      for (let u2 = 0; u2 < activeUsers.length; u2++) {
        renderUserSection(activeUsers[u2]);
      }
      if (activeUsers.length > 1) {
        renderCombinedSection(activeUsers);
      }
    }
  } else {
    const initialsMap = buildInitialsMap(summaries);

    for (let p = 0; p < resolvedParams.length; p++) {
      const entry = resolvedParams[p].trim();

      // "new_page" forces a page break and redraws the page header
      if (entry === "new_page") {
        page = pdf.addPage({ size: "a4", orientation: "portrait" });
        pages.push(page);
        if (ctx.pageWidths) ctx.pageWidths.push(USABLE_WIDTH);
        y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP, fonts);
        continue;
      }

      if (entry.indexOf("+") !== -1) {
        // Combined section
        const parts = entry.split("+");
        const combinedCurrentUsers = [];
        const combinedHistoricUsers = [];
        for (let c = 0; c < parts.length; c++) {
          const key = parts[c].trim().toUpperCase();
          if (initialsMap[key]) {
            combinedCurrentUsers.push(initialsMap[key]);
          }
          if (compareDate && historicInitialsMap[key]) {
            combinedHistoricUsers.push(historicInitialsMap[key]);
          }
        }
        if (combinedCurrentUsers.length > 0) {
          if (compareDate && combinedHistoricUsers.length > 0) {
            renderCombinedComparisonSections(combinedCurrentUsers, combinedHistoricUsers, compareDateStr);
          } else {
            renderCombinedSection(combinedCurrentUsers);
          }
        }
      } else {
        // Single user section
        const userKey = entry.toUpperCase();
        if (initialsMap[userKey]) {
          if (compareDate && historicInitialsMap[userKey]) {
            renderUserComparisonSections(initialsMap[userKey], historicInitialsMap[userKey], compareDateStr);
          } else {
            renderUserSection(initialsMap[userKey]);
          }
        }
      }
    }
  }

  // Write back modified state
  ctx.page = page;
  ctx.y = y;
}

/**
 * @description Generate a standalone PDF for the Portfolio Summary Valuation report.
 * Creates a PDF document, renders the block, adds footers, and returns bytes.
 * @param {Array<string>} [params] - Optional params array controlling which
 *   users and combined sections to render.
 * @param {string} [compareTo] - Optional comparison period (e.g. "3m", "1y")
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generatePortfolioSummaryPdf(params, compareTo) {
  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const page = pdf.addPage({ size: "a4", orientation: "portrait" });
  const pages = [page];
  const y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP, fonts);

  const blockDef = compareTo ? { compareTo: compareTo } : {};
  const ctx = { pdf: pdf, page: page, pages: pages, y: y, fonts: fonts };
  renderPortfolioSummaryBlock(ctx, params, blockDef);

  drawPageFooters(ctx.pages, "Portfolio Summary Valuation", MARGIN_LEFT, USABLE_WIDTH, fonts);
  return await pdf.save();
}
