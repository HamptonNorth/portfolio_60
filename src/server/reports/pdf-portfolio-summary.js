import { PDF, rgb, StandardFonts, Standard14Font } from "@libpdf/core";
import { getPortfolioSummary } from "../services/portfolio-service.js";
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
 * @param {string} fontName - Standard font name
 * @param {number} fontSize - Font size in points
 * @param {Object} color - RGB colour
 */
function drawRightAligned(page, text, x, colWidth, y, fontName, fontSize, color) {
  const font = Standard14Font.of(fontName);
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  page.drawText(text, {
    x: x + colWidth - textWidth - 2,
    y: y,
    font: fontName,
    size: fontSize,
    color: color,
  });
}

/**
 * @description Truncate text to fit within a given width, appending "..." if needed.
 * @param {string} text - The text to truncate
 * @param {string} fontName - Standard font name
 * @param {number} fontSize - Font size in points
 * @param {number} maxWidth - Maximum width in points
 * @returns {string} Truncated text
 */
function truncateText(text, fontName, fontSize, maxWidth) {
  const font = Standard14Font.of(fontName);
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;

  var truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
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
      var result = param;
      for (var i = 0; i < tokens.length; i++) {
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
  var map = {};
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i];
    if (s.accounts && s.accounts.length > 0 && s.user.initials) {
      map[s.user.initials.toUpperCase()] = s;
    }
  }
  return map;
}

/**
 * @description Generate a PDF for the Portfolio Summary Valuation report.
 * Fetches data from the database and renders it as an A4 portrait PDF
 * with per-user account tables and optional combined totals, matching
 * the HTML report layout.
 * @param {Array<string>} [params] - Optional params array controlling which
 *   users and combined sections to render (e.g. ["AW", "BW", "AW + BW"]).
 *   Tokens like "USER1" are substituted from report_params.
 *   When empty, all users with accounts are shown with combined totals.
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generatePortfolioSummaryPdf(params) {
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

  const pdf = PDF.create();
  var page = pdf.addPage({ size: "a4", orientation: "portrait" });
  var pages = [page];

  // Draw page header (logo + "Portfolio 60") and get starting y position
  var y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP);

  /**
   * @description Check if there is enough vertical space for the next section.
   * If not, add a new page with header and reset y.
   * @param {number} needed - Points of vertical space needed
   */
  function ensureSpace(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage({ size: "a4", orientation: "portrait" });
      pages.push(page);
      y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP);
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
          y - HEADER_ROW_HEIGHT + 5, StandardFonts.HelveticaBold,
          FONT_SIZE_HEADER, COLOURS.brand700,
        );
      } else {
        page.drawText(col.label, {
          x: MARGIN_LEFT + col.x + 2,
          y: y - HEADER_ROW_HEIGHT + 5,
          font: StandardFonts.HelveticaBold,
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
    const fontName = isBold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;

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
      var cellText = values[col.key] || "";
      cellText = truncateText(cellText, fontName, FONT_SIZE_ROW, col.width - 4);

      if (col.align === "right") {
        drawRightAligned(
          page, cellText, MARGIN_LEFT + col.x, col.width,
          textY, fontName, FONT_SIZE_ROW, COLOURS.black,
        );
      } else {
        page.drawText(cellText, {
          x: MARGIN_LEFT + col.x + 2,
          y: textY,
          font: fontName,
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
   * @description Render a single user's section: heading, header row,
   * account rows, and per-user total row.
   * @param {Object} summary - A user's portfolio summary
   */
  function renderUserSection(summary) {
    var user = summary.user;

    // User heading
    ensureSpace(USER_HEADING_HEIGHT + HEADER_ROW_HEIGHT + ROW_HEIGHT);
    page.drawText(user.first_name + " " + user.last_name, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_USER_HEADING,
      font: StandardFonts.HelveticaBold,
      size: FONT_SIZE_USER_HEADING,
      color: COLOURS.brand800,
    });
    y -= USER_HEADING_HEIGHT;

    // Header row
    drawHeaderRow();

    // Account rows
    for (var a = 0; a < summary.accounts.length; a++) {
      var account = summary.accounts[a];
      var typeLabel = ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type;
      var cashSuffix = account.cash_warning ? " *" : "";

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
    var byType = {};
    var totalInvestments = 0;
    var totalCash = 0;
    var totalGrand = 0;

    for (var u = 0; u < userSummaries.length; u++) {
      var summary = userSummaries[u];
      for (var a = 0; a < summary.accounts.length; a++) {
        var account = summary.accounts[a];
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
      font: StandardFonts.HelveticaBold,
      size: FONT_SIZE_COMBINED_HEADING,
      color: COLOURS.brand800,
    });
    y -= FONT_SIZE_COMBINED_HEADING + 6;

    // Header row
    drawHeaderRow();

    // Account type rows
    var typeOrder = ["isa", "sipp", "trading"];
    for (var t = 0; t < typeOrder.length; t++) {
      var type = typeOrder[t];
      var totals = byType[type];
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

  // --- Report title ---
  page.drawText("Portfolio Summary Valuation", {
    x: MARGIN_LEFT,
    y: y - FONT_SIZE_TITLE,
    font: StandardFonts.HelveticaBold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.brand800,
  });
  y -= FONT_SIZE_TITLE + 12;

  // --- Render sections based on params ---
  var resolvedParams = resolveParams(params);

  if (!resolvedParams || resolvedParams.length === 0) {
    // No params: show all users + combined if 2+ users
    for (var u = 0; u < activeUsers.length; u++) {
      renderUserSection(activeUsers[u]);
    }
    if (activeUsers.length > 1) {
      renderCombinedSection(activeUsers);
    }
  } else {
    var initialsMap = buildInitialsMap(summaries);

    for (var p = 0; p < resolvedParams.length; p++) {
      var entry = resolvedParams[p].trim();

      if (entry.indexOf("+") !== -1) {
        // Combined section
        var parts = entry.split("+");
        var combinedUsers = [];
        for (var c = 0; c < parts.length; c++) {
          var key = parts[c].trim().toUpperCase();
          if (initialsMap[key]) {
            combinedUsers.push(initialsMap[key]);
          }
        }
        if (combinedUsers.length > 0) {
          renderCombinedSection(combinedUsers);
        }
      } else {
        // Single user section
        var userKey = entry.toUpperCase();
        if (initialsMap[userKey]) {
          renderUserSection(initialsMap[userKey]);
        }
      }
    }
  }

  // --- Fixed footer on every page: date left, title centre, page number right ---
  drawPageFooters(pages, "Portfolio Summary Valuation", MARGIN_LEFT, USABLE_WIDTH);

  return await pdf.save();
}
