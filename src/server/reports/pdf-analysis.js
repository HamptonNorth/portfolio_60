/**
 * @description PDF generators for the analysis page.
 * Produces four PDF types: comparison table, league table,
 * top/bottom performer line charts, and risk/return scatter plot.
 */

import { PDF, rgb } from "@libpdf/core";
import { embedRobotoFonts } from "./pdf-fonts.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";
import { buildFtMarketsUrl, buildMorningstarUrl } from "../../shared/public-id-utils.js";
import { isTestMode } from "../test-mode.js";
import {
  buildLeagueTable,
  buildRiskReturnData,
  buildTopBottomPerformers,
  buildBenchmarkReturnData,
  buildBenchmarkRebasedSeries,
  buildComparisonTable,
  PERIOD_LABELS,
} from "../services/analysis-service.js";

// ─── Constants ──────────────────────────────────────────────────

const A4_LANDSCAPE_WIDTH = 841.89;
const A4_LANDSCAPE_HEIGHT = 595.28;
const A4_PORTRAIT_WIDTH = 595.28;
const A4_PORTRAIT_HEIGHT = 841.89;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const USABLE_WIDTH = A4_LANDSCAPE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const PORTRAIT_USABLE_WIDTH = A4_PORTRAIT_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const COLOURS = {
  brand800: rgb(0.15, 0.23, 0.42),
  brand700: rgb(0.2, 0.3, 0.5),
  brand600: rgb(0.35, 0.42, 0.55),
  brand300: rgb(0.7, 0.73, 0.78),
  brand200: rgb(0.82, 0.85, 0.9),
  brand100: rgb(0.91, 0.93, 0.96),
  white: rgb(1, 1, 1),
  green700: rgb(0.09, 0.46, 0.2),
  red600: rgb(0.86, 0.15, 0.15),
  gridLine: rgb(0.9, 0.9, 0.9),
  zeroLine: rgb(0.75, 0.75, 0.75),
  linkBlue: rgb(0.05, 0.27, 0.63),
  benchmarkBg: rgb(0.95, 0.95, 0.96),
};

/** @description Ten contrasting line colours matching the pdf-chart palette */
const LINE_COLOURS = [
  rgb(0.23, 0.51, 0.96),  // Blue
  rgb(0.98, 0.45, 0.09),  // Orange
  rgb(0.94, 0.27, 0.27),  // Red
  rgb(0.13, 0.77, 0.37),  // Green
  rgb(0.66, 0.33, 0.97),  // Purple
  rgb(0.02, 0.71, 0.83),  // Cyan
  rgb(0.93, 0.29, 0.60),  // Pink
  rgb(0.92, 0.70, 0.03),  // Yellow
  rgb(0.39, 0.40, 0.95),  // Indigo
  rgb(0.08, 0.72, 0.65),  // Teal
];

/** @description Scatter point colours matching the browser chart */
const SCATTER_GREEN = rgb(0.09, 0.46, 0.2);
const SCATTER_RED = rgb(0.86, 0.15, 0.15);
const SCATTER_BLUE = rgb(0.23, 0.51, 0.96);
const SCATTER_GREY = rgb(0.42, 0.45, 0.50);

const FONT_SIZE_TITLE = 12;
const FONT_SIZE_SUBTITLE = 9;
const FONT_SIZE_HEADER = 7;
const FONT_SIZE_ROW = 7;
const FONT_SIZE_LEGEND = 7;
const FONT_SIZE_AXIS = 7;


const TITLE_BAR_HEIGHT = 28;
const ROW_HEIGHT = 14;
const HEADER_ROW_HEIGHT = 16;

const Y_AXIS_WIDTH = 45;
const X_AXIS_HEIGHT = 28;
const CHART_RIGHT_PAD = 10;
const LEGEND_ROW_HEIGHT = 14;
const LEGEND_PADDING = 4;

// ─── Shared utilities ───────────────────────────────────────────

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
 * @description Convert a type short description to proper case.
 * @param {string} str - Uppercase type (e.g. "SHARE")
 * @returns {string} Proper case (e.g. "Share")
 */
