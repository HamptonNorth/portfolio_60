import { PDF, rgb, StandardFonts, Standard14Font } from "@libpdf/core";
import { getPortfolioDetail } from "../services/portfolio-detail-service.js";
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
  brand300: rgb(0.7, 0.73, 0.78),
  brand200: rgb(0.82, 0.85, 0.9),
  brand100: rgb(0.91, 0.93, 0.96),
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
  green100: rgb(0.86, 0.94, 0.87),
  green700: rgb(0.09, 0.46, 0.2),
  red600: rgb(0.86, 0.15, 0.15),
};

/** @description A4 landscape page dimensions in points */
const A4_LANDSCAPE_WIDTH = 841.89;
const A4_LANDSCAPE_HEIGHT = 595.28;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const USABLE_WIDTH = A4_LANDSCAPE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

/**
 * @description Account type display labels.
 * @type {Object<string, string>}
 */
const ACCOUNT_TYPE_LABELS = {
  isa: "ISA",
  sipp: "SIPP",
  trading: "Trading",
};

/** @description Font sizes used in the report */
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION_HEADING = 10;
const FONT_SIZE_HEADER = 7;
const FONT_SIZE_ROW = 7;
const FONT_SIZE_FOOTER = 6;

/** @description Row heights in points */
const ROW_HEIGHT = 14;
const HEADER_ROW_HEIGHT = 16;
const SECTION_HEADING_HEIGHT = 20;

/**
 * @description Base column definitions (before change columns are appended).
 * Widths are designed for landscape A4 with room for up to 4 change columns.
 * @type {Array<{key: string, label: string, width: number, align: string}>}
 */
const BASE_COLUMNS = [
  { key: "investment", label: "Investment", width: 190, align: "left" },
  { key: "currency", label: "Ccy", width: 30, align: "left" },
  { key: "quantity", label: "Quantity", width: 80, align: "right" },
  { key: "avgCost", label: "Avg Cost", width: 70, align: "right" },
  { key: "price", label: "Price", width: 70, align: "right" },
  { key: "valueLocal", label: "Value", width: 70, align: "right" },
  { key: "valueGBP", label: "Value GBP", width: 80, align: "right" },
];

/**
 * @description Format a number as whole pounds with thousand separators.
 * @param {number} value - The value
 * @returns {string} Formatted string like "1,235"
 */
function formatNumber(value) {
  if (value === 0) return "0";
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * @description Format a price to a sensible number of decimal places.
 * @param {number} price - The price value
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  if (price === 0) return "0";
  if (price < 10) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return Math.round(price).toLocaleString("en-GB");
}

/**
 * @description Format a quantity with appropriate decimal places.
 * @param {number} qty - The quantity
 * @returns {string} Formatted quantity string
 */
function formatQuantity(qty) {
  if (qty === 0) return "0";
  if (Number.isInteger(qty)) return qty.toLocaleString("en-GB");
  const formatted = qty.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const parts = formatted.split(".");
  parts[0] = Number(parts[0]).toLocaleString("en-GB");
  return parts.join(".");
}

/**
 * @description Format a percentage change with sign and one decimal place.
 * @param {number} pct - The percentage change
 * @returns {string} Formatted string like "+17.7%" or "-3.6%"
 */
function formatChange(pct) {
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(1) + "%";
}

/**
 * @description Get the colour for a percentage change value.
 * @param {number} pct - The percentage change
 * @returns {Object} RGB colour
 */
