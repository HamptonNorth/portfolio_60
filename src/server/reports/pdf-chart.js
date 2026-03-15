import { PDF, rgb, StandardFonts, Standard14Font } from "@libpdf/core";
import { getChartData } from "../services/chart-data-service.js";
import { isTestMode } from "../test-mode.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";

/**
 * @description A4 landscape page dimensions in points.
 * Charts default to landscape for maximum plot width.
 */
const A4_LANDSCAPE_WIDTH = 841.89;
const A4_LANDSCAPE_HEIGHT = 595.28;
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const USABLE_WIDTH = A4_LANDSCAPE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

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
 * @description Render a performance comparison chart into a shared PDF context.
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
export function renderChartBlock(ctx, params, blockDef) {
  var pdf = ctx.pdf;
  var page = ctx.page;
  var y = ctx.y;

  // Build chart definition from blockDef + params
  var chartDef = {
    title: (blockDef && blockDef.title) || "Performance Chart",
    subTitle: (blockDef && blockDef.subTitle) || "",
    fromMonthsAgo: (blockDef && blockDef.fromMonthsAgo) || "0",
    monthsToShow: (blockDef && blockDef.monthsToShow) || "12",
    smooth: blockDef && blockDef.smooth === true,
    showGlobalEvents: blockDef && blockDef.showGlobalEvents === true,
    params: params,
  };

  var data = getChartData(chartDef);

  if (!data.series || data.series.length === 0) {
    page.drawText(chartDef.title + " \u2014 no data available.", {
      x: MARGIN_LEFT,
      y: y - 14,
      font: StandardFonts.Helvetica,
      size: 14,
      color: COLOURS.brand800,
    });
    ctx.y = y - 30;
    return;
  }

  // Calculate chart area
  var chartLeft = MARGIN_LEFT + Y_AXIS_WIDTH;
  var chartRight = MARGIN_LEFT + USABLE_WIDTH - CHART_RIGHT_PAD;
  var chartWidth = chartRight - chartLeft;

  // Reserve extra space below X-axis for event legend when events are present
  var hasEvents = data.events && data.events.length > 0;
  var eventAreaHeight = hasEvents ? 24 : 0;

  // Determine legend row count before calculating chart area
  var legendRows = calculateLegendRows(data.series);
  var legendHeight = legendRows * LEGEND_ROW_HEIGHT + LEGEND_PADDING;

  var chartTop = y - TITLE_BAR_HEIGHT - SUBTITLE_HEIGHT - legendHeight;
  var chartBottom = MARGIN_BOTTOM + X_AXIS_HEIGHT + eventAreaHeight + 20; // 20pt for footer clearance
  var chartHeight = chartTop - chartBottom;

  if (chartHeight < 100) {
    // Not enough space — should not happen on a fresh page but just in case
    ctx.y = y;
    return;
  }

  // --- Title bar (white text on coloured rectangle — emerald in test mode) ---
  var titleBarColour = isTestMode() ? COLOURS.emerald900 : COLOURS.brand800;
  page.drawRectangle({
    x: MARGIN_LEFT,
    y: y - TITLE_BAR_HEIGHT,
    width: USABLE_WIDTH,
    height: TITLE_BAR_HEIGHT,
    color: titleBarColour,
  });
  page.drawText(data.title, {
    x: MARGIN_LEFT + 10,
    y: y - TITLE_BAR_HEIGHT + 9,
    font: StandardFonts.HelveticaBold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.white,
  });
  y -= TITLE_BAR_HEIGHT;

  // --- Subtitle ---
  if (data.subTitle) {
    page.drawText(data.subTitle, {
      x: MARGIN_LEFT + 10,
      y: y - SUBTITLE_HEIGHT + 4,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_SUBTITLE,
      color: COLOURS.brand600,
    });
  }
  y -= SUBTITLE_HEIGHT;

  // --- Legend ---
  drawLegend(page, data.series, MARGIN_LEFT + Y_AXIS_WIDTH, y, chartWidth);
  y -= legendHeight;

  // --- Determine Y-axis range ---
  var yRange = calculateYRange(data.series);
  var yMin = yRange.min;
  var yMax = yRange.max;
  var yTicks = yRange.ticks;

  // --- Draw grid and axes ---
  drawGrid(page, chartLeft, chartBottom, chartWidth, chartHeight, yMin, yMax, yTicks);
  drawYAxis(page, chartLeft, chartBottom, chartHeight, yMin, yMax, yTicks);
  drawXAxis(page, data.sampleDates, chartLeft, chartBottom, chartWidth, data.monthsToShow);

  // --- Plot data lines ---
  for (var s = 0; s < data.series.length; s++) {
    var series = data.series[s];
    var colour = LINE_COLOURS[s % LINE_COLOURS.length];
    var isDashed = series.type === "benchmark";

    plotLine(page, series.values, data.sampleDates, chartLeft, chartBottom,
      chartWidth, chartHeight, yMin, yMax, colour, isDashed, chartDef.smooth);
  }

  // --- Draw global event markers ---
  if (hasEvents) {
    drawEventMarkers(page, data.events, data.sampleDates, chartLeft, chartBottom,
      chartWidth, chartBottom - X_AXIS_HEIGHT - 4);
  }

  // Update ctx.y to below the chart
  ctx.y = chartBottom - X_AXIS_HEIGHT - eventAreaHeight - 10;
  ctx.page = page;
}