function properCase(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
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
 * @description Truncate text to fit within a given width, appending ellipsis if needed.
 * @param {string} text - The text to truncate
 * @param {Object} font - Embedded font object
 * @param {number} fontSize - Font size in points
 * @param {number} maxWidth - Maximum width in points
 * @returns {string} Truncated text
 */
function truncateText(text, font, fontSize, maxWidth) {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 0 && font.widthOfTextAtSize(truncated + "\u2026", fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "\u2026";
}

/**
 * @description Draw the title bar (white text on dark rectangle).
 * @param {Object} page - PDFPage instance
 * @param {string} title - Title text
 * @param {number} x - Left edge
 * @param {number} y - Top edge
 * @param {number} width - Bar width
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 * @returns {number} Y position below the title bar
 */
function drawTitleBar(page, title, x, y, width, fonts) {
  const barColour = isTestMode() ? rgb(0.02, 0.32, 0.21) : COLOURS.brand800;
  page.drawRectangle({
    x: x,
    y: y - TITLE_BAR_HEIGHT,
    width: width,
    height: TITLE_BAR_HEIGHT,
    color: barColour,
  });
  page.drawText(title, {
    x: x + 10,
    y: y - TITLE_BAR_HEIGHT + 9,
    font: fonts.bold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.white,
  });
  return y - TITLE_BAR_HEIGHT;
}

/**
 * @description Draw a filter subtitle line below the title bar showing which
 * holdings/user filters are active. Returns the updated Y position.
 * @param {Object} page - PDFPage instance
 * @param {string|null} filterText - Human-readable filter description, or null to skip
 * @param {number} x - Left edge
 * @param {number} y - Current Y position (just below title bar)
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 * @returns {number} Updated Y position below the subtitle
 */
function drawFilterSubtitle(page, filterText, x, y, fonts) {
  if (!filterText) return y;

  page.drawText(filterText, {
    x: x + 4,
    y: y - 10,
    font: fonts.regular,
    size: FONT_SIZE_SUBTITLE,
    color: COLOURS.brand600,
  });

  return y - 16;
}

/**
 * @description Add clickable research link annotations to an investment name.
 * @param {Object} page - PDFPage instance
 * @param {string} publicId - FT Markets public ID
 * @param {string} currencyCode - Currency code for FT URL
 * @param {string} morningstarId - Morningstar ID
 * @param {number} x - X position of the text
 * @param {number} y - Y baseline of the text
 * @param {number} textWidth - Width of the text
 * @param {number} fontSize - Font size
 */
function addResearchLinks(page, publicId, currencyCode, morningstarId, x, y, textWidth, fontSize) {
  const ftUrl = publicId ? buildFtMarketsUrl(publicId, currencyCode) : null;
  const msUrl = morningstarId ? buildMorningstarUrl(morningstarId) : null;

  if (ftUrl && msUrl) {
    const halfWidth = textWidth / 2;
    page.addLinkAnnotation({
      rect: { x: x, y: y - 1, width: halfWidth, height: fontSize + 3 },
      uri: ftUrl,
      borderWidth: 0,
    });
    page.addLinkAnnotation({
      rect: { x: x + halfWidth, y: y - 1, width: halfWidth, height: fontSize + 3 },
      uri: msUrl,
      borderWidth: 0,
    });
  } else if (ftUrl) {
    page.addLinkAnnotation({
      rect: { x: x, y: y - 1, width: textWidth, height: fontSize + 3 },
      uri: ftUrl,
      borderWidth: 0,
    });
  } else if (msUrl) {
    page.addLinkAnnotation({
      rect: { x: x, y: y - 1, width: textWidth, height: fontSize + 3 },
      uri: msUrl,
      borderWidth: 0,
    });
  }
}

/**
 * @description Draw an investment name with optional link styling.
 * @param {Object} page - PDFPage instance
 * @param {string} name - Investment description
 * @param {number} x - X position
 * @param {number} y - Y baseline
 * @param {number} maxWidth - Max width for truncation
 * @param {string|null} publicId - Public ID for FT link
 * @param {string|null} currencyCode - Currency code
 * @param {string|null} morningstarId - Morningstar ID
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 */
function drawInvestmentName(page, name, x, y, maxWidth, publicId, currencyCode, morningstarId, fonts) {
  const hasLink = publicId || morningstarId;
  const textColour = hasLink ? COLOURS.linkBlue : COLOURS.brand800;
  const displayName = truncateText(name, fonts.medium, FONT_SIZE_ROW, maxWidth);

  page.drawText(displayName, {
    x: x,
    y: y,
    font: fonts.medium,
    size: FONT_SIZE_ROW,
    color: textColour,
  });

  if (hasLink) {
    const textWidth = fonts.medium.widthOfTextAtSize(displayName, FONT_SIZE_ROW);
    addResearchLinks(page, publicId, currencyCode, morningstarId, x, y, textWidth, FONT_SIZE_ROW);
  }
}

// ─── Chart drawing utilities ────────────────────────────────────

/**
 * @description Find a "nice" number close to the given value for axis tick spacing.
 * @param {number} value - The raw interval value
 * @returns {number} A nice round number
 */
function niceNumber(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / Math.pow(10, exponent);
  let nice;
  if (fraction <= 1.5) nice = 1;
  else if (fraction <= 3.5) nice = 2;
  else if (fraction <= 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exponent);
}

/**
 * @description Calculate a nice Y-axis range and tick marks based on the data.
 * @param {Array<Array<number|null>>} allValues - Arrays of rebased percentage values
 * @returns {Object} Object with min, max, and ticks array
 */
function calculateYRange(allValues) {
  let dataMin = 0;
  let dataMax = 0;

  for (let s = 0; s < allValues.length; s++) {
    const vals = allValues[s];
    for (let v = 0; v < vals.length; v++) {
      if (vals[v] === null) continue;
      if (vals[v] < dataMin) dataMin = vals[v];
      if (vals[v] > dataMax) dataMax = vals[v];
    }
  }

  let range = dataMax - dataMin;
  if (range === 0) range = 10;
  const padding = range * 0.1;
  let min = dataMin - padding;
  let max = dataMax + padding;

  const rawInterval = range / 6;
  const niceInterval = niceNumber(rawInterval);

  min = Math.floor(min / niceInterval) * niceInterval;
  max = Math.ceil(max / niceInterval) * niceInterval;

  if (min > 0) min = 0;
  if (max < 0) max = 0;

  const ticks = [];
  for (let t = min; t <= max + niceInterval * 0.01; t += niceInterval) {
    ticks.push(Math.round(t * 10) / 10);
  }

  return { min: min, max: max, ticks: ticks };
}

/**
 * @description Draw horizontal grid lines and a zero line.
 * @param {Object} page - PDFPage instance
 * @param {number} left - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} width - Chart area width
 * @param {number} height - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Array<number>} ticks - Y-axis tick values
 */
function drawGrid(page, left, bottom, width, height, yMin, yMax, ticks) {
  const yRange = yMax - yMin;
  if (yRange === 0) return;

  for (let i = 0; i < ticks.length; i++) {
    const tickVal = ticks[i];
    const py = bottom + ((tickVal - yMin) / yRange) * height;
    const isZero = Math.abs(tickVal) < 0.01;

    page.drawLine({
      start: { x: left, y: py },
      end: { x: left + width, y: py },
      color: isZero ? COLOURS.zeroLine : COLOURS.gridLine,
      thickness: isZero ? 0.8 : 0.3,
    });
  }
}

/**
 * @description Draw Y-axis labels with percentage suffix.
 * @param {Object} page - PDFPage instance
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} height - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Array<number>} ticks - Y-axis tick values
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 */
function drawYAxis(page, chartLeft, bottom, height, yMin, yMax, ticks, fonts) {
  const yRange = yMax - yMin;
  if (yRange === 0) return;

  for (let i = 0; i < ticks.length; i++) {
    const tickVal = ticks[i];
    const py = bottom + ((tickVal - yMin) / yRange) * height;
    const label = tickVal.toFixed(tickVal === Math.round(tickVal) ? 0 : 1) + "%";
    const textWidth = fonts.regular.widthOfTextAtSize(label, FONT_SIZE_AXIS);

    page.drawText(label, {
      x: chartLeft - textWidth - 4,
      y: py - 3,
      font: fonts.regular,
      size: FONT_SIZE_AXIS,
      color: COLOURS.brand600,
    });
  }
}

/**
 * @description Draw X-axis labels (MM/YY) at month boundaries.
 * @param {Object} page - PDFPage instance
 * @param {Array<string>} sampleDates - Weekly sample dates
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} totalWeeks - Total weeks of data
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 */
function drawXAxis(page, sampleDates, chartLeft, bottom, chartWidth, totalWeeks, fonts) {
  if (sampleDates.length < 2) return;

  const totalPoints = sampleDates.length;
  const monthsApprox = totalWeeks / 4.33;

  let labelEvery = 1;
  if (monthsApprox > 18) labelEvery = 2;
  if (monthsApprox > 30) labelEvery = 3;

  let lastMonth = "";
  let monthCount = 0;

  for (let i = 0; i < totalPoints; i++) {
    const dateStr = sampleDates[i];
    const monthKey = dateStr.substring(5, 7) + "/" + dateStr.substring(2, 4);

    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      monthCount++;

      if (monthCount % labelEvery !== 1 && labelEvery > 1) continue;

      const px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
      const textWidth = fonts.regular.widthOfTextAtSize(monthKey, FONT_SIZE_AXIS);

      page.drawLine({
        start: { x: px, y: bottom },
        end: { x: px, y: bottom - 4 },
        color: COLOURS.brand200,
        thickness: 0.5,
      });

      page.drawText(monthKey, {
        x: px - textWidth / 2,
        y: bottom - 14,
        font: fonts.regular,
        size: FONT_SIZE_AXIS,
        color: COLOURS.brand600,
      });
    }
  }
}

/**
 * @description Plot a single data series as a line on the chart.
 * @param {Object} page - PDFPage instance
 * @param {Array<number|null>} values - Rebased percentage values
 * @param {number} totalPoints - Total number of x-axis points
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} chartHeight - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Object} colour - RGB colour for the line
 * @param {boolean} isDotted - Whether to draw dotted line (benchmarks)
 */
function plotLine(page, values, totalPoints, chartLeft, bottom, chartWidth, chartHeight,
  yMin, yMax, colour, isDotted) {
  if (totalPoints < 2) return;

  const yRange = yMax - yMin;
  if (yRange === 0) return;

  const points = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    const px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
    const py = bottom + ((values[i] - yMin) / yRange) * chartHeight;
    points.push({ x: px, y: py });
  }

  if (points.length < 2) return;

  if (isDotted) {
    drawDottedPath(page, points, colour, 1.2, 4);
  } else {
    for (let j = 0; j < points.length - 1; j++) {
      page.drawLine({
        start: points[j],
        end: points[j + 1],
        color: colour,
        thickness: 1.5,
      });
    }
  }
}

