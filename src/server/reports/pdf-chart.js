import { PDF, rgb } from "@libpdf/core";
import { embedRobotoFonts } from "./pdf-fonts.js";
import { getChartData } from "../services/chart-data-service.js";
import { isTestMode } from "../test-mode.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";
import { buildFtMarketsUrl, buildMorningstarUrl } from "../../shared/public-id-utils.js";

/**
 * @description A4 page dimensions in points.
 * Single charts default to landscape for maximum plot width.
 * Chart groups may use portrait (2 charts stacked) or landscape (2×2 grid).
 */
const A4_LANDSCAPE_WIDTH = 841.89;
const A4_LANDSCAPE_HEIGHT = 595.28;
const A4_PORTRAIT_WIDTH = 595.28;
const A4_PORTRAIT_HEIGHT = 841.89;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const USABLE_WIDTH = A4_LANDSCAPE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const A4_PORTRAIT_USABLE_WIDTH = A4_PORTRAIT_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

/**
 * @description Brand colours for chart elements.
 */
const COLOURS = {
  brand800: rgb(0.15, 0.23, 0.42),
  brand700: rgb(0.2, 0.3, 0.5),
  brand600: rgb(0.35, 0.42, 0.55),
  brand200: rgb(0.82, 0.85, 0.9),
  emerald900: rgb(0.02, 0.32, 0.21),
  white: rgb(1, 1, 1),
  gridLine: rgb(0.9, 0.9, 0.9),
  zeroLine: rgb(0.75, 0.75, 0.75),
  linkBlue: rgb(0.05, 0.27, 0.63),
};

/**
 * @description Ten contrasting line colours for data series.
 * First 5 are stronger, next 5 are supplementary.
 * @type {Array<Object>}
 */
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

/** @description Font sizes */
const FONT_SIZE_TITLE = 12;
const FONT_SIZE_SUBTITLE = 9;
const FONT_SIZE_LEGEND = 7;
const FONT_SIZE_AXIS = 7;

/** @description Chart layout dimensions */
const TITLE_BAR_HEIGHT = 28;
const SUBTITLE_HEIGHT = 16;
const LEGEND_ROW_HEIGHT = 14;
const LEGEND_PADDING = 4;
const X_AXIS_HEIGHT = 28;
const Y_AXIS_WIDTH = 45;
const CHART_RIGHT_PAD = 10;

/**
 * @description Chart type renderer registry. Maps chartType names to their
 * rendering functions. Each renderer accepts (ctx, params, blockDef) and
 * draws one chart into the shared PDF context.
 *
 * When adding a new chart type, add a renderer function and register it here.
 * The renderer must respect blockDef._bounds for multi-chart layouts.
 * @type {Object<string, Function>}
 */
const CHART_RENDERERS = {
  line: renderLineChart,
};

/**
 * @description Dispatch a chart render to the appropriate renderer based on
 * blockDef.chartType. Defaults to "line" (comparative line chart) when
 * chartType is not specified. Unknown chart types are silently skipped.
 * @param {Object} ctx - Shared rendering context
 * @param {Array<string>} params - Params array (inv:ID or bm:DESC entries)
 * @param {Object} [blockDef] - Block definition with optional chartType field
 */
export function renderChartBlock(ctx, params, blockDef) {
  const chartType = (blockDef && blockDef.chartType) || "line";
  const renderer = CHART_RENDERERS[chartType];

  if (!renderer) {
    // Unknown chart type — draw a message and skip
    const page = ctx.page;
    const fonts = ctx.fonts;
    page.drawText("Unknown chart type: " + chartType, {
      x: 40,
      y: ctx.y - 14,
      font: fonts.regular,
      size: 10,
      color: COLOURS.brand800,
    });
    ctx.y -= 30;
    return;
  }

  renderer(ctx, params, blockDef);
}

/**
 * @description Render a comparative line chart into a shared PDF context.
 * Draws title bar, subtitle, legend, axes, grid, and data lines.
 * Does not add footers — the caller is responsible for that.
 * @param {Object} ctx - Shared rendering context
 * @param {Object} ctx.pdf - The PDF document
 * @param {Object} ctx.page - Current page (updated in place on ctx)
 * @param {Array<Object>} ctx.pages - Array of all pages
 * @param {number} ctx.y - Current y position (updated in place on ctx)
 * @param {Array<number>} ctx.pageWidths - Per-page usable widths
 * @param {Array<string>} params - Params array (inv:ID or bm:DESC entries)
 * @param {Object} [blockDef] - Optional block definition with title, subTitle, etc.
 */