/**
 * @description Calculate the number of legend rows needed.
 * Benchmarks always go on a separate row from investments.
 * If there are only investments and 4 or fewer, use a single row.
 * @param {Array<Object>} series - Data series with label and type
 * @returns {number} Number of legend rows (1 or 2)
 */
function calculateLegendRows(series) {
  var hasBenchmarks = series.some(function (s) { return s.type === "benchmark"; });
  if (hasBenchmarks) return 2;
  if (series.length > 4) return 2;
  return 1;
}

/**
 * @description Measure the total width of a row of legend items.
 * @param {Object} font - Standard14Font instance for text measurement
 * @param {Array<string>} labels - Display labels for each item
 * @param {number} boxSize - Width of the colour indicator
 * @param {number} gap - Gap between items
 * @returns {number} Total width in points
 */
function measureLegendRow(font, labels, boxSize, gap) {
  var width = 0;
  for (var i = 0; i < labels.length; i++) {
    width += boxSize + 3 + font.widthOfTextAtSize(labels[i], FONT_SIZE_LEGEND);
    if (i < labels.length - 1) width += gap;
  }
  return width;
}

/**
 * @description Truncate labels evenly until the row fits within the available
 * width. Removes characters from the end of each label and adds an ellipsis.
 * @param {Object} font - Standard14Font instance for text measurement
 * @param {Array<string>} labels - Labels to truncate (modified in place)
 * @param {number} availableWidth - Maximum row width in points
 * @param {number} boxSize - Width of the colour indicator
 * @param {number} gap - Gap between items
 */