/**
 * @description Draw a dotted line along a path of points.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} points - Array of {x, y} path points
 * @param {Object} colour - RGB colour
 * @param {number} dotSize - Width/height of each dot
 * @param {number} spacing - Distance between dot centres
 */
function drawDottedPath(page, points, colour, dotSize, spacing) {
  if (points.length < 2) return;

  const halfDot = dotSize / 2;
  let distSinceLastDot = spacing;

  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen < 0.1) continue;

    const unitX = dx / segLen;
    const unitY = dy / segLen;
    let pos = 0;

    while (pos <= segLen) {
      if (distSinceLastDot >= spacing) {
        const cx = points[i].x + unitX * pos;
        const cy = points[i].y + unitY * pos;
        page.drawRectangle({
          x: cx - halfDot,
          y: cy - halfDot,
          width: dotSize,
          height: dotSize,
          color: colour,
        });
        distSinceLastDot = 0;
      }
      let step = Math.min(spacing - distSinceLastDot, segLen - pos);
      if (step < 0.1) step = 0.1;
      pos += step;
      distSinceLastDot += step;
    }
  }
}

/**
 * @description Draw a chart legend with coloured squares/dots for series.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} items - Array of {label, colour, isDotted, publicId, currencyCode, morningstarId}
 * @param {number} startX - Left edge of legend area
 * @param {number} y - Y position for legend
 * @param {number} availableWidth - Max width
 * @param {number} maxPerRow - Maximum items per row
 * @param {Object} fonts - Roboto font objects from embedRobotoFonts()
 * @returns {number} Y position after legend
 */
function drawChartLegend(page, items, startX, y, availableWidth, maxPerRow, fonts) {
  const boxSize = 8;
  const gap = 14;
  if (!maxPerRow) maxPerRow = 4;
  let currentY = y;

  for (let r = 0; r < items.length; r += maxPerRow) {
    const chunk = items.slice(r, r + maxPerRow);
    let x = startX;

    for (let i = 0; i < chunk.length; i++) {
      const item = chunk[i];
      const label = truncateText(item.label, fonts.regular, FONT_SIZE_LEGEND,
        (availableWidth / maxPerRow) - boxSize - gap);

      if (item.isDotted) {
        const dotY = currentY + boxSize / 2 - 1;
        for (let d = 0; d < 3; d++) {
          page.drawRectangle({
            x: x + d * 3,
            y: dotY,
            width: 1.5,
            height: 1.5,
            color: item.colour,
          });
        }
      } else {
        page.drawRectangle({
          x: x,
          y: currentY,
          width: boxSize,
          height: boxSize,
          color: item.colour,
        });
      }

      x += boxSize + 3;

      const hasLink = !item.isDotted && (item.publicId || item.morningstarId);
      const textColour = hasLink ? COLOURS.linkBlue : COLOURS.brand800;

      page.drawText(label, {
        x: x,
        y: currentY + 1,
        font: fonts.regular,
        size: FONT_SIZE_LEGEND,
        color: textColour,
      });

      const textWidth = fonts.regular.widthOfTextAtSize(label, FONT_SIZE_LEGEND);

      if (hasLink) {
        addResearchLinks(page, item.publicId, item.currencyCode, item.morningstarId,
          x, currentY + 1, textWidth, FONT_SIZE_LEGEND);
      }

      x += textWidth + gap;
    }

    currentY -= LEGEND_ROW_HEIGHT;
  }

  return currentY;
}

// ─── 1. Comparison Table PDF ────────────────────────────────────

/**
 * @description Generate a PDF of the multi-period comparison table.
 * @param {Array<string>} periodCodes - Up to 4 period codes
 * @param {Array<number>} benchmarkIds - Benchmark IDs
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateComparisonPdf(periodCodes, benchmarkIds, investmentIds, filterText) {
  const data = buildComparisonTable(periodCodes, benchmarkIds, investmentIds);

  const periodLabels = periodCodes.map(function (code) {
    return PERIOD_LABELS[code] || code;
  });
  const title = "Investment Comparison \u2014 " + periodLabels.join(", ");

  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  let page = pdf.addPage({ size: "a4", orientation: "portrait" });
  const pages = [page];
  let y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);

  y = drawTitleBar(page, title, MARGIN_LEFT, y, PORTRAIT_USABLE_WIDTH, fonts);
  y = drawFilterSubtitle(page, filterText, MARGIN_LEFT, y, fonts);
  y -= 6;

  // Column layout
  const nameColWidth = 170;
  const typeColWidth = 40;
  const periodColWidth = (PORTRAIT_USABLE_WIDTH - nameColWidth - typeColWidth) / periodCodes.length;

  // Header row
  const headerY = y - HEADER_ROW_HEIGHT + 4;
  page.drawText("Investment", {
    x: MARGIN_LEFT + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  page.drawText("Type", {
    x: MARGIN_LEFT + nameColWidth + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  for (let p = 0; p < periodCodes.length; p++) {
    drawRightAligned(page, periodLabels[p],
      MARGIN_LEFT + nameColWidth + typeColWidth + p * periodColWidth,
      periodColWidth, headerY, fonts.bold, FONT_SIZE_HEADER, COLOURS.brand800);
  }
  y -= HEADER_ROW_HEIGHT;

  // Separator line
  page.drawLine({
    start: { x: MARGIN_LEFT, y: y },
    end: { x: MARGIN_LEFT + PORTRAIT_USABLE_WIDTH, y: y },
    color: COLOURS.brand200,
    thickness: 0.5,
  });

  /**
   * @description Ensure vertical space. Add a new page if needed.
   * @param {number} needed - Points of space needed
   */
  function ensureSpace(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage({ size: "a4", orientation: "portrait" });
      pages.push(page);
      y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);
      y -= 4;
    }
  }

  // Benchmark rows (grey background)
  const benchmarks = data.benchmarks || [];
  for (let b = 0; b < benchmarks.length; b++) {
    ensureSpace(ROW_HEIGHT);
    const bmRowY = y - ROW_HEIGHT;

    page.drawRectangle({
      x: MARGIN_LEFT,
      y: bmRowY - 1,
      width: PORTRAIT_USABLE_WIDTH,
      height: ROW_HEIGHT,
      color: COLOURS.benchmarkBg,
    });

    const bm = benchmarks[b];
    const bmName = truncateText(bm.description, fonts.bold, FONT_SIZE_ROW, nameColWidth - 8);
    page.drawText(bmName, {
      x: MARGIN_LEFT + 4,
      y: bmRowY + 3,
      font: fonts.bold,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand600,
    });

    for (let bp = 0; bp < periodCodes.length; bp++) {
      const bmRet = bm.returns[periodCodes[bp]];
      if (bmRet !== null && bmRet !== undefined) {
        drawRightAligned(page, formatChange(bmRet),
          MARGIN_LEFT + nameColWidth + typeColWidth + bp * periodColWidth,
          periodColWidth, bmRowY + 3, fonts.medium, FONT_SIZE_ROW, changeColour(bmRet));
      } else {
        drawRightAligned(page, "\u2014",
          MARGIN_LEFT + nameColWidth + typeColWidth + bp * periodColWidth,
          periodColWidth, bmRowY + 3, fonts.medium, FONT_SIZE_ROW, COLOURS.brand300);
      }
    }
    y = bmRowY;
  }

  // Investment rows
  const investments = data.investments || [];
  for (let inv = 0; inv < investments.length; inv++) {
    ensureSpace(ROW_HEIGHT);
    const rowY = y - ROW_HEIGHT;

    // Zebra striping
    if (inv % 2 === 0) {
      page.drawRectangle({
        x: MARGIN_LEFT,
        y: rowY - 1,
        width: PORTRAIT_USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: COLOURS.brand100,
      });
    }

    const investment = investments[inv];
    drawInvestmentName(page, investment.description, MARGIN_LEFT + 4, rowY + 3,
      nameColWidth - 8, investment.publicId, investment.currencyCode, investment.morningstarId, fonts);

    page.drawText(properCase(investment.typeShort || ""), {
      x: MARGIN_LEFT + nameColWidth + 4,
      y: rowY + 3,
      font: fonts.medium,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand600,
    });

    for (let ip = 0; ip < periodCodes.length; ip++) {
      const ret = investment.returns[periodCodes[ip]];
      if (ret !== null && ret !== undefined) {
        drawRightAligned(page, formatChange(ret),
          MARGIN_LEFT + nameColWidth + typeColWidth + ip * periodColWidth,
          periodColWidth, rowY + 3, fonts.medium, FONT_SIZE_ROW, changeColour(ret));
      } else {
        drawRightAligned(page, "\u2014",
          MARGIN_LEFT + nameColWidth + typeColWidth + ip * periodColWidth,
          periodColWidth, rowY + 3, fonts.medium, FONT_SIZE_ROW, COLOURS.brand300);
      }
    }
    y = rowY;
  }

  drawPageFooters(pages, title, MARGIN_LEFT, PORTRAIT_USABLE_WIDTH, fonts);
  return await pdf.save();
}