function renderLineChart(ctx, params, blockDef) {
  const pdf = ctx.pdf;
  const page = ctx.page;
  let y = ctx.y;
  const fonts = ctx.fonts;

  // Support bounded rendering for multi-chart layouts.
  // _bounds overrides the module-level margin/width constants so that
  // multiple charts can share a single page.
  const bounds = (blockDef && blockDef._bounds) || null;
  const areaLeft = bounds ? bounds.left : MARGIN_LEFT;
  const areaWidth = bounds ? bounds.width : USABLE_WIDTH;
  const areaBottom = bounds ? bounds.bottom : MARGIN_BOTTOM;
  const footerClearance = bounds ? 5 : 20;

  // Build chart definition from blockDef + params
  const chartDef = {
    title: (blockDef && blockDef.title) || "Performance Chart",
    subTitle: (blockDef && blockDef.subTitle) || "",
    fromMonthsAgo: (blockDef && blockDef.fromMonthsAgo) || "0",
    monthsToShow: (blockDef && blockDef.monthsToShow) || "12",
    smooth: blockDef && blockDef.smooth === true,
    showGlobalEvents: blockDef && blockDef.showGlobalEvents === true,
    params: params,
  };

  // Use pre-built chart data if provided (e.g. portfolio value charts),
  // otherwise fetch investment/benchmark data via getChartData()
  const data = (blockDef && blockDef._chartData) ? blockDef._chartData : getChartData(chartDef);

  if (!data.series || data.series.length === 0) {
    page.drawText(chartDef.title + " \u2014 no data available.", {
      x: areaLeft,
      y: y - 14,
      font: fonts.regular,
      size: 14,
      color: COLOURS.brand800,
    });
    ctx.y = y - 30;
    return;
  }

  // Calculate chart area
  const chartLeft = areaLeft + Y_AXIS_WIDTH;
  const chartRight = areaLeft + areaWidth - CHART_RIGHT_PAD;
  const chartWidth = chartRight - chartLeft;

  // Reserve extra space below X-axis for event legend when events are present.
  // In chart groups, the legend is drawn once at page level, so individual
  // charts suppress the legend and don't reserve space for it.
  const hasEvents = data.events && data.events.length > 0;
  const suppressEventLegend = blockDef && blockDef._suppressEventLegend === true;
  const eventAreaHeight = (hasEvents && !suppressEventLegend) ? 24 : 0;

  // Determine legend row count before calculating chart area
  const legendRows = calculateLegendRows(data.series);
  const legendHeight = legendRows * LEGEND_ROW_HEIGHT + LEGEND_PADDING;

  const chartTop = y - TITLE_BAR_HEIGHT - SUBTITLE_HEIGHT - legendHeight;
  const chartBottom = areaBottom + X_AXIS_HEIGHT + eventAreaHeight + footerClearance;
  const chartHeight = chartTop - chartBottom;

  // Minimum chart height: 60pt for bounded (multi-chart) layouts where space
  // is tight, 100pt for standalone charts where we have a full page.
  const minChartHeight = bounds ? 60 : 100;
  if (chartHeight < minChartHeight) {
    ctx.y = y;
    return;
  }

  // --- Title bar (white text on coloured rectangle — emerald in test mode) ---
  const titleBarColour = isTestMode() ? COLOURS.emerald900 : COLOURS.brand800;
  page.drawRectangle({
    x: areaLeft,
    y: y - TITLE_BAR_HEIGHT,
    width: areaWidth,
    height: TITLE_BAR_HEIGHT,
    color: titleBarColour,
  });
  page.drawText(data.title, {
    x: areaLeft + 10,
    y: y - TITLE_BAR_HEIGHT + 9,
    font: fonts.bold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.white,
  });
  y -= TITLE_BAR_HEIGHT;

  // --- Subtitle (full width, aligned with title banner) ---
  if (data.subTitle) {
    page.drawText(data.subTitle, {
      x: areaLeft + 4,
      y: y - SUBTITLE_HEIGHT + 4,
      font: fonts.regular,
      size: FONT_SIZE_SUBTITLE,
      color: COLOURS.brand600,
    });
  }
  y -= SUBTITLE_HEIGHT;

  // --- Legend (full width, aligned with title banner) ---
  drawLegend(page, data.series, areaLeft + 4, y, areaWidth - 8, fonts);
  y -= legendHeight;

  // --- Determine Y-axis range ---
  const yRange = calculateYRange(data.series, data.valueMode);
  const yMin = yRange.min;
  const yMax = yRange.max;
  const yTicks = yRange.ticks;

  // --- Draw grid and axes ---
  drawGrid(page, chartLeft, chartBottom, chartWidth, chartHeight, yMin, yMax, yTicks);
  drawYAxis(page, chartLeft, chartBottom, chartHeight, yMin, yMax, yTicks, fonts, data.valueMode);
  drawXAxis(page, data.sampleDates, chartLeft, chartBottom, chartWidth, data.monthsToShow, fonts);

  // --- Plot data lines ---
  for (let s = 0; s < data.series.length; s++) {
    const series = data.series[s];
    const colour = LINE_COLOURS[s % LINE_COLOURS.length];
    const isDashed = series.type === "benchmark";

    plotLine(page, series.values, data.sampleDates, chartLeft, chartBottom,
      chartWidth, chartHeight, yMin, yMax, colour, isDashed, chartDef.smooth);
  }

  // --- Draw global event markers ---
  if (hasEvents) {
    drawEventMarkers(page, data.events, data.sampleDates, chartLeft, chartBottom,
      chartWidth, chartBottom - X_AXIS_HEIGHT - 4, suppressEventLegend, fonts);
  }

  // Expose events on ctx so chart group can draw a shared legend
  if (hasEvents && suppressEventLegend) {
    ctx._events = data.events;
  }

  // Update ctx.y to below the chart
  ctx.y = chartBottom - X_AXIS_HEIGHT - eventAreaHeight - 10;
  ctx.page = page;
}

/**
 * @description Calculate the number of legend rows needed.
 * Investments and benchmarks are always on separate rows.
 * Each category is split into rows of at most 4 items.
 * @param {Array<Object>} series - Data series with label and type
 * @returns {number} Number of legend rows
 */