function truncateLabelsToFit(font, labels, availableWidth, boxSize, gap) {
  var maxChars = Math.max.apply(null, labels.map(function (l) { return l.length; }));

  // Progressively shorten all labels until row fits
  while (maxChars > 5) {
    var totalWidth = measureLegendRow(font, labels, boxSize, gap);
    if (totalWidth <= availableWidth) return;

    maxChars -= 1;
    for (var i = 0; i < labels.length; i++) {
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
function drawLegendRow(page, items, displayLabels, startX, legendY) {
  var boxSize = 8;
  var gap = 14;
  var x = startX;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var label = displayLabels[i];

    if (item.isBenchmark) {
      // Dotted line indicator for benchmarks
      var dotY = legendY + boxSize / 2 - 1;
      for (var d = 0; d < 3; d++) {
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
    page.drawText(label, {
      x: x,
      y: legendY + 1,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_LEGEND,
      color: COLOURS.brand800,
    });

    var font = Standard14Font.of(StandardFonts.Helvetica);
    var textWidth = font.widthOfTextAtSize(label, FONT_SIZE_LEGEND);
    x += textWidth + gap;
  }
}

/**
 * @description Draw the legend showing coloured squares/lines and series labels.
 * Investments are drawn on row 1, benchmarks on row 2. If all series are
 * investments and there are 4 or fewer, a single row is used. Labels are
 * truncated with ellipsis if a row would overflow the available width.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} series - Data series with label and type
 * @param {number} startX - Left edge of legend area
 * @param {number} y - Y position for the first legend row
 * @param {number} availableWidth - Maximum width for legend content
 */
function drawLegend(page, series, startX, y, availableWidth) {
  var font = Standard14Font.of(StandardFonts.Helvetica);
  var boxSize = 8;
  var gap = 14;
  var rowCount = calculateLegendRows(series);

  // Split series into investments and benchmarks, preserving original colour index
  var investments = [];
  var benchmarks = [];
  for (var i = 0; i < series.length; i++) {
    var item = {
      label: series[i].label,
      colour: LINE_COLOURS[i % LINE_COLOURS.length],
      isBenchmark: series[i].type === "benchmark",
      seriesIndex: i,
    };
    if (item.isBenchmark) {
      benchmarks.push(item);
    } else {
      investments.push(item);
    }
  }

  if (rowCount === 1) {
    // Single row — all investments (no benchmarks, <= 4 items)
    var labels = investments.map(function (item) { return item.label; });
    truncateLabelsToFit(font, labels, availableWidth, boxSize, gap);
    drawLegendRow(page, investments, labels, startX, y - 12);
  } else {
    // Two rows — investments on row 1, benchmarks on row 2
    var invLabels = investments.map(function (item) { return item.label; });
    truncateLabelsToFit(font, invLabels, availableWidth, boxSize, gap);
    drawLegendRow(page, investments, invLabels, startX, y - 12);

    if (benchmarks.length > 0) {
      var bmLabels = benchmarks.map(function (item) { return item.label; });
      truncateLabelsToFit(font, bmLabels, availableWidth, boxSize, gap);
      drawLegendRow(page, benchmarks, bmLabels, startX, y - 12 - LEGEND_ROW_HEIGHT);
    }
  }
}

/**
 * @description Calculate a nice Y-axis range and tick marks based on the data.
 * Ensures 0 is always included since all series are rebased to 0%.
 * @param {Array<Object>} series - Data series with values arrays
 * @returns {Object} Object with min, max, and ticks array
 */
function calculateYRange(series) {
  var dataMin = 0;
  var dataMax = 0;

  for (var s = 0; s < series.length; s++) {
    var vals = series[s].values;
    for (var v = 0; v < vals.length; v++) {
      if (vals[v] === null) continue;
      if (vals[v] < dataMin) dataMin = vals[v];
      if (vals[v] > dataMax) dataMax = vals[v];
    }
  }

  // Add 10% padding above and below
  var range = dataMax - dataMin;
  if (range === 0) range = 10;
  var padding = range * 0.1;
  var min = dataMin - padding;
  var max = dataMax + padding;

  // Choose nice tick interval
  var rawInterval = range / 6;
  var niceInterval = niceNumber(rawInterval);

  // Snap min/max to tick boundaries
  min = Math.floor(min / niceInterval) * niceInterval;
  max = Math.ceil(max / niceInterval) * niceInterval;

  // Ensure 0 is included
  if (min > 0) min = 0;
  if (max < 0) max = 0;

  // Generate tick values
  var ticks = [];
  for (var t = min; t <= max + niceInterval * 0.01; t += niceInterval) {
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
  var exponent = Math.floor(Math.log10(value));
  var fraction = value / Math.pow(10, exponent);
  var nice;
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
  var yRange = yMax - yMin;
  if (yRange === 0) return;

  for (var i = 0; i < ticks.length; i++) {
    var tickVal = ticks[i];
    var py = bottom + ((tickVal - yMin) / yRange) * height;
    var isZero = Math.abs(tickVal) < 0.01;

    page.drawLine({
      start: { x: left, y: py },
      end: { x: left + width, y: py },
      color: isZero ? COLOURS.zeroLine : COLOURS.gridLine,
      thickness: isZero ? 0.8 : 0.3,
    });
  }
}

/**
 * @description Draw Y-axis labels (percentage values) on the left side.
 * @param {Object} page - PDFPage instance
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} bottom - Bottom edge of chart area
 * @param {number} height - Chart area height
 * @param {number} yMin - Y-axis minimum value
 * @param {number} yMax - Y-axis maximum value
 * @param {Array<number>} ticks - Y-axis tick values
 */
function drawYAxis(page, chartLeft, bottom, height, yMin, yMax, ticks) {
  var font = Standard14Font.of(StandardFonts.Helvetica);
  var yRange = yMax - yMin;
  if (yRange === 0) return;

  for (var i = 0; i < ticks.length; i++) {
    var tickVal = ticks[i];
    var py = bottom + ((tickVal - yMin) / yRange) * height;
    var label = tickVal.toFixed(tickVal === Math.round(tickVal) ? 0 : 1) + "%";
    var textWidth = font.widthOfTextAtSize(label, FONT_SIZE_AXIS);

    page.drawText(label, {
      x: chartLeft - textWidth - 4,
      y: py - 3,
      font: StandardFonts.Helvetica,
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
function drawXAxis(page, sampleDates, chartLeft, bottom, chartWidth, monthsToShow) {
  if (sampleDates.length < 2) return;

  var font = Standard14Font.of(StandardFonts.Helvetica);
  var totalPoints = sampleDates.length;

  // Determine which months to label to keep 12-16 labels max
  var labelEvery = 1;
  if (monthsToShow > 18) labelEvery = 2;
  if (monthsToShow > 30) labelEvery = 3;

  // Find month boundaries — track when the month changes
  var lastMonth = "";
  var monthCount = 0;

  for (var i = 0; i < totalPoints; i++) {
    var dateStr = sampleDates[i];
    var monthKey = dateStr.substring(5, 7) + "/" + dateStr.substring(2, 4); // MM/YY

    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      monthCount++;

      // Apply label skip
      if (monthCount % labelEvery !== 1 && labelEvery > 1) continue;

      var px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
      var textWidth = font.widthOfTextAtSize(monthKey, FONT_SIZE_AXIS);

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
        font: StandardFonts.Helvetica,
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
  var totalPoints = dates.length;
  if (totalPoints < 2) return;

  var yRange = yMax - yMin;
  if (yRange === 0) return;

  // Build array of {x, y} coordinates, skipping nulls
  var rawPoints = [];
  for (var i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    var px = chartLeft + (i / (totalPoints - 1)) * chartWidth;
    var py = bottom + ((values[i] - yMin) / yRange) * chartHeight;
    rawPoints.push({ x: px, y: py });
  }

  if (rawPoints.length < 2) return;

  // Apply Catmull-Rom smoothing if enabled and enough points
  var points = (smooth && rawPoints.length >= 3) ? catmullRomSmooth(rawPoints, 8) : rawPoints;

  // Draw line segments between consecutive points
  if (isDashed) {
    // Dotted line: walk the entire path and place dots at regular spacing
    drawDottedPath(page, points, colour, 1.2, 4);
  } else {
    for (var j = 0; j < points.length - 1; j++) {
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
    for (var k = 0; k < rawPoints.length; k++) {
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
 * @description Draw numbered event markers on the chart and a legend row below
 * the X-axis labels. Each event gets a small vertical arrow at its date position
 * with a number, and a numbered legend entry below showing the first 15 chars
 * of the event description.
 * @param {Object} page - PDFPage instance
 * @param {Array<Object>} events - Array of {date, description} objects
 * @param {Array<string>} sampleDates - Weekly sample dates for X-axis mapping
 * @param {number} chartLeft - Left edge of chart area
 * @param {number} chartBottom - Bottom edge of chart area
 * @param {number} chartWidth - Chart area width
 * @param {number} legendY - Y position for the event legend row
 */
function drawEventMarkers(page, events, sampleDates, chartLeft, chartBottom,
  chartWidth, legendY) {
  if (events.length === 0 || sampleDates.length < 2) return;

  var font = Standard14Font.of(StandardFonts.Helvetica);
  var fontBold = Standard14Font.of(StandardFonts.HelveticaBold);
  var totalPoints = sampleDates.length;
  var firstDate = sampleDates[0];
  var lastDate = sampleDates[totalPoints - 1];
  var markerColour = rgb(0.75, 0.15, 0.15); // dark red for event markers
  var numberSize = 7;
  var circleRadius = 5.5;

  // Draw circled number markers on the chart at the X-axis
  for (var i = 0; i < events.length; i++) {
    var eventDate = events[i].date;
    if (eventDate < firstDate || eventDate > lastDate) continue;

    // Find the X position by interpolating between sample dates
    var px = findDateXPosition(eventDate, sampleDates, chartLeft, chartWidth);
    if (px === null) continue;

    var num = String(i + 1);
    var numWidth = fontBold.widthOfTextAtSize(num, numberSize);
    var centreY = chartBottom - 1;

    // Draw circle outline using short line segments (approximate circle)
    var segments = 24;
    for (var seg = 0; seg < segments; seg++) {
      var angle1 = (seg / segments) * 2 * Math.PI;
      var angle2 = ((seg + 1) / segments) * 2 * Math.PI;
      page.drawLine({
        start: {
          x: px + Math.cos(angle1) * circleRadius,
          y: centreY + Math.sin(angle1) * circleRadius,
        },
        end: {
          x: px + Math.cos(angle2) * circleRadius,
          y: centreY + Math.sin(angle2) * circleRadius,
        },
        color: markerColour,
        thickness: 0.7,
      });
    }

    // Draw number centred in the circle
    page.drawText(num, {
      x: px - numWidth / 2,
      y: centreY - numberSize / 2 + 1,
      font: StandardFonts.HelveticaBold,
      size: numberSize,
      color: markerColour,
    });
  }

  // Draw event legend row below X-axis labels with matching circled numbers
  var legendX = chartLeft;
  var eventFontSize = 6.5;
  var legendCircleR = 4.5;
  var legendNumSize = 6;

  for (var j = 0; j < events.length; j++) {
    var legendNum = String(j + 1);
    var legendNumW = fontBold.widthOfTextAtSize(legendNum, legendNumSize);
    var circleCentreX = legendX + legendCircleR;
    var circleCentreY = legendY + 2;

    // Draw small circled number in legend
    for (var ls = 0; ls < 24; ls++) {
      var la1 = (ls / 24) * 2 * Math.PI;
      var la2 = ((ls + 1) / 24) * 2 * Math.PI;
      page.drawLine({
        start: {
          x: circleCentreX + Math.cos(la1) * legendCircleR,
          y: circleCentreY + Math.sin(la1) * legendCircleR,
        },
        end: {
          x: circleCentreX + Math.cos(la2) * legendCircleR,
          y: circleCentreY + Math.sin(la2) * legendCircleR,
        },
        color: markerColour,
        thickness: 0.6,
      });
    }

    page.drawText(legendNum, {
      x: circleCentreX - legendNumW / 2,
      y: circleCentreY - legendNumSize / 2 + 1,
      font: StandardFonts.HelveticaBold,
      size: legendNumSize,
      color: markerColour,
    });

    // Draw description text after the circled number
    legendX += legendCircleR * 2 + 3;
    page.drawText(events[j].description, {
      x: legendX,
      y: legendY,
      font: StandardFonts.Helvetica,
      size: eventFontSize,
      color: markerColour,
    });

    var descWidth = font.widthOfTextAtSize(events[j].description, eventFontSize);
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
  var totalPoints = sampleDates.length;
  if (totalPoints < 2) return null;

  // Find the two sample dates that bracket the target date
  for (var i = 0; i < totalPoints - 1; i++) {
    if (sampleDates[i] <= targetDate && sampleDates[i + 1] >= targetDate) {
      // Interpolate within this segment
      if (sampleDates[i] === targetDate) {
        return chartLeft + (i / (totalPoints - 1)) * chartWidth;
      }

      // Calculate fractional position between sample[i] and sample[i+1]
      var d0 = new Date(sampleDates[i]).getTime();
      var d1 = new Date(sampleDates[i + 1]).getTime();
      var dt = new Date(targetDate).getTime();
      var frac = (dt - d0) / (d1 - d0);

      var idx = i + frac;
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

  var halfDot = dotSize / 2;
  var distSinceLastDot = spacing; // start with a dot at the first point

  for (var i = 0; i < points.length - 1; i++) {
    var dx = points[i + 1].x - points[i].x;
    var dy = points[i + 1].y - points[i].y;
    var segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen < 0.1) continue;

    var unitX = dx / segLen;
    var unitY = dy / segLen;
    var pos = 0;

    while (pos <= segLen) {
      if (distSinceLastDot >= spacing) {
        var cx = points[i].x + unitX * pos;
        var cy = points[i].y + unitY * pos;

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
      var step = Math.min(spacing - distSinceLastDot, segLen - pos);
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
  var result = [];
  var n = points.length;

  for (var i = 0; i < n - 1; i++) {
    // Four control points: p0, p1, p2, p3
    // Clamp to first/last point at the edges
    var p0 = points[Math.max(i - 1, 0)];
    var p1 = points[i];
    var p2 = points[i + 1];
    var p3 = points[Math.min(i + 2, n - 1)];

    // Always include the start of this segment
    result.push(p1);

    // Interpolate intermediate points
    for (var s = 1; s < subdivisions; s++) {
      var t = s / subdivisions;
      var t2 = t * t;
      var t3 = t2 * t;

      // Catmull-Rom basis matrix coefficients
      var x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );
      var y = 0.5 * (
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
 * @description Generate a standalone PDF for a single performance chart.
 * Creates a landscape A4 PDF with the chart rendered full-page.
 * @param {Object} chartDef - Chart definition from user-reports.json
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generateChartPdf(chartDef) {
  const pdf = PDF.create();
  var page = pdf.addPage({ size: "a4", orientation: "landscape" });
  var pages = [page];
  var y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP);

  var ctx = { pdf: pdf, page: page, pages: pages, y: y, pageWidths: [USABLE_WIDTH] };
  renderChartBlock(ctx, chartDef.params || [], chartDef);

  drawPageFooters(ctx.pages, chartDef.title || "Performance Chart", MARGIN_LEFT, USABLE_WIDTH);
  return await pdf.save();
}