// ─── 2. League Table PDF ────────────────────────────────────────

/**
 * @description Generate a PDF of the league table.
 * @param {string} period - Period code
 * @param {string} sort - Sort field (return, name, type)
 * @param {string} dir - Sort direction (asc, desc)
 * @param {string} limit - Limit (all, top10, top20, bottom10, bottom20)
 * @param {Array<number>} benchmarkIds - Benchmark IDs
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateLeagueTablePdf(period, sort, dir, limit, benchmarkIds, investmentIds, filterText) {
  const data = buildLeagueTable(period, investmentIds);
  const bmData = benchmarkIds.length > 0 ? buildBenchmarkReturnData(benchmarkIds, period) : [];
  const periodLabel = PERIOD_LABELS[period] || period;
  const title = "League Table \u2014 " + periodLabel;

  const investments = data.investments || [];

  // Apply limit filter
  let sorted = investments.slice().sort(function (a, b) { return b.returnPct - a.returnPct; });
  if (limit === "top10") sorted = sorted.slice(0, 10);
  else if (limit === "top20") sorted = sorted.slice(0, 20);
  else if (limit === "bottom10") sorted = sorted.slice(-10);
  else if (limit === "bottom20") sorted = sorted.slice(-20);

  // Apply display sort
  sorted.sort(function (a, b) {
    let cmp = 0;
    if (sort === "name") {
      cmp = a.description.localeCompare(b.description);
    } else if (sort === "type") {
      cmp = (a.typeShort || "").localeCompare(b.typeShort || "");
    } else {
      cmp = a.returnPct - b.returnPct;
    }
    return dir === "asc" ? cmp : -cmp;
  });

  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  let page = pdf.addPage({ size: "a4", orientation: "portrait" });
  const pages = [page];
  let y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);

  y = drawTitleBar(page, title, MARGIN_LEFT, y, PORTRAIT_USABLE_WIDTH, fonts);
  y = drawFilterSubtitle(page, filterText, MARGIN_LEFT, y, fonts);
  y -= 6;

  // Column layout for portrait
  const rankColWidth = 24;
  const nameColWidth = 170;
  const typeColWidth = 40;
  const returnColWidth = 55;
  const sparklineColWidth = 70;
  const tableWidth = rankColWidth + nameColWidth + typeColWidth + returnColWidth + sparklineColWidth;

  // Header row
  const headerY = y - HEADER_ROW_HEIGHT + 4;
  page.drawText("#", {
    x: MARGIN_LEFT + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  page.drawText("Investment", {
    x: MARGIN_LEFT + rankColWidth + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  page.drawText("Type", {
    x: MARGIN_LEFT + rankColWidth + nameColWidth + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  drawRightAligned(page, "Return %",
    MARGIN_LEFT + rankColWidth + nameColWidth + typeColWidth,
    returnColWidth, headerY, fonts.bold, FONT_SIZE_HEADER, COLOURS.brand800);
  page.drawText("Trend", {
    x: MARGIN_LEFT + rankColWidth + nameColWidth + typeColWidth + returnColWidth + 4,
    y: headerY,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  y -= HEADER_ROW_HEIGHT;

  page.drawLine({
    start: { x: MARGIN_LEFT, y: y },
    end: { x: MARGIN_LEFT + tableWidth, y: y },
    color: COLOURS.brand200,
    thickness: 0.5,
  });

  function ensureSpace(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      page = pdf.addPage({ size: "a4", orientation: "portrait" });
      pages.push(page);
      y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);
      y -= 4;
    }
  }

  // Benchmark rows
  for (let b = 0; b < bmData.length; b++) {
    ensureSpace(ROW_HEIGHT);
    const bmRowY = y - ROW_HEIGHT;

    page.drawRectangle({
      x: MARGIN_LEFT,
      y: bmRowY - 1,
      width: tableWidth,
      height: ROW_HEIGHT,
      color: COLOURS.benchmarkBg,
    });

    const bmName = truncateText(bmData[b].description, fonts.bold, FONT_SIZE_ROW, nameColWidth - 8);
    page.drawText(bmName, {
      x: MARGIN_LEFT + rankColWidth + 4,
      y: bmRowY + 3,
      font: fonts.bold,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand600,
    });

    if (bmData[b].returnPct !== null) {
      drawRightAligned(page, formatChange(bmData[b].returnPct),
        MARGIN_LEFT + rankColWidth + nameColWidth + typeColWidth,
        returnColWidth, bmRowY + 3, fonts.medium, FONT_SIZE_ROW, changeColour(bmData[b].returnPct));
    }
    y = bmRowY;
  }

  // Investment rows
  for (let inv = 0; inv < sorted.length; inv++) {
    ensureSpace(ROW_HEIGHT);
    const rowY = y - ROW_HEIGHT;

    if (inv % 2 === 0) {
      page.drawRectangle({
        x: MARGIN_LEFT,
        y: rowY - 1,
        width: tableWidth,
        height: ROW_HEIGHT,
        color: COLOURS.brand100,
      });
    }

    const investment = sorted[inv];

    // Rank
    page.drawText(String(inv + 1), {
      x: MARGIN_LEFT + 4,
      y: rowY + 3,
      font: fonts.medium,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand600,
    });

    // Name with link
    drawInvestmentName(page, investment.description, MARGIN_LEFT + rankColWidth + 4, rowY + 3,
      nameColWidth - 8, investment.publicId, investment.currencyCode, investment.morningstarId, fonts);

    // Type
    page.drawText(properCase(investment.typeShort || ""), {
      x: MARGIN_LEFT + rankColWidth + nameColWidth + 4,
      y: rowY + 3,
      font: fonts.medium,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand600,
    });

    // Return %
    drawRightAligned(page, formatChange(investment.returnPct),
      MARGIN_LEFT + rankColWidth + nameColWidth + typeColWidth,
      returnColWidth, rowY + 3, fonts.medium, FONT_SIZE_ROW, changeColour(investment.returnPct));

    // Sparkline — filter nulls before computing min/max
    const sparkline = investment.sparkline;
    if (sparkline && sparkline.length >= 2) {
      const validVals = sparkline.filter(function (v) { return v !== null; });
      if (validVals.length >= 2) {
        const sparkX = MARGIN_LEFT + rankColWidth + nameColWidth + typeColWidth + returnColWidth + 8;
        const sparkW = sparklineColWidth - 16;
        const sparkH = 10;
        const sparkMidY = rowY + 3 + FONT_SIZE_ROW / 2 - sparkH / 2;

        const sparkMin = Math.min.apply(null, validVals);
        const sparkMax = Math.max.apply(null, validVals);
        const sparkRange = sparkMax - sparkMin || 1;

        const sparkColour = investment.returnPct >= 0 ? COLOURS.green700 : COLOURS.red600;

        let lastValidX = null;
        let lastValidY = null;
        for (let sp = 0; sp < sparkline.length; sp++) {
          if (sparkline[sp] === null) continue;
          const spx = sparkX + (sp / (sparkline.length - 1)) * sparkW;
          const spy = sparkMidY + ((sparkline[sp] - sparkMin) / sparkRange) * sparkH;
          if (lastValidX !== null) {
            page.drawLine({
              start: { x: lastValidX, y: lastValidY },
              end: { x: spx, y: spy },
              color: sparkColour,
              thickness: 0.8,
            });
          }
          lastValidX = spx;
          lastValidY = spy;
        }
      }
    }

    y = rowY;
  }

  drawPageFooters(pages, title, MARGIN_LEFT, PORTRAIT_USABLE_WIDTH, fonts);
  return await pdf.save();
}

// ─── 3. Top/Bottom Performers PDF ───────────────────────────────

/**
 * @description Generate a PDF with top and bottom performer line charts.
 * @param {string} period - Period code
 * @param {number} count - Number of top/bottom performers
 * @param {Array<number>} benchmarkIds - Benchmark IDs
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateTopBottomPdf(period, count, benchmarkIds, investmentIds, filterText) {
  const data = buildTopBottomPerformers(period, count, investmentIds);
  let bmSeries = [];
  if (benchmarkIds.length > 0) {
    const bmData = buildBenchmarkRebasedSeries(benchmarkIds, period);
    bmSeries = bmData.benchmarkSeries || [];
  }

  const periodLabel = PERIOD_LABELS[period] || period;
  const title = "Top & Bottom " + count + " Performers \u2014 " + periodLabel;
  const periodWeeks = { "1w": 1, "1m": 4, "3m": 13, "6m": 26, "1y": 52, "2y": 104, "3y": 156 };
  const totalWeeks = periodWeeks[period] || 52;

  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  let page = pdf.addPage({ size: "a4", orientation: "portrait" });
  const pages = [page];
  let y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);

  // Draw filter subtitle once at the top before the two charts
  y = drawFilterSubtitle(page, filterText, MARGIN_LEFT, y, fonts);

  const pageWidth = PORTRAIT_USABLE_WIDTH;
  const sampleDates = data.sampleDates;
  const totalPoints = sampleDates.length;

  // Calculate legend rows for each chart
  const topLegendItems = buildLegendItems(data.topSeries, bmSeries, 0);
  const bottomLegendItems = buildLegendItems(data.bottomSeries, bmSeries, 5);
  const legendPerRow = 3;
  const topLegendRows = Math.ceil(topLegendItems.length / legendPerRow) || 1;
  const bottomLegendRows = Math.ceil(bottomLegendItems.length / legendPerRow) || 1;

  // Split the page vertically: two charts with legends
  const availableHeight = y - MARGIN_BOTTOM - 30;
  const gapBetweenCharts = 20;
  const topTitleH = TITLE_BAR_HEIGHT;
  const bottomTitleH = TITLE_BAR_HEIGHT;
  const legendGap = 12; // gap between title bar and legend
  const topLegendH = topLegendRows * LEGEND_ROW_HEIGHT + LEGEND_PADDING + legendGap;
  const bottomLegendH = bottomLegendRows * LEGEND_ROW_HEIGHT + LEGEND_PADDING + legendGap;

  const chartAreaHeight = (availableHeight - topTitleH - bottomTitleH - topLegendH - bottomLegendH
    - X_AXIS_HEIGHT * 2 - gapBetweenCharts) / 2;

  // --- Top chart ---
  y = drawTitleBar(page, "Top " + count + " Performers \u2014 " + periodLabel, MARGIN_LEFT, y, pageWidth, fonts);

  y = drawChartLegend(page, topLegendItems, MARGIN_LEFT + 4, y - 12, pageWidth - 8, legendPerRow, fonts);
  y -= LEGEND_PADDING;

  const topYRange = calculateYRange(
    data.topSeries.map(function (s) { return s.values; })
      .concat(bmSeries.map(function (s) { return s.values; }))
  );
  const topChartLeft = MARGIN_LEFT + Y_AXIS_WIDTH;
  const topChartWidth = pageWidth - Y_AXIS_WIDTH - CHART_RIGHT_PAD;
  const topChartBottom = y - chartAreaHeight;
  const topChartHeight = chartAreaHeight;

  drawGrid(page, topChartLeft, topChartBottom, topChartWidth, topChartHeight,
    topYRange.min, topYRange.max, topYRange.ticks);
  drawYAxis(page, topChartLeft, topChartBottom, topChartHeight,
    topYRange.min, topYRange.max, topYRange.ticks, fonts);
  drawXAxis(page, sampleDates, topChartLeft, topChartBottom, topChartWidth, totalWeeks, fonts);

  for (let t = 0; t < data.topSeries.length; t++) {
    plotLine(page, data.topSeries[t].values, totalPoints, topChartLeft, topChartBottom,
      topChartWidth, topChartHeight, topYRange.min, topYRange.max,
      LINE_COLOURS[t % LINE_COLOURS.length], false);
  }
  for (let tb = 0; tb < bmSeries.length; tb++) {
    plotLine(page, bmSeries[tb].values, totalPoints, topChartLeft, topChartBottom,
      topChartWidth, topChartHeight, topYRange.min, topYRange.max,
      LINE_COLOURS[(data.topSeries.length + tb) % LINE_COLOURS.length], true);
  }

  y = topChartBottom - X_AXIS_HEIGHT - gapBetweenCharts;

  // --- Bottom chart ---
  y = drawTitleBar(page, "Bottom " + count + " Performers \u2014 " + periodLabel, MARGIN_LEFT, y, pageWidth, fonts);

  y = drawChartLegend(page, bottomLegendItems, MARGIN_LEFT + 4, y - 12, pageWidth - 8, legendPerRow, fonts);
  y -= LEGEND_PADDING;

  const bottomYRange = calculateYRange(
    data.bottomSeries.map(function (s) { return s.values; })
      .concat(bmSeries.map(function (s) { return s.values; }))
  );
  const bottomChartLeft = MARGIN_LEFT + Y_AXIS_WIDTH;
  const bottomChartWidth = topChartWidth;
  const bottomChartBottom = y - chartAreaHeight;
  const bottomChartHeight = chartAreaHeight;

  drawGrid(page, bottomChartLeft, bottomChartBottom, bottomChartWidth, bottomChartHeight,
    bottomYRange.min, bottomYRange.max, bottomYRange.ticks);
  drawYAxis(page, bottomChartLeft, bottomChartBottom, bottomChartHeight,
    bottomYRange.min, bottomYRange.max, bottomYRange.ticks, fonts);
  drawXAxis(page, sampleDates, bottomChartLeft, bottomChartBottom, bottomChartWidth, totalWeeks, fonts);

  for (let bt = 0; bt < data.bottomSeries.length; bt++) {
    plotLine(page, data.bottomSeries[bt].values, totalPoints, bottomChartLeft, bottomChartBottom,
      bottomChartWidth, bottomChartHeight, bottomYRange.min, bottomYRange.max,
      LINE_COLOURS[(5 + bt) % LINE_COLOURS.length], false);
  }
  for (let bb = 0; bb < bmSeries.length; bb++) {
    plotLine(page, bmSeries[bb].values, totalPoints, bottomChartLeft, bottomChartBottom,
      bottomChartWidth, bottomChartHeight, bottomYRange.min, bottomYRange.max,
      LINE_COLOURS[(5 + data.bottomSeries.length + bb) % LINE_COLOURS.length], true);
  }

  drawPageFooters(pages, title, MARGIN_LEFT, pageWidth, fonts);
  return await pdf.save();
}

/**
 * @description Build legend items for a chart section.
 * @param {Array<Object>} series - Investment series
 * @param {Array<Object>} bmSeries - Benchmark series
 * @param {number} colourOffset - Offset into LINE_COLOURS
 * @returns {Array<Object>} Legend items
 */