function calculateLegendRows(series) {
  let invCount = 0;
  let bmCount = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i].type === "benchmark") {
      bmCount++;
    } else {
      invCount++;
    }
  }
  const invRows = invCount > 0 ? Math.ceil(invCount / 4) : 0;
  const bmRows = bmCount > 0 ? Math.ceil(bmCount / 4) : 0;
  return Math.max(invRows + bmRows, 1);
}

/**
 * @description Measure the total width of a row of legend items.
 * @param {Object} font - Embedded font instance for text measurement
 * @param {Array<string>} labels - Display labels for each item
 * @param {number} boxSize - Width of the colour indicator
 * @param {number} gap - Gap between items
 * @returns {number} Total width in points
 */
function measureLegendRow(font, labels, boxSize, gap, extraWidths) {
  let width = 0;
  for (let i = 0; i < labels.length; i++) {
    width += boxSize + 3 + font.widthOfTextAtSize(labels[i], FONT_SIZE_LEGEND);
    if (extraWidths && extraWidths[i]) width += extraWidths[i];
    if (i < labels.length - 1) width += gap;
  }
  return width;
}

/**
 * @description Truncate labels evenly until the row fits within the available
 * width. Removes characters from the end of each label and adds an ellipsis.
 * @param {Object} font - Embedded font instance for text measurement
 * @param {Array<string>} labels - Labels to truncate (modified in place)
 * @param {number} availableWidth - Maximum row width in points
 * @param {number} boxSize - Width of the colour indicator
 * @param {number} gap - Gap between items
 */
function truncateLabelsToFit(font, labels, availableWidth, boxSize, gap, extraWidths) {
  let maxChars = Math.max.apply(null, labels.map(function (l) { return l.length; }));

  // Progressively shorten all labels until row fits
  while (maxChars > 5) {
    const totalWidth = measureLegendRow(font, labels, boxSize, gap, extraWidths);
    if (totalWidth <= availableWidth) return;

    maxChars -= 1;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i].length > maxChars) {
        labels[i] = labels[i].substring(0, maxChars - 1) + "\u2026";
      }
    }
  }
}

/**
 * @description Draw one row of legend items at the given Y position.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} items - Items to draw, each with {label, colour, isBenchmark, seriesIndex}
 * @param {Array<string>} displayLabels - Possibly truncated display labels
 * @param {number} startX - Left edge of legend area
 * @param {number} legendY - Y position for this row
 */