function changeColour(pct) {
  if (pct > 0) return COLOURS.green700;
  if (pct < 0) return COLOURS.red600;
  return COLOURS.brand600;
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
 * @description Parse a single param string into its components.
 * Format: "USER:ACCOUNT_TYPE" or "USER:ACCOUNT_TYPE:period1,period2,..."
 * When account type contains "+", it is a combined totals request.
 * @param {string} param - The param string
 * @returns {Object} Parsed object
 */
function parseDetailParam(param) {
  var parts = param.split(":");
  var accountPart = (parts[1] || "").trim().toLowerCase();
  var isCombined = accountPart.indexOf("+") !== -1;

  return {
    user: (parts[0] || "").trim(),
    accountType: accountPart,
    periods: parts[2] ? parts[2].split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [],
    isCombined: isCombined,
    accountTypes: isCombined
      ? accountPart.split("+").map(function (s) { return s.trim(); }).filter(Boolean)
      : [accountPart],
  };
}

/**
 * @description Resolve report params tokens in the params array.
 * @param {Array<string>} params - Raw params array
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
 * @description Build column definitions including any change period columns.
 * @param {Array<Object>} periods - Period definitions from the detail data
 * @returns {Array<{key: string, label: string, width: number, align: string, x: number}>}
 */
function buildColumns(periods) {
  var changeWidth = 55;
  var cols = BASE_COLUMNS.map(function (col) {
    return { key: col.key, label: col.label, width: col.width, align: col.align };
  });

  for (var i = 0; i < periods.length; i++) {
    cols.push({
      key: "change_" + i,
      label: periods[i].label,
      width: changeWidth,
      align: "right",
    });
  }

  // Calculate x positions
  var x = 0;
  for (var c = 0; c < cols.length; c++) {
    cols[c].x = x;
    x += cols[c].width;
  }

  return cols;
}

/**
 * @description Generate a PDF for the Portfolio Detail Valuation report.
 * Fetches data from the database and renders it as an A4 landscape PDF
 * with per-account holdings tables and optional change columns.
 * @param {Array<string>} params - Params array controlling which accounts
 *   to render, in the format "USER:ACCOUNT_TYPE:periods" or
 *   "USER:isa+sipp+trading:periods" for combined totals.
 *   Tokens like "USER1" are substituted from report_params.
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generatePortfolioDetailPdf(params) {
  var resolvedParams = resolveParams(params);

  if (!resolvedParams || resolvedParams.length === 0) {
    // Return a minimal PDF with a "no params" message
    const pdf = PDF.create();
    const page = pdf.addPage({ size: "a4", orientation: "landscape" });
    var emptyY = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP);
    page.drawText("Portfolio Detail Valuation — no parameters provided.", {
      x: MARGIN_LEFT,
      y: emptyY - FONT_SIZE_TITLE,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_TITLE,
      color: COLOURS.brand800,
    });
    drawPageFooters([page], "Portfolio Detail Valuation", MARGIN_LEFT, USABLE_WIDTH);
    return await pdf.save();
  }

  const testMode = isTestMode();
  const headerRowColour = testMode ? COLOURS.green100 : COLOURS.brand100;

  const pdf = PDF.create();
  var page = pdf.addPage({ size: "a4", orientation: "landscape" });
  var pages = [page];

  // Draw page header (logo + "Portfolio 60") and get starting y position
  var y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP);

  /**
   * @description Check if there is enough vertical space. If not, add a new page with header.
   * @param {number} needed - Points of vertical space needed
   */
  function ensureSpace(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage({ size: "a4", orientation: "landscape" });
      pages.push(page);
      y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP);
    }
  }

  // --- Report title ---
  page.drawText("Portfolio Detail Valuation", {
    x: MARGIN_LEFT,
    y: y - FONT_SIZE_TITLE,
    font: StandardFonts.HelveticaBold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.brand800,
  });
  y -= FONT_SIZE_TITLE + 12;

  // --- Process each param entry ---
  for (var i = 0; i < resolvedParams.length; i++) {
    var parsed = parseDetailParam(resolvedParams[i]);

    if (!parsed.user || !parsed.accountType) continue;

    if (parsed.isCombined) {
      // Combined totals across multiple account types
      renderCombinedTotals(parsed);
    } else {
      // Single account detail table
      renderAccountSection(parsed);
    }
  }

  /**
   * @description Render a single account's detail table with holdings.
   * @param {Object} parsed - Parsed param object
   */
  function renderAccountSection(parsed) {
    var data = getPortfolioDetail(parsed.user, parsed.accountType, parsed.periods);
    if (!data || !data.holdings || data.holdings.length === 0) return;

    var periods = data.periods || [];
    var columns = buildColumns(periods);

    // Section heading
    var typeLabel = ACCOUNT_TYPE_LABELS[data.account.account_type] || data.account.account_type;
    var heading = data.user.first_name + " " + data.user.last_name + " " + typeLabel;

    ensureSpace(SECTION_HEADING_HEIGHT + HEADER_ROW_HEIGHT + ROW_HEIGHT);
    page.drawText(heading, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_SECTION_HEADING,
      font: StandardFonts.HelveticaBold,
      size: FONT_SIZE_SECTION_HEADING,
      color: COLOURS.brand800,
    });
    y -= SECTION_HEADING_HEIGHT;

    // Header row
    drawTableHeader(columns);

    // Holdings rows
    for (var h = 0; h < data.holdings.length; h++) {
      var holding = data.holdings[h];
      var isGBP = holding.currency_code === "GBP";
      var sym = holding.currency_symbol || "";

      ensureSpace(ROW_HEIGHT + 2);
      var rowY = y - ROW_HEIGHT;
      var textY = rowY + 4;

      // Build cell values
      var values = {
        investment: holding.description,
        currency: holding.currency_code,
        quantity: formatQuantity(holding.quantity),
        avgCost: sym + formatPrice(holding.average_cost),
        price: sym + formatPrice(holding.price),
        valueLocal: isGBP ? "" : sym + formatNumber(holding.value_local),
        valueGBP: formatNumber(holding.value_gbp),
      };

      // Add change values
      for (var c = 0; c < (holding.changes || []).length; c++) {
        var change = holding.changes[c];
        values["change_" + c] = change.change_percent !== null
          ? formatChange(change.change_percent)
          : "\u2014"; // em dash
      }

      // Draw each cell
      for (var col = 0; col < columns.length; col++) {
        var colDef = columns[col];
        var cellText = values[colDef.key] || "";
        var fontName = StandardFonts.Helvetica;
        var cellColour = COLOURS.black;

        // Change columns get colour coding
        if (colDef.key.startsWith("change_")) {
          var changeIdx = parseInt(colDef.key.split("_")[1]);
          var holdingChange = (holding.changes || [])[changeIdx];
          if (holdingChange && holdingChange.change_percent !== null) {
            cellColour = changeColour(holdingChange.change_percent);
          } else {
            cellColour = COLOURS.brand300;
          }
        }

        // Value GBP is bold
        if (colDef.key === "valueGBP") {
          fontName = StandardFonts.HelveticaBold;
        }

        cellText = truncateText(cellText, fontName, FONT_SIZE_ROW, colDef.width - 4);

        if (colDef.align === "right") {
          drawRightAligned(
            page, cellText, MARGIN_LEFT + colDef.x, colDef.width,
            textY, fontName, FONT_SIZE_ROW, cellColour,
          );
        } else {
          page.drawText(cellText, {
            x: MARGIN_LEFT + colDef.x + 2,
            y: textY,
            font: fontName,
            size: FONT_SIZE_ROW,
            color: cellColour,
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

    // Totals row
    ensureSpace(ROW_HEIGHT + 2);
    var totalsRowY = y - ROW_HEIGHT;
    var totalsTextY = totalsRowY + 4;

    // Totals row background
    page.drawRectangle({
      x: MARGIN_LEFT,
      y: totalsRowY,
      width: USABLE_WIDTH,
      height: ROW_HEIGHT,
      color: headerRowColour,
    });

    // "Total GBP" label in the valueLocal column
    var valueLocalCol = columns.find(function (c) { return c.key === "valueLocal"; });
    if (valueLocalCol) {
      drawRightAligned(
        page, "Total GBP", MARGIN_LEFT + valueLocalCol.x, valueLocalCol.width,
        totalsTextY, StandardFonts.HelveticaBold, FONT_SIZE_ROW, COLOURS.black,
      );
    }

    // Total value GBP
    var valueGBPCol = columns.find(function (c) { return c.key === "valueGBP"; });
    if (valueGBPCol) {
      drawRightAligned(
        page, formatNumber(data.totals.value_gbp),
        MARGIN_LEFT + valueGBPCol.x, valueGBPCol.width,
        totalsTextY, StandardFonts.HelveticaBold, FONT_SIZE_ROW, COLOURS.black,
      );
    }

    // Total change columns
    for (var t = 0; t < (data.totals.changes || []).length; t++) {
      var totalChange = data.totals.changes[t];
      var changeCol = columns.find(function (c) { return c.key === "change_" + t; });
      if (!changeCol) continue;

      if (totalChange.change_percent !== null) {
        drawRightAligned(
          page, formatChange(totalChange.change_percent),
          MARGIN_LEFT + changeCol.x, changeCol.width,
          totalsTextY, StandardFonts.HelveticaBold, FONT_SIZE_ROW,
          changeColour(totalChange.change_percent),
        );
      } else {
        drawRightAligned(
          page, "\u2014",
          MARGIN_LEFT + changeCol.x, changeCol.width,
          totalsTextY, StandardFonts.Helvetica, FONT_SIZE_ROW, COLOURS.brand300,
        );
      }
    }

    // Totals row bottom border
    page.drawLine({
      start: { x: MARGIN_LEFT, y: totalsRowY },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: totalsRowY },
      color: COLOURS.brand200,
      thickness: 0.5,
    });
    y -= ROW_HEIGHT;

    y -= 6; // gap after account section
  }

  /**
   * @description Render combined totals across multiple account types for a user.
   * Aggregates Value GBP and value-weighted changes.
   * @param {Object} parsed - Parsed param object with isCombined=true
   */
  function renderCombinedTotals(parsed) {
    var combinedResults = [];
    var combinedPeriods = [];
    var combinedUserName = "";

    for (var a = 0; a < parsed.accountTypes.length; a++) {
      var data = getPortfolioDetail(parsed.user, parsed.accountTypes[a], parsed.periods);
      if (data && data.holdings && data.holdings.length > 0) {
        combinedResults.push(data);
        if (combinedPeriods.length === 0 && data.periods) {
          combinedPeriods = data.periods;
        }
        if (!combinedUserName) {
          combinedUserName = data.user.first_name + " " + data.user.last_name;
        }
      }
    }

    if (combinedResults.length === 0) return;

    // Aggregate
    var combinedValueGBP = 0;
    var periodWeightedSums = {};
    var periodWeightedBases = {};
    var accountLabels = [];

    for (var p = 0; p < combinedPeriods.length; p++) {
      periodWeightedSums[combinedPeriods[p].code] = 0;
      periodWeightedBases[combinedPeriods[p].code] = 0;
    }

    for (var d = 0; d < combinedResults.length; d++) {
      var detail = combinedResults[d];
      combinedValueGBP += detail.totals.value_gbp;
      var typeLabel = ACCOUNT_TYPE_LABELS[detail.account.account_type] || detail.account.account_type;
      accountLabels.push(typeLabel);

      for (var h = 0; h < detail.holdings.length; h++) {
        var holding = detail.holdings[h];
        for (var c = 0; c < (holding.changes || []).length; c++) {
          var change = holding.changes[c];
          if (change.change_percent !== null) {
            periodWeightedSums[change.code] += holding.value_gbp * change.change_percent;
            periodWeightedBases[change.code] += holding.value_gbp;
          }
        }
      }
    }

    // Calculate combined weighted average changes
    var combinedChanges = [];
    for (var j = 0; j < combinedPeriods.length; j++) {
      var code = combinedPeriods[j].code;
      var base = periodWeightedBases[code];
      if (base > 0) {
        var weighted = Math.round((periodWeightedSums[code] / base) * 10) / 10;
        combinedChanges.push({ code: code, change_percent: weighted });
      } else {
        combinedChanges.push({ code: code, change_percent: null });
      }
    }

    // Separator and heading
    ensureSpace(30 + HEADER_ROW_HEIGHT + ROW_HEIGHT);

    page.drawLine({
      start: { x: MARGIN_LEFT, y: y },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y },
      color: COLOURS.brand200,
      thickness: 1.5,
    });
    y -= 14;

    var heading = combinedUserName + " Combined Total (" + accountLabels.join(" + ") + ")";
    page.drawText(heading, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_SECTION_HEADING,
      font: StandardFonts.HelveticaBold,
      size: FONT_SIZE_SECTION_HEADING,
      color: COLOURS.brand800,
    });
    y -= FONT_SIZE_SECTION_HEADING + 6;

    // Build columns for the combined row (Value GBP + change columns)
    var hasPeriods = combinedPeriods.length > 0;
    var combinedCols = [
      { key: "valueGBP", label: "Value GBP", width: 80, align: "right", x: 0 },
    ];
    var cx = 80;
    for (var k = 0; k < combinedPeriods.length; k++) {
      combinedCols.push({
        key: "change_" + k,
        label: combinedPeriods[k].label,
        width: 55,
        align: "right",
        x: cx,
      });
      cx += 55;
    }

    // Header row (if periods exist)
    if (hasPeriods) {
      var headerWidth = cx;
      ensureSpace(HEADER_ROW_HEIGHT + ROW_HEIGHT);

      page.drawRectangle({
        x: MARGIN_LEFT,
        y: y - HEADER_ROW_HEIGHT,
        width: headerWidth,
        height: HEADER_ROW_HEIGHT,
        color: headerRowColour,
      });

      for (var hc = 0; hc < combinedCols.length; hc++) {
        drawRightAligned(
          page, combinedCols[hc].label, MARGIN_LEFT + combinedCols[hc].x,
          combinedCols[hc].width, y - HEADER_ROW_HEIGHT + 5,
          StandardFonts.HelveticaBold, FONT_SIZE_HEADER, COLOURS.brand700,
        );
      }

      page.drawLine({
        start: { x: MARGIN_LEFT, y: y - HEADER_ROW_HEIGHT },
        end: { x: MARGIN_LEFT + headerWidth, y: y - HEADER_ROW_HEIGHT },
        color: COLOURS.brand200,
        thickness: 0.5,
      });
      y -= HEADER_ROW_HEIGHT;
    }

    // Combined totals data row
    ensureSpace(ROW_HEIGHT + 2);
    var rowY = y - ROW_HEIGHT;
    var textY = rowY + 4;
    var rowWidth = cx;

    page.drawRectangle({
      x: MARGIN_LEFT,
      y: rowY,
      width: rowWidth,
      height: ROW_HEIGHT,
      color: headerRowColour,
    });

    // Value GBP
    drawRightAligned(
      page, formatNumber(combinedValueGBP),
      MARGIN_LEFT + combinedCols[0].x, combinedCols[0].width,
      textY, StandardFonts.HelveticaBold, FONT_SIZE_ROW, COLOURS.black,
    );

    // Change columns
    for (var m = 0; m < combinedChanges.length; m++) {
      var cc = combinedChanges[m];
      var colDef = combinedCols[m + 1]; // +1 to skip the valueGBP column

      if (cc.change_percent !== null) {
        drawRightAligned(
          page, formatChange(cc.change_percent),
          MARGIN_LEFT + colDef.x, colDef.width,
          textY, StandardFonts.HelveticaBold, FONT_SIZE_ROW,
          changeColour(cc.change_percent),
        );
      } else {
        drawRightAligned(
          page, "\u2014",
          MARGIN_LEFT + colDef.x, colDef.width,
          textY, StandardFonts.Helvetica, FONT_SIZE_ROW, COLOURS.brand300,
        );
      }
    }

    page.drawLine({
      start: { x: MARGIN_LEFT, y: rowY },
      end: { x: MARGIN_LEFT + rowWidth, y: rowY },
      color: COLOURS.brand200,
      thickness: 0.5,
    });
    y -= ROW_HEIGHT;

    y -= 6; // gap after combined section
  }

  /**
   * @description Draw the column header row for a detail table.
   * @param {Array<Object>} columns - Column definitions with x positions
   */
  function drawTableHeader(columns) {
    ensureSpace(HEADER_ROW_HEIGHT + ROW_HEIGHT + 4);

    page.drawRectangle({
      x: MARGIN_LEFT,
      y: y - HEADER_ROW_HEIGHT,
      width: USABLE_WIDTH,
      height: HEADER_ROW_HEIGHT,
      color: headerRowColour,
    });

    for (var col = 0; col < columns.length; col++) {
      var colDef = columns[col];
      if (colDef.align === "right") {
        drawRightAligned(
          page, colDef.label, MARGIN_LEFT + colDef.x, colDef.width,
          y - HEADER_ROW_HEIGHT + 5, StandardFonts.HelveticaBold,
          FONT_SIZE_HEADER, COLOURS.brand700,
        );
      } else {
        page.drawText(colDef.label, {
          x: MARGIN_LEFT + colDef.x + 2,
          y: y - HEADER_ROW_HEIGHT + 5,
          font: StandardFonts.HelveticaBold,
          size: FONT_SIZE_HEADER,
          color: COLOURS.brand700,
        });
      }
    }

    page.drawLine({
      start: { x: MARGIN_LEFT, y: y - HEADER_ROW_HEIGHT },
      end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y - HEADER_ROW_HEIGHT },
      color: COLOURS.brand200,
      thickness: 0.5,
    });
    y -= HEADER_ROW_HEIGHT;
  }

  // --- Fixed footer on every page: date left, title centre, page number right ---
  drawPageFooters(pages, "Portfolio Detail Valuation", MARGIN_LEFT, USABLE_WIDTH);

  return await pdf.save();
}