function buildLegendItems(series, bmSeries, colourOffset) {
  const items = [];
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const sign = s.returnPct >= 0 ? "+" : "";
    items.push({
      label: s.label + " (" + sign + s.returnPct.toFixed(1) + "%)",
      colour: LINE_COLOURS[(colourOffset + i) % LINE_COLOURS.length],
      isDotted: false,
      publicId: s.publicId || null,
      currencyCode: s.currencyCode || null,
      morningstarId: s.morningstarId || null,
    });
  }
  for (let b = 0; b < bmSeries.length; b++) {
    const bm = bmSeries[b];
    const bmSign = bm.returnPct !== null && bm.returnPct >= 0 ? "+" : "";
    items.push({
      label: bm.label + (bm.returnPct !== null ? " (" + bmSign + bm.returnPct.toFixed(1) + "%)" : ""),
      colour: LINE_COLOURS[(colourOffset + series.length + b) % LINE_COLOURS.length],
      isDotted: true,
      publicId: null,
      currencyCode: null,
      morningstarId: null,
    });
  }
  return items;
}

// ─── 4. Risk vs Return Scatter PDF ──────────────────────────────

/**
 * @description Generate a PDF of the risk vs return scatter plot.
 * @param {string} period - Period code
 * @param {Array<number>} benchmarkIds - Benchmark IDs
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function generateRiskReturnPdf(period, benchmarkIds, investmentIds, filterText) {
  const data = buildRiskReturnData(period, investmentIds);
  const bmData = benchmarkIds.length > 0 ? buildBenchmarkReturnData(benchmarkIds, period) : [];
  const periodLabel = PERIOD_LABELS[period] || period;
  const title = "Risk vs Return \u2014 " + periodLabel;

  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  let page = pdf.addPage({ size: "a4", orientation: "landscape" });
  const pages = [page];
  let y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP, fonts);

  y = drawTitleBar(page, title, MARGIN_LEFT, y, USABLE_WIDTH, fonts);
  y = drawFilterSubtitle(page, filterText, MARGIN_LEFT, y, fonts);
  y -= 8;

  const investments = data.investments || [];

  // Calculate axis ranges
  const allReturns = investments.map(function (inv) { return inv.returnPct; });
  const allVols = investments.map(function (inv) { return inv.volatility; });
  for (let b = 0; b < bmData.length; b++) {
    if (bmData[b].returnPct !== null) allReturns.push(bmData[b].returnPct);
    if (bmData[b].volatility !== null) allVols.push(bmData[b].volatility);
  }

  if (allReturns.length === 0) {
    page.drawText("No data available for this period.", {
      x: MARGIN_LEFT + 10,
      y: y - 20,
      font: fonts.regular,
      size: 10,
      color: COLOURS.brand600,
    });
    drawPageFooters(pages, title, MARGIN_LEFT, USABLE_WIDTH, fonts);
    return await pdf.save();
  }

  let returnMin = Math.min.apply(null, allReturns);
  let returnMax = Math.max.apply(null, allReturns);
  let volMin = Math.min.apply(null, allVols);
  let volMax = Math.max.apply(null, allVols);

  // Add padding
  const retPad = (returnMax - returnMin) * 0.15 || 5;
  const volPad = (volMax - volMin) * 0.15 || 2;
  returnMin -= retPad;
  returnMax += retPad;
  volMin = Math.max(0, volMin - volPad);
  volMax += volPad;

  // Calculate medians for quadrant lines
  const sortedReturns = investments.map(function (inv) { return inv.returnPct; }).sort(function (a, b) { return a - b; });
  const sortedVols = investments.map(function (inv) { return inv.volatility; }).sort(function (a, b) { return a - b; });
  const medianReturn = sortedReturns[Math.floor(sortedReturns.length / 2)] || 0;
  const medianVol = sortedVols[Math.floor(sortedVols.length / 2)] || 0;

  // Chart area
  const chartLeft = MARGIN_LEFT + Y_AXIS_WIDTH + 10;
  const chartWidth = USABLE_WIDTH - Y_AXIS_WIDTH - CHART_RIGHT_PAD - 10;
  const legendSpace = 50; // space below chart for legend
  const chartBottom = MARGIN_BOTTOM + X_AXIS_HEIGHT + legendSpace;
  const chartHeight = y - chartBottom - 10;

  let returnRange = returnMax - returnMin;
  let volRange = volMax - volMin;

  // Grid and axes
  const retTicks = calculateYRange([allReturns]);
  drawGrid(page, chartLeft, chartBottom, chartWidth, chartHeight,
    retTicks.min, retTicks.max, retTicks.ticks);
  drawYAxis(page, chartLeft, chartBottom, chartHeight,
    retTicks.min, retTicks.max, retTicks.ticks, fonts);

  // Override with tick-snapped ranges
  returnMin = retTicks.min;
  returnMax = retTicks.max;
  returnRange = returnMax - returnMin;

  // X-axis labels (volatility %)
  const volInterval = niceNumber((volMax - volMin) / 8);
  const volStart = Math.floor(volMin / volInterval) * volInterval;
  for (let vt = volStart; vt <= volMax + volInterval * 0.01; vt += volInterval) {
    const vx = chartLeft + ((vt - volMin) / volRange) * chartWidth;
    if (vx < chartLeft || vx > chartLeft + chartWidth) continue;
    const volLabel = vt.toFixed(vt === Math.round(vt) ? 0 : 1) + "%";
    const vlw = fonts.regular.widthOfTextAtSize(volLabel, FONT_SIZE_AXIS);
    page.drawLine({
      start: { x: vx, y: chartBottom },
      end: { x: vx, y: chartBottom - 4 },
      color: COLOURS.brand200,
      thickness: 0.5,
    });
    page.drawText(volLabel, {
      x: vx - vlw / 2,
      y: chartBottom - 14,
      font: fonts.regular,
      size: FONT_SIZE_AXIS,
      color: COLOURS.brand600,
    });
    // Vertical grid
    page.drawLine({
      start: { x: vx, y: chartBottom },
      end: { x: vx, y: chartBottom + chartHeight },
      color: COLOURS.gridLine,
      thickness: 0.3,
    });
  }

  // Axis labels
  page.drawText("Volatility (%)", {
    x: chartLeft + chartWidth / 2 - fonts.regular.widthOfTextAtSize("Volatility (%)", FONT_SIZE_AXIS) / 2,
    y: chartBottom - 24,
    font: fonts.regular,
    size: FONT_SIZE_AXIS,
    color: COLOURS.brand600,
  });

  // Median lines (dashed)
  const medRetY = chartBottom + ((medianReturn - returnMin) / returnRange) * chartHeight;
  const medVolX = chartLeft + ((medianVol - volMin) / volRange) * chartWidth;

  if (medRetY >= chartBottom && medRetY <= chartBottom + chartHeight) {
    drawDashedLine(page, chartLeft, medRetY, chartLeft + chartWidth, medRetY, COLOURS.brand300, 0.5);
  }
  if (medVolX >= chartLeft && medVolX <= chartLeft + chartWidth) {
    drawDashedLine(page, medVolX, chartBottom, medVolX, chartBottom + chartHeight, COLOURS.brand300, 0.5);
  }

  // Quadrant labels
  const quadrantAlpha = rgb(0.7, 0.72, 0.75);
  const quadFontSize = 8;

  page.drawText("Strong & Steady", {
    x: chartLeft + 6,
    y: chartBottom + chartHeight - quadFontSize - 4,
    font: fonts.regular,
    size: quadFontSize,
    color: quadrantAlpha,
  });

  const hrhrText = "High Reward, High Risk";
  const hrhrW = fonts.regular.widthOfTextAtSize(hrhrText, quadFontSize);
  page.drawText(hrhrText, {
    x: chartLeft + chartWidth - hrhrW - 6,
    y: chartBottom + chartHeight - quadFontSize - 4,
    font: fonts.regular,
    size: quadFontSize,
    color: quadrantAlpha,
  });

  page.drawText("Steady but Weak", {
    x: chartLeft + 6,
    y: chartBottom + 6,
    font: fonts.regular,
    size: quadFontSize,
    color: quadrantAlpha,
  });

  const revText = "Review";
  const revW = fonts.regular.widthOfTextAtSize(revText, quadFontSize);
  page.drawText(revText, {
    x: chartLeft + chartWidth - revW - 6,
    y: chartBottom + 6,
    font: fonts.regular,
    size: quadFontSize,
    color: quadrantAlpha,
  });

  // Plot investment points with numbered labels
  const pointRadius = 3.5;
  const numberFontSize = 6;
  const keyEntries = []; // collect entries for key table

  for (let inv = 0; inv < investments.length; inv++) {
    const invData = investments[inv];
    const px = chartLeft + ((invData.volatility - volMin) / volRange) * chartWidth;
    const py = chartBottom + ((invData.returnPct - returnMin) / returnRange) * chartHeight;
    const invNum = inv + 1;

    // Colour by quadrant position
    let colour;
    if (invData.returnPct >= medianReturn && invData.volatility <= medianVol) {
      colour = SCATTER_GREEN;
    } else if (invData.returnPct < medianReturn && invData.volatility > medianVol) {
      colour = SCATTER_RED;
    } else {
      colour = SCATTER_BLUE;
    }

    drawFilledCircle(page, px, py, pointRadius, colour);

    // Draw number label offset to top-right of point
    const numStr = String(invNum);
    page.drawText(numStr, {
      x: px + pointRadius + 1,
      y: py + pointRadius - 1,
      font: fonts.bold,
      size: numberFontSize,
      color: COLOURS.brand800,
    });

    keyEntries.push({
      num: invNum,
      description: invData.description || "",
      publicId: invData.publicId || "",
      morningstarId: invData.morningstarId || "",
      returnPct: invData.returnPct,
      volatility: invData.volatility,
      colour: colour,
      shape: "circle",
    });
  }

  // Plot benchmark points as triangles with letter labels
  const bmLetters = "ABCDEFGHIJ";
  for (let bm = 0; bm < bmData.length; bm++) {
    if (bmData[bm].returnPct === null || bmData[bm].volatility === null) continue;
    const bpx = chartLeft + ((bmData[bm].volatility - volMin) / volRange) * chartWidth;
    const bpy = chartBottom + ((bmData[bm].returnPct - returnMin) / returnRange) * chartHeight;
    drawTriangle(page, bpx, bpy, 5, SCATTER_GREY);

    // Letter label
    const bmLetter = bmLetters.charAt(bm);
    page.drawText(bmLetter, {
      x: bpx + 6,
      y: bpy + 3,
      font: fonts.bold,
      size: numberFontSize,
      color: COLOURS.brand800,
    });

    keyEntries.push({
      num: bmLetter,
      description: bmData[bm].description || "",
      publicId: "",
      morningstarId: "",
      returnPct: bmData[bm].returnPct,
      volatility: bmData[bm].volatility,
      colour: SCATTER_GREY,
      shape: "triangle",
    });
  }

  // Colour legend below chart
  const legendY = chartBottom - X_AXIS_HEIGHT - 10;
  const legendItems = [
    { label: "High return, low volatility", colour: SCATTER_GREEN, shape: "circle" },
    { label: "Low return, high volatility", colour: SCATTER_RED, shape: "circle" },
    { label: "Other", colour: SCATTER_BLUE, shape: "circle" },
  ];
  if (bmData.length > 0) {
    legendItems.push({ label: "Benchmark", colour: SCATTER_GREY, shape: "triangle" });
  }

  let lx = MARGIN_LEFT + 10;
  for (let li = 0; li < legendItems.length; li++) {
    const legendItem = legendItems[li];
    if (legendItem.shape === "triangle") {
      drawTriangle(page, lx + 4, legendY + 3, 4, legendItem.colour);
    } else {
      drawFilledCircle(page, lx + 4, legendY + 3, 3, legendItem.colour);
    }
    lx += 12;
    page.drawText(legendItem.label, {
      x: lx,
      y: legendY,
      font: fonts.regular,
      size: FONT_SIZE_LEGEND,
      color: COLOURS.brand600,
    });
    lx += fonts.regular.widthOfTextAtSize(legendItem.label, FONT_SIZE_LEGEND) + 16;
  }

  // ─── Key table on page 2 (portrait) ───────────────────────────
  let keyPage = pdf.addPage({ size: "a4", orientation: "portrait" });
  pages.push(keyPage);
  let ky = drawPageHeader(pdf, keyPage, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);

  ky = drawTitleBar(keyPage, "Risk vs Return \u2014 Key", MARGIN_LEFT, ky, PORTRAIT_USABLE_WIDTH, fonts);
  ky -= 6;

  // Key table columns: #, Name, Type, Return%, Volatility%
  const keyColNum = 20;
  const keyColReturn = 52;
  const keyColVol = 52;
  const keyColName = PORTRAIT_USABLE_WIDTH - keyColNum - keyColReturn - keyColVol;

  const keyColNumX = MARGIN_LEFT;
  const keyColNameX = keyColNumX + keyColNum;
  const keyColReturnX = keyColNameX + keyColName;
  const keyColVolX = keyColReturnX + keyColReturn;

  // Column headers
  ky -= HEADER_ROW_HEIGHT;
  keyPage.drawRectangle({
    x: MARGIN_LEFT,
    y: ky - 2,
    width: PORTRAIT_USABLE_WIDTH,
    height: HEADER_ROW_HEIGHT,
    color: COLOURS.brand100,
  });
  keyPage.drawText("#", {
    x: keyColNumX + 4,
    y: ky + 2,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  keyPage.drawText("Investment", {
    x: keyColNameX + 4,
    y: ky + 2,
    font: fonts.bold,
    size: FONT_SIZE_HEADER,
    color: COLOURS.brand800,
  });
  drawRightAligned(keyPage, "Return %", keyColReturnX, keyColReturn, ky + 2,
    fonts.bold, FONT_SIZE_HEADER, COLOURS.brand800);
  drawRightAligned(keyPage, "Volatility %", keyColVolX, keyColVol, ky + 2,
    fonts.bold, FONT_SIZE_HEADER, COLOURS.brand800);

  // Key table rows
  for (let ki = 0; ki < keyEntries.length; ki++) {
    const entry = keyEntries[ki];
    ky -= ROW_HEIGHT;

    // Page break if needed
    if (ky < MARGIN_BOTTOM + 40) {
      keyPage = pdf.addPage({ size: "a4", orientation: "portrait" });
      pages.push(keyPage);
      ky = drawPageHeader(pdf, keyPage, MARGIN_LEFT, A4_PORTRAIT_HEIGHT, MARGIN_TOP, fonts);
      ky -= 10;
    }

    // Zebra stripe
    if (ki % 2 === 0) {
      keyPage.drawRectangle({
        x: MARGIN_LEFT,
        y: ky - 2,
        width: PORTRAIT_USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: COLOURS.brand100,
      });
    }
    // Benchmark rows get grey background
    if (entry.shape === "triangle") {
      keyPage.drawRectangle({
        x: MARGIN_LEFT,
        y: ky - 2,
        width: PORTRAIT_USABLE_WIDTH,
        height: ROW_HEIGHT,
        color: COLOURS.benchmarkBg,
      });
    }

    // Number/letter with colour swatch
    if (entry.shape === "triangle") {
      drawTriangle(keyPage, keyColNumX + 5, ky + 3, 3, entry.colour);
    } else {
      drawFilledCircle(keyPage, keyColNumX + 5, ky + 3, 2.5, entry.colour);
    }
    keyPage.drawText(String(entry.num), {
      x: keyColNumX + 11,
      y: ky + 1,
      font: fonts.medium,
      size: FONT_SIZE_ROW,
      color: COLOURS.brand800,
    });

    // Investment name (truncated, with research links if available)
    const nameMaxWidth = keyColName - 8;
    const entryName = truncateText(entry.description, fonts.medium, FONT_SIZE_ROW, nameMaxWidth);
    if (!isTestMode() && (entry.publicId || entry.morningstarId)) {
      drawInvestmentName(keyPage, entry.description,
        keyColNameX + 4, ky + 1, nameMaxWidth,
        entry.publicId, "", entry.morningstarId, fonts);
    } else {
      keyPage.drawText(entryName, {
        x: keyColNameX + 4,
        y: ky + 1,
        font: fonts.medium,
        size: FONT_SIZE_ROW,
        color: COLOURS.brand800,
      });
    }

    // Return %
    drawRightAligned(keyPage, formatChange(entry.returnPct), keyColReturnX, keyColReturn, ky + 1,
      fonts.medium, FONT_SIZE_ROW, changeColour(entry.returnPct));

    // Volatility %
    drawRightAligned(keyPage, entry.volatility.toFixed(1) + "%", keyColVolX, keyColVol, ky + 1,
      fonts.medium, FONT_SIZE_ROW, COLOURS.brand600);
  }

  // Footer across all pages (mixed orientations)
  const pageWidths = pages.map(function (p, i) {
    return i === 0 ? USABLE_WIDTH : PORTRAIT_USABLE_WIDTH;
  });
  drawPageFooters(pages, title, MARGIN_LEFT, pageWidths, fonts);
  return await pdf.save();
}

/**
 * @description Draw a dashed line between two points.
 * @param {Object} page - PDFPage instance
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {Object} colour - RGB colour
 * @param {number} thickness - Line thickness
 */