function drawLegendRow(page, items, displayLabels, startX, legendY, fonts) {
  const boxSize = 8;
  const gap = 14;
  let x = startX;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const label = displayLabels[i];

    if (item.isBenchmark) {
      // Dotted line indicator for benchmarks
      const dotY = legendY + boxSize / 2 - 1;
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
      // Solid square for investments
      page.drawRectangle({
        x: x,
        y: legendY,
        width: boxSize,
        height: boxSize,
        color: item.colour,
      });
    }

    x += boxSize + 3;

    // Investment labels: blue text with clickable research links
    const hasAnyLink = !item.isBenchmark && (item.publicId || item.morningstarId);
    const textColour = hasAnyLink ? COLOURS.linkBlue : COLOURS.brand800;

    page.drawText(label, {
      x: x,
      y: legendY + 1,
      font: fonts.regular,
      size: FONT_SIZE_LEGEND,
      color: textColour,
    });

    let textWidth = fonts.regular.widthOfTextAtSize(label, FONT_SIZE_LEGEND);

    // Add visible clickable link indicators after the label text
    if (hasAnyLink) {
      const ftLinkUrl = item.publicId ? buildFtMarketsUrl(item.publicId, item.currencyCode) : null;
      const msLinkUrl = item.morningstarId ? buildMorningstarUrl(item.morningstarId) : null;
      const linkTagSize = FONT_SIZE_LEGEND - 1;
      let linkX = x + textWidth + 2;

      if (ftLinkUrl && msLinkUrl) {
        // Both links: draw "(FT)" and "(MS)" with underlined letters only
        const parenOpenW = fonts.regular.widthOfTextAtSize("(", linkTagSize);
        const parenCloseW = fonts.regular.widthOfTextAtSize(")", linkTagSize);
        const ftLettersW = fonts.regular.widthOfTextAtSize("FT", linkTagSize);
        const msLettersW = fonts.regular.widthOfTextAtSize("MS", linkTagSize);
        const ftTagWidth = parenOpenW + ftLettersW + parenCloseW;
        const msTagWidth = parenOpenW + msLettersW + parenCloseW;
        const underlineY = legendY;

        // Draw "(FT)" — underline only the "FT" letters
        page.drawText("(", { x: linkX, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        const ftLettersX = linkX + parenOpenW;
        page.drawText("FT", { x: ftLettersX, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        page.drawLine({ start: { x: ftLettersX, y: underlineY }, end: { x: ftLettersX + ftLettersW, y: underlineY }, color: COLOURS.linkBlue, thickness: 0.5 });
        page.drawText(")", { x: ftLettersX + ftLettersW, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        page.addLinkAnnotation({
          rect: { x: linkX, y: legendY - 1, width: ftTagWidth, height: FONT_SIZE_LEGEND + 3 },
          uri: ftLinkUrl,
          borderWidth: 0,
        });

        // Draw "(MS)" — underline only the "MS" letters
        linkX += ftTagWidth + 2;
        page.drawText("(", { x: linkX, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        const msLettersX = linkX + parenOpenW;
        page.drawText("MS", { x: msLettersX, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        page.drawLine({ start: { x: msLettersX, y: underlineY }, end: { x: msLettersX + msLettersW, y: underlineY }, color: COLOURS.linkBlue, thickness: 0.5 });
        page.drawText(")", { x: msLettersX + msLettersW, y: legendY + 1, font: fonts.regular, size: linkTagSize, color: COLOURS.linkBlue });
        page.addLinkAnnotation({
          rect: { x: linkX, y: legendY - 1, width: msTagWidth, height: FONT_SIZE_LEGEND + 3 },
          uri: msLinkUrl,
          borderWidth: 0,
        });

        textWidth += 2 + ftTagWidth + 2 + msTagWidth;
      } else if (ftLinkUrl) {
        // Single link: make the label text itself clickable
        page.addLinkAnnotation({
          rect: { x: x, y: legendY - 1, width: textWidth, height: FONT_SIZE_LEGEND + 3 },
          uri: ftLinkUrl,
          borderWidth: 0,
        });
      } else if (msLinkUrl) {
        // Single link: make the label text itself clickable
        page.addLinkAnnotation({
          rect: { x: x, y: legendY - 1, width: textWidth, height: FONT_SIZE_LEGEND + 3 },
          uri: msLinkUrl,
          borderWidth: 0,
        });
      }
    }

    x += textWidth + gap;
  }
}

/**
 * @description Draw the legend showing coloured squares/lines and series labels.
 * Investments and benchmarks are drawn on separate rows. Each category is
 * split into rows of at most 4 items. Labels are truncated with ellipsis
 * if a row would overflow the available width.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} series - Data series with label and type
 * @param {number} startX - Left edge of legend area
 * @param {number} y - Y position for the first legend row
 * @param {number} availableWidth - Maximum width for legend content
 */
function drawLegend(page, series, startX, y, availableWidth, fonts) {
  const font = fonts.regular;
  const boxSize = 8;
  const gap = 14;
  const maxPerRow = 4;

  // Split series into investments and benchmarks, preserving original colour index
  const investments = [];
  const benchmarks = [];
  for (let i = 0; i < series.length; i++) {
    const item = {
      label: series[i].label,
      colour: LINE_COLOURS[i % LINE_COLOURS.length],
      isBenchmark: series[i].type === "benchmark",
      seriesIndex: i,
      publicId: series[i].publicId || null,
      morningstarId: series[i].morningstarId || null,
      currencyCode: series[i].currencyCode || null,
    };
    if (item.isBenchmark) {
      benchmarks.push(item);
    } else {
      investments.push(item);
    }
  }

  // Split a list of items into chunks of maxPerRow and draw each chunk as a row
  let currentY = y - 12;

  // Pre-calculate extra width for "(FT) (MS)" link tags on investments with both links
  const linkTagSize = FONT_SIZE_LEGEND - 1;
  const ftTagWidth = font.widthOfTextAtSize("(FT)", linkTagSize);
  const msTagWidth = font.widthOfTextAtSize("(MS)", linkTagSize);
  const dualLinkExtra = 2 + ftTagWidth + 2 + msTagWidth;

  // Draw investment rows
  for (let r = 0; r < investments.length; r += maxPerRow) {
    const chunk = investments.slice(r, r + maxPerRow);
    const labels = chunk.map(function (item) { return item.label; });
    const extraWidths = chunk.map(function (item) {
      return (item.publicId && item.morningstarId) ? dualLinkExtra : 0;
    });
    truncateLabelsToFit(font, labels, availableWidth, boxSize, gap, extraWidths);
    drawLegendRow(page, chunk, labels, startX, currentY, fonts);
    currentY -= LEGEND_ROW_HEIGHT;
  }

  // Draw benchmark rows
  for (let b = 0; b < benchmarks.length; b += maxPerRow) {
    const bmChunk = benchmarks.slice(b, b + maxPerRow);
    const bmLabels = bmChunk.map(function (item) { return item.label; });
    truncateLabelsToFit(font, bmLabels, availableWidth, boxSize, gap);
    drawLegendRow(page, bmChunk, bmLabels, startX, currentY, fonts);
    currentY -= LEGEND_ROW_HEIGHT;
  }
}

/**
 * @description Calculate a nice Y-axis range and tick marks based on the data.
 * Ensures 0 is always included since all series are rebased to 0%.
 * @param {Array<Object>} series - Data series with values arrays
 * @returns {Object} Object with min, max, and ticks array
 */
function calculateYRange(series, valueMode) {
  let dataMin = null;
  let dataMax = null;

  for (let s = 0; s < series.length; s++) {
    const vals = series[s].values;
    for (let v = 0; v < vals.length; v++) {
      if (vals[v] === null) continue;
      if (dataMin === null || vals[v] < dataMin) dataMin = vals[v];
      if (dataMax === null || vals[v] > dataMax) dataMax = vals[v];
    }
  }

  // Default to 0-based range if no data
  if (dataMin === null) dataMin = 0;
  if (dataMax === null) dataMax = 0;

  // Add 10% padding above and below
  let range = dataMax - dataMin;
  if (range === 0) range = 10;
  const padding = range * 0.1;
  let min = dataMin - padding;
  let max = dataMax + padding;

  // Choose nice tick interval
  const rawInterval = range / 6;
  const niceInterval = niceNumber(rawInterval);

  // Snap min/max to tick boundaries
  min = Math.floor(min / niceInterval) * niceInterval;
  max = Math.ceil(max / niceInterval) * niceInterval;

  // For percent mode, ensure 0 is included (all series rebase from 0%)
  // For value mode, don't force 0 — values may be far above zero
  if (valueMode !== "value") {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }

  // Generate tick values
  const ticks = [];
  for (let t = min; t <= max + niceInterval * 0.01; t += niceInterval) {
    ticks.push(Math.round(t * 10) / 10);
  }

  return { min: min, max: max, ticks: ticks };
}

/**
 * @description Find a "nice" number close to the given value for axis tick spacing.
 * Returns a value from the set {1, 2, 5, 10, 20, 50, ...}.
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
 * @description Draw the background grid lines (horizontal) and zero line.
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
 * @description Format a GBP value for the Y-axis label.
 * Uses £Xk for thousands and £X.XM for millions.
 * @param {number} value - The GBP value
 * @returns {string} Formatted label like "£150k" or "£1.2M"
 */
function formatGBPAxis(value) {
  const absVal = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absVal >= 1000000) {
    const millions = absVal / 1000000;
    const mStr = millions === Math.floor(millions) ? millions.toFixed(0) : millions.toFixed(1);
    return sign + "£" + mStr + "M";
  }
  if (absVal >= 1000) {
    const thousands = absVal / 1000;
    const kStr = thousands === Math.floor(thousands) ? thousands.toFixed(0) : thousands.toFixed(1);
    return sign + "£" + kStr + "k";
  }
  return sign + "£" + Math.round(absVal);
}

/**
 * @description Draw Y-axis labels on the left side.
 * Shows percentage values by default, or GBP values when valueMode is "value".
 * @param {Object} page - PDFPage instance
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} height - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Array<number>} ticks - Y-axis tick values
 * @param {Object} fonts - Font objects
 * @param {string} [valueMode] - "value" for GBP axis, anything else for percent
 */
function drawYAxis(page, chartLeft, bottom, height, yMin, yMax, ticks, fonts, valueMode) {
  const font = fonts.regular;
  const yRange = yMax - yMin;
  if (yRange === 0) return;

  for (let i = 0; i < ticks.length; i++) {
    const tickVal = ticks[i];
    const py = bottom + ((tickVal - yMin) / yRange) * height;
    let label;
    if (valueMode === "value") {
      label = formatGBPAxis(tickVal);
    } else {
      label = tickVal.toFixed(tickVal === Math.round(tickVal) ? 0 : 1) + "%";
    }
    const textWidth = font.widthOfTextAtSize(label, FONT_SIZE_AXIS);

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
 * Skips labels to avoid clutter based on the number of months shown.
 * @param {Object} page - PDFPage instance
 * @param {Array<string>} sampleDates - All weekly sample dates
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} monthsToShow - Total months displayed
 */
function drawXAxis(page, sampleDates, chartLeft, bottom, chartWidth, monthsToShow, fonts) {
  if (sampleDates.length < 2) return;

  const font = fonts.regular;
  const totalPoints = sampleDates.length;

  // Determine which months to label to keep 12-16 labels max
  let labelEvery = 1;
  if (monthsToShow > 18) labelEvery = 2;
  if (monthsToShow > 30) labelEvery = 3;

  // Find month boundaries — track when the month changes
  let lastMonth = "";
  let monthCount = 0;

  for (let i = 0; i < totalPoints; i++) {
    const dateStr = sampleDates[i];
    const monthKey = dateStr.substring(5, 7) + "/" + dateStr.substring(2, 4); // MM/YY

    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      monthCount++;

      // Apply label skip
      if (monthCount % labelEvery !== 1 && labelEvery > 1) continue;

      const px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
      const textWidth = font.widthOfTextAtSize(monthKey, FONT_SIZE_AXIS);

      // Draw tick mark
      page.drawLine({
        start: { x: px, y: bottom },
        end: { x: px, y: bottom - 4 },
        color: COLOURS.brand200,
        thickness: 0.5,
      });

      // Draw label centred on tick
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
 * Solid lines for investments, dotted lines for benchmarks.
 * @param {Object} page - PDFPage instance
 * @param {Array<number|null>} values - Rebased percentage values
 * @param {Array<string>} dates - Sample dates (same length as values)
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} chartHeight - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Object} colour - RGB colour for the line
 * @param {boolean} isDotted - Whether to draw dotted line (benchmarks)
 * @param {boolean} smooth - Whether to apply Catmull-Rom spline smoothing
 */
function plotLine(page, values, dates, chartLeft, bottom, chartWidth, chartHeight,
  yMin, yMax, colour, isDashed, smooth) {
  const totalPoints = dates.length;
  if (totalPoints < 2) return;

  const yRange = yMax - yMin;
  if (yRange === 0) return;

  // Build array of {x, y} coordinates, skipping nulls
  const rawPoints = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    const px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
    const py = bottom + ((values[i] - yMin) / yRange) * chartHeight;
    rawPoints.push({ x: px, y: py });
  }

  if (rawPoints.length < 2) return;

  // Apply Catmull-Rom smoothing if enabled and enough points
  const points = (smooth && rawPoints.length >= 3) ? catmullRomSmooth(rawPoints, 8) : rawPoints;

  // Draw line segments between consecutive points
  if (isDashed) {
    // Dotted line: walk the entire path and place dots at regular spacing
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

  // Draw small square markers at original data points (only if not too many)
  if (rawPoints.length <= 20) {
    for (let k = 0; k < rawPoints.length; k++) {
      page.drawRectangle({
        x: rawPoints[k].x - 1.5,
        y: rawPoints[k].y - 1.5,
        width: 3,
        height: 3,
        color: colour,
      });
    }
  }
}

/**
 * @description Draw numbered event markers on the chart and optionally a
 * legend row below the X-axis. Each event gets a circled number at its
 * date position on the X-axis, and (unless suppressLegend is true) a
 * numbered legend entry below showing the event description.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} events - Array of {date, description} objects
 * @param {Array<string>} sampleDates - Weekly sample dates for X-axis mapping
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} chartBottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} legendY - Y position for the event legend row
 * @param {boolean} [suppressLegend] - If true, draw only the circled numbers
 *   on the chart without the descriptive legend row below. Used when a shared
 *   legend is drawn separately (e.g. chart groups).
 */
function drawEventMarkers(page, events, sampleDates, chartLeft, chartBottom,
  chartWidth, legendY, suppressLegend, fonts) {
  if (events.length === 0 || sampleDates.length < 2) return;

  const fontBold = fonts.bold;
  const totalPoints = sampleDates.length;
  const firstDate = sampleDates[0];
  const lastDate = sampleDates[totalPoints - 1];
  const markerColour = rgb(0.75, 0.15, 0.15); // dark red for event markers
  const numberSize = 7;
  const circleRadius = 5.5;

  // Draw circled number markers on the chart at the X-axis
  for (let i = 0; i < events.length; i++) {
    const eventDate = events[i].date;
    if (eventDate < firstDate || eventDate > lastDate) continue;

    // Find the X position by interpolating between sample dates
    const px = findDateXPosition(eventDate, sampleDates, chartLeft, chartWidth);
    if (px === null) continue;

    const num = String(i + 1);
    const numWidth = fontBold.widthOfTextAtSize(num, numberSize);
    const centreY = chartBottom - 1;

    // Draw circle outline using short line segments (approximate circle)
    drawCircle(page, px, centreY, circleRadius, markerColour, 0.7);

    // Draw number centred in the circle
    page.drawText(num, {
      x: px - numWidth / 2,
      y: centreY - numberSize / 2 + 1,
      font: fonts.bold,
      size: numberSize,
      color: markerColour,
    });
  }

  // Draw event legend row unless suppressed (chart groups draw a shared legend)
  if (!suppressLegend) {
    drawEventLegendRow(page, events, chartLeft, legendY, fonts);
  }
}

/**
 * @description Draw a circle outline using short line segments.
 * @param {Object} page - PDFPage instance
 * @param {number} cx - Centre X
 * @param {number} cy - Centre Y
 * @param {number} radius - Circle radius
 * @param {Object} colour - RGB colour
 * @param {number} thickness - Line thickness
 */
function drawCircle(page, cx, cy, radius, colour, thickness) {
  const segments = 24;
  for (let seg = 0; seg < segments; seg++) {
    const angle1 = (seg / segments) * 2 * Math.PI;
    const angle2 = ((seg + 1) / segments) * 2 * Math.PI;
    page.drawLine({
      start: { x: cx + Math.cos(angle1) * radius, y: cy + Math.sin(angle1) * radius },
      end: { x: cx + Math.cos(angle2) * radius, y: cy + Math.sin(angle2) * radius },
      color: colour,
      thickness: thickness,
    });
  }
}

/**
 * @description Draw the event legend row — circled numbers with description text.
 * Called by drawEventMarkers for standalone charts, or separately by
 * renderChartGroupBlock for a shared legend below all charts.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} events - Array of {date, description} objects
 * @param {number} startX - Left edge for the legend row
 * @param {number} legendY - Y position for the legend row
 */
function drawEventLegendRow(page, events, startX, legendY, fonts) {
  const font = fonts.regular;
  const fontBold = fonts.bold;
  const markerColour = rgb(0.75, 0.15, 0.15);
  const eventFontSize = 6.5;
  const legendCircleR = 4.5;
  const legendNumSize = 6;
  let legendX = startX;

  for (let j = 0; j < events.length; j++) {
    const legendNum = String(j + 1);
    const legendNumW = fontBold.widthOfTextAtSize(legendNum, legendNumSize);
    const circleCentreX = legendX + legendCircleR;
    const circleCentreY = legendY + 2;

    // Draw small circled number in legend
    drawCircle(page, circleCentreX, circleCentreY, legendCircleR, markerColour, 0.6);

    page.drawText(legendNum, {
      x: circleCentreX - legendNumW / 2,
      y: circleCentreY - legendNumSize / 2 + 1,
      font: fonts.bold,
      size: legendNumSize,
      color: markerColour,
    });

    // Draw description text after the circled number
    legendX += legendCircleR * 2 + 3;
    page.drawText(events[j].description, {
      x: legendX,
      y: legendY,
      font: fonts.regular,
      size: eventFontSize,
      color: markerColour,
    });

    const descWidth = font.widthOfTextAtSize(events[j].description, eventFontSize);
    legendX += descWidth + 12;
  }
}

/**
 * @description Find the X pixel position for a given date by interpolating
 * between the sample dates array.
 * @param {string} targetDate - ISO-8601 date to locate
 * @param {Array<string>} sampleDates - Weekly sample dates
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} chartWidth - Chart area width
 * @returns {number|null} X position in points, or null if out of range
 */
function findDateXPosition(targetDate, sampleDates, chartLeft, chartWidth) {
  const totalPoints = sampleDates.length;
  if (totalPoints < 2) return null;

  // Find the two sample dates that bracket the target date
  for (let i = 0; i < totalPoints - 1; i++) {
    if (sampleDates[i] <= targetDate && sampleDates[i + 1] >= targetDate) {
      // Interpolate within this segment
      if (sampleDates[i] === targetDate) {
        return chartLeft + (i / (totalPoints - 1)) * chartWidth;
      }

      // Calculate fractional position between sample[i] and sample[i+1]
      const d0 = new Date(sampleDates[i]).getTime();
      const d1 = new Date(sampleDates[i + 1]).getTime();
      const dt = new Date(targetDate).getTime();
      const frac = (dt - d0) / (d1 - d0);

      const idx = i + frac;
      return chartLeft + (idx / (totalPoints - 1)) * chartWidth;
    }
  }

  // Check if it matches the last date exactly
  if (targetDate === sampleDates[totalPoints - 1]) {
    return chartLeft + chartWidth;
  }

  return null;
}

/**
 * @description Draw a dotted line along an entire path of points.
 * Walks the full path accumulating distance and places a small filled dot
 * (tiny square) at regular intervals. This avoids the problem of placing
 * dots per-segment which causes dense overlap on smoothed curves.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} points - Array of {x, y} path points
 * @param {Object} colour - RGB colour
 * @param {number} dotSize - Width and height of each dot in points
 * @param {number} spacing - Distance between dot centres in points
 */
function drawDottedPath(page, points, colour, dotSize, spacing) {
  if (points.length < 2) return;

  const halfDot = dotSize / 2;
  let distSinceLastDot = spacing; // start with a dot at the first point

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

      // Step forward by a small increment or the remaining distance to the next dot
      let step = Math.min(spacing - distSinceLastDot, segLen - pos);
      if (step < 0.1) step = 0.1;
      pos += step;
      distSinceLastDot += step;
    }
  }
}

/**
 * @description Generate a smooth curve through data points using Catmull-Rom
 * spline interpolation. The curve passes through every original data point
 * with smooth transitions between them. Each segment between two original
 * points is subdivided into `subdivisions` intermediate points.
 * @param {Array<Object>} points - Original data points [{x, y}, ...]
 * @param {number} subdivisions - Number of intermediate points per segment
 * @returns {Array<Object>} Smoothed array of points
 */
function catmullRomSmooth(points, subdivisions) {
  const result = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    // Four control points: p0, p1, p2, p3
    // Clamp to first/last point at the edges
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, n - 1)];

    // Always include the start of this segment
    result.push(p1);

    // Interpolate intermediate points
    for (let s = 1; s < subdivisions; s++) {
      const t = s / subdivisions;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom basis matrix coefficients
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );

      result.push({ x: x, y: y });
    }
  }

  // Include the final point
  result.push(points[n - 1]);

  return result;
}

/**
 * @description Determine the page orientation for a chart group based on
 * the number of charts. 1 chart → landscape, 2 charts → portrait,
 * 3-4 charts → landscape (2x2 grid).
 * @param {Object} blockDef - Block definition with charts array
 * @returns {{ orientation: string, pageHeight: number, usableWidth: number }}
 */
export function getChartGroupLayout(blockDef) {
  const count = (blockDef.charts || []).length;
  if (count === 2) {
    return { orientation: "portrait", pageHeight: A4_PORTRAIT_HEIGHT, usableWidth: A4_PORTRAIT_USABLE_WIDTH };
  }
  return { orientation: "landscape", pageHeight: A4_LANDSCAPE_HEIGHT, usableWidth: USABLE_WIDTH };
}

/**
 * @description Render a group of 1-4 charts on a single page.
 * Layout depends on the number of charts:
 *   1 chart  → full landscape page
 *   2 charts → portrait, stacked vertically
 *   3-4 charts → landscape, 2×2 grid
 * @param {Object} ctx - Shared rendering context
 * @param {Array<string>} params - Unused (charts carry their own params)
 * @param {Object} blockDef - Block definition with charts array
 */
export function renderChartGroupBlock(ctx, params, blockDef) {
  const charts = blockDef.charts || [];
  if (charts.length === 0) return;

  const page = ctx.page;
  const startY = ctx.y;
  const count = Math.min(charts.length, 4);
  // Tighter gap for grid layouts (3-4 charts) to maximise chart area
  const gap = count <= 2 ? 20 : 14;

  if (count === 1) {
    // Single chart — render full page, no bounds needed
    renderChartBlock(ctx, charts[0].params || [], charts[0]);
    return;
  }

  if (count === 2) {
    // Portrait — two charts stacked vertically.
    // Check if any sub-chart requests global events. If so, reserve space
    // at the bottom of the page for a single shared event legend and pass
    // showGlobalEvents + _suppressEventLegend to each sub-chart so they
    // draw circled markers but not individual legend rows.
    const showGroupEvents = blockDef.showGlobalEvents === true ||
      charts.some(function (c) { return c.showGlobalEvents === true; });
    const eventLegendHeight = showGroupEvents ? 24 : 0;
    const availableHeight = startY - MARGIN_BOTTOM - eventLegendHeight;
    const cellHeight = (availableHeight - gap) / 2;

    // Chart 1 — top half
    ctx.y = startY;
    ctx._events = null;
    renderChartBlock(ctx, charts[0].params || [], Object.assign({}, charts[0], {
      showGlobalEvents: showGroupEvents,
      _suppressEventLegend: showGroupEvents,
      _bounds: { left: MARGIN_LEFT, width: A4_PORTRAIT_USABLE_WIDTH, bottom: startY - cellHeight },
    }));
    let collectedEvents = ctx._events;

    // Chart 2 — bottom half
    ctx.y = startY - cellHeight - gap;
    ctx.page = page;
    ctx._events = null;
    renderChartBlock(ctx, charts[1].params || [], Object.assign({}, charts[1], {
      showGlobalEvents: showGroupEvents,
      _suppressEventLegend: showGroupEvents,
      _bounds: { left: MARGIN_LEFT, width: A4_PORTRAIT_USABLE_WIDTH, bottom: MARGIN_BOTTOM + eventLegendHeight },
    }));
    // Use events from whichever chart had data (prefer first, fall back to second)
    if (!collectedEvents && ctx._events) {
      collectedEvents = ctx._events;
    }

    // Draw shared event legend at the bottom of the page
    if (showGroupEvents && collectedEvents && collectedEvents.length > 0) {
      drawEventLegendRow(page, collectedEvents, MARGIN_LEFT + Y_AXIS_WIDTH, MARGIN_BOTTOM + 4, ctx.fonts);
    }

    ctx.y = MARGIN_BOTTOM;
    ctx._events = null;
    return;
  }

  // 3-4 charts — landscape 2×2 grid.
  // Check for global events — same pattern as the 2-chart case.
  const showGridEvents = blockDef.showGlobalEvents === true ||
    charts.some(function (c) { return c.showGlobalEvents === true; });
  const gridEventHeight = showGridEvents ? 24 : 0;
  const availH = startY - MARGIN_BOTTOM - gridEventHeight;
  const cellW = (USABLE_WIDTH - gap) / 2;
  const cellH = (availH - gap) / 2;

  // Bottom row sits above the shared event legend area
  const bottomRowBase = MARGIN_BOTTOM + gridEventHeight;

  const positions = [
    { left: MARGIN_LEFT, top: startY, bottom: startY - cellH },
    { left: MARGIN_LEFT + cellW + gap, top: startY, bottom: startY - cellH },
    { left: MARGIN_LEFT, top: startY - cellH - gap, bottom: bottomRowBase },
    { left: MARGIN_LEFT + cellW + gap, top: startY - cellH - gap, bottom: bottomRowBase },
  ];

  let gridCollectedEvents = null;
  for (let i = 0; i < count; i++) {
    const pos = positions[i];
    ctx.y = pos.top;
    ctx.page = page;
    ctx._events = null;
    renderChartBlock(ctx, charts[i].params || [], Object.assign({}, charts[i], {
      showGlobalEvents: showGridEvents,
      _suppressEventLegend: showGridEvents,
      _bounds: { left: pos.left, width: cellW, bottom: pos.bottom },
    }));
    if (!gridCollectedEvents && ctx._events) {
      gridCollectedEvents = ctx._events;
    }
  }

  // Draw shared event legend at the bottom of the page
  if (showGridEvents && gridCollectedEvents && gridCollectedEvents.length > 0) {
    drawEventLegendRow(page, gridCollectedEvents, MARGIN_LEFT + Y_AXIS_WIDTH, MARGIN_BOTTOM + 4, ctx.fonts);
  }

  ctx.y = MARGIN_BOTTOM;
  ctx._events = null;
}

/**
 * @description Generate a standalone PDF for a single performance chart.
 * Creates a landscape A4 PDF with the chart rendered full-page.
 * @param {Object} chartDef - Chart definition from user-reports.json
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generateChartPdf(chartDef) {
  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const page = pdf.addPage({ size: "a4", orientation: "landscape" });
  const pages = [page];
  const y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP, fonts);

  const ctx = { pdf: pdf, page: page, pages: pages, y: y, pageWidths: [USABLE_WIDTH], fonts: fonts };
  renderChartBlock(ctx, chartDef.params || [], chartDef);

  drawPageFooters(ctx.pages, chartDef.title || "Performance Chart", MARGIN_LEFT, USABLE_WIDTH, fonts);
  return await pdf.save();
}

/**
 * @description Generate a standalone PDF for a chart group (1-4 charts on one page).
 * Determines orientation based on chart count and renders all charts.
 * @param {Object} groupDef - Chart group definition from user-reports.json
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generateChartGroupPdf(groupDef) {
  const layout = getChartGroupLayout(groupDef);
  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const page = pdf.addPage({ size: "a4", orientation: layout.orientation });
  const pages = [page];
  const y = drawPageHeader(pdf, page, MARGIN_LEFT, layout.pageHeight, MARGIN_TOP, fonts);

  const ctx = { pdf: pdf, page: page, pages: pages, y: y, pageWidths: [layout.usableWidth], fonts: fonts };
  renderChartGroupBlock(ctx, [], groupDef);

  drawPageFooters(ctx.pages, groupDef.title || "Performance Charts", MARGIN_LEFT, layout.usableWidth, fonts);
  return await pdf.save();
}