function drawDashedLine(page, x1, y1, x2, y2, colour, thickness) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  const dashLen = 4;
  const gapLen = 3;
  const ux = dx / len;
  const uy = dy / len;
  let pos = 0;

  while (pos < len) {
    const end = Math.min(pos + dashLen, len);
    page.drawLine({
      start: { x: x1 + ux * pos, y: y1 + uy * pos },
      end: { x: x1 + ux * end, y: y1 + uy * end },
      color: colour,
      thickness: thickness,
    });
    pos = end + gapLen;
  }
}

/**
 * @description Draw a filled circle (approximated with small rectangle segments).
 * @param {Object} page - PDFPage instance
 * @param {number} cx - Centre X
 * @param {number} cy - Centre Y
 * @param {number} radius - Circle radius
 * @param {Object} colour - RGB fill colour
 */
function drawFilledCircle(page, cx, cy, radius, colour) {
  // Approximate filled circle with concentric rectangles
  const steps = Math.ceil(radius * 2);
  for (let i = -steps; i <= steps; i++) {
    const dy = (i / steps) * radius;
    const halfWidth = Math.sqrt(radius * radius - dy * dy);
    page.drawRectangle({
      x: cx - halfWidth,
      y: cy + dy - 0.5,
      width: halfWidth * 2,
      height: 1,
      color: colour,
    });
  }
}

/**
 * @description Draw a filled triangle (pointing up).
 * @param {Object} page - PDFPage instance
 * @param {number} cx - Centre X
 * @param {number} cy - Centre Y
 * @param {number} size - Half-size
 * @param {Object} colour - RGB colour
 */
function drawTriangle(page, cx, cy, size, colour) {
  // Fill with horizontal slices
  for (let row = 0; row <= size * 2; row++) {
    const yOff = -size + row;
    const frac = row / (size * 2);
    const halfW = frac * size;
    page.drawRectangle({
      x: cx - halfW,
      y: cy + yOff - 0.5,
      width: Math.max(halfW * 2, 0.5),
      height: 1,
      color: colour,
    });
  }
}
