import { PDF, rgb } from "@libpdf/core";
import { getHouseholdAssetsSummary } from "../db/other-assets-db.js";
import { isTestMode } from "../test-mode.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";
import { embedRobotoFonts } from "./pdf-fonts.js";

/**
 * @description Frequency display labels matching the HTML report block.
 * @type {Object<string, string>}
 */
const FREQUENCY_LABELS = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  "4_weeks": "4 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "6_monthly": "6 Monthly",
  annually: "Annually",
};

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
 * @description Column definitions for the household assets table.
 * x is relative to MARGIN_LEFT, width in points.
 * @type {Array<{key: string, label: string, x: number, width: number, align: string}>}
 */
const COLUMNS = [
  { key: "user", label: "User", x: 0, width: 40, align: "left" },
  { key: "description", label: "Description", x: 40, width: 140, align: "left" },
  { key: "value", label: "Value", x: 180, width: 60, align: "right" },
  { key: "every", label: "Every", x: 240, width: 60, align: "left" },
  { key: "edited", label: "Edited", x: 300, width: 60, align: "left" },
  { key: "notes", label: "Notes", x: 360, width: USABLE_WIDTH - 360, align: "left" },
];

/** @description Font sizes used in the report */
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_CATEGORY = 10;
const FONT_SIZE_HEADER = 7;
const FONT_SIZE_ROW = 7;
const FONT_SIZE_SUMMARY_LABEL = 9;
const FONT_SIZE_SUMMARY_VALUE = 9;
const FONT_SIZE_FOOTER = 6;

/** @description Row heights in points */
const ROW_HEIGHT = 14;
const HEADER_ROW_HEIGHT = 16;
const CATEGORY_GAP = 18;

/**
 * @description Format a scaled integer (x 10000) as a whole-pounds string
 * with thousand separators. No currency symbol.
 * @param {number} scaledValue - The value x 10000
 * @returns {string} Formatted string like "1,234"
 */
function formatGBP(scaledValue) {
  const amount = scaledValue / 10000;
  if (amount === 0) return "0";
  return Math.round(amount).toLocaleString("en-GB");
}

/**
 * @description Format an ISO-8601 date string as DD/MM/YYYY.
 * @param {string} dateStr - ISO-8601 date string
 * @returns {string} Formatted date string
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

/**
 * @description Get user display name — "Joint" for Joint user, initials otherwise.
 * @param {Object} item - Asset item with user_first_name and user_initials
 * @returns {string} Display name
 */
function getUserDisplay(item) {
  if (item.user_first_name === "Joint") return "Joint";
  return item.user_initials || "";
}

/**
 * @description Draw text right-aligned within a column.
 * @param {Object} page - PDFPage instance
 * @param {string} text - The text to draw
 * @param {number} x - Left edge of column (absolute)
 * @param {number} colWidth - Column width in points
 * @param {number} y - Y position (baseline)
 * @param {Object} font - Embedded font instance
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
 * @param {Object} font - Embedded font instance
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
 * @description Render the Household Assets block into a shared PDF context.
 * Draws the block title, category tables, and summary section.
 * Does not add footers — the caller is responsible for that.
 * @param {Object} ctx - Shared rendering context
 * @param {Object} ctx.pdf - The PDF document
 * @param {Object} ctx.page - Current page (updated in place on ctx)
 * @param {Array<Object>} ctx.pages - Array of all pages (pushed to when new pages added)
 * @param {number} ctx.y - Current y position (updated in place on ctx)
 * @param {Array<number>} ctx.pageWidths - Per-page usable widths (pushed to when new pages added)
 */
export function renderHouseholdAssetsBlock(ctx) {
  const pdf = ctx.pdf;
  let page = ctx.page;
  const pages = ctx.pages;
  let y = ctx.y;
  const fonts = ctx.fonts;

  const data = getHouseholdAssetsSummary();
  const categoryOrder = ["pension", "property", "savings", "alternative"];
  const activeCats = categoryOrder.filter(function (key) {
    const cat = data.categories[key];
    return cat && cat.items.length > 0;
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

  // --- Report title ---
  page.drawText("Household Assets", {
    x: MARGIN_LEFT,
    y: y - FONT_SIZE_TITLE,
    font: fonts.bold,
    size: FONT_SIZE_TITLE,
    color: COLOURS.brand800,
  });
  y -= FONT_SIZE_TITLE + 12;

  // --- Render each category ---
  for (const catKey of activeCats) {
    const cat = data.categories[catKey];

    // Space needed: category title + header row + at least one data row
    ensureSpace(CATEGORY_GAP + HEADER_ROW_HEIGHT + ROW_HEIGHT + 4);

    // Category title
    page.drawText(cat.label, {
      x: MARGIN_LEFT,
      y: y - FONT_SIZE_CATEGORY,
      font: fonts.bold,
      size: FONT_SIZE_CATEGORY,
      color: COLOURS.brand800,
    });
    y -= FONT_SIZE_CATEGORY + 6;

    // Header row background (green in test mode)
    page.drawRectangle({
      x: MARGIN_LEFT,
      y: y - HEADER_ROW_HEIGHT,
      width: USABLE_WIDTH,
      height: HEADER_ROW_HEIGHT,
      color: headerRowColour,
    });

    // Header row text
    for (const col of COLUMNS) {
      const textX = MARGIN_LEFT + col.x + 2;
      if (col.align === "right") {
        drawRightAligned(
          page,
          col.label,
          MARGIN_LEFT + col.x,
          col.width,
          y - HEADER_ROW_HEIGHT + 5,
          fonts.bold,
          FONT_SIZE_HEADER,
          COLOURS.brand700,
        );
      } else {
        page.drawText(col.label, {
          x: textX,
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

    // Data rows
    for (let i = 0; i < cat.items.length; i++) {
      ensureSpace(ROW_HEIGHT + 2);

      const item = cat.items[i];
      const rowY = y - ROW_HEIGHT;
      const textY = rowY + 4;
      const font = fonts.medium;

      // Row values
      const cellValues = {
        user: getUserDisplay(item),
        description: item.description || "",
        value: formatGBP(item.value),
        every: item.frequency ? (FREQUENCY_LABELS[item.frequency] || item.frequency) : "",
        edited: formatDate(item.last_updated),
        notes: (item.notes || "") + (item.executor_reference ? " [" + item.executor_reference + "]" : ""),
      };

      for (const col of COLUMNS) {
        let cellText = cellValues[col.key] || "";
        // Truncate to fit column width (with 4pt padding)
        cellText = truncateText(cellText, font, FONT_SIZE_ROW, col.width - 4);

        if (col.align === "right") {
          drawRightAligned(
            page,
            cellText,
            MARGIN_LEFT + col.x,
            col.width,
            textY,
            font,
            FONT_SIZE_ROW,
            COLOURS.black,
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

    y -= 4; // gap after category table
  }

  // --- Summary section ---
  ensureSpace(60);

  // Summary separator line
  page.drawLine({
    start: { x: MARGIN_LEFT, y: y },
    end: { x: MARGIN_LEFT + USABLE_WIDTH, y: y },
    color: COLOURS.brand200,
    thickness: 1.5,
  });
  y -= 14;

  // Summary title
  page.drawText("Summary", {
    x: MARGIN_LEFT,
    y: y - FONT_SIZE_CATEGORY,
    font: fonts.bold,
    size: FONT_SIZE_CATEGORY,
    color: COLOURS.brand800,
  });
  y -= FONT_SIZE_CATEGORY + 10;

  // Recurring annual
  page.drawText("Recurring", {
    x: MARGIN_LEFT,
    y: y,
    font: fonts.medium,
    size: FONT_SIZE_SUMMARY_LABEL,
    color: COLOURS.black,
  });
  drawRightAligned(
    page,
    formatGBP(data.totals.recurring_annual),
    MARGIN_LEFT + 80,
    80,
    y,
    fonts.bold,
    FONT_SIZE_SUMMARY_VALUE,
    COLOURS.black,
  );
  page.drawText("Annually", {
    x: MARGIN_LEFT + 165,
    y: y,
    font: fonts.medium,
    size: FONT_SIZE_FOOTER,
    color: COLOURS.brand600,
  });
  y -= 14;

  // Assets total
  page.drawText("Assets", {
    x: MARGIN_LEFT,
    y: y,
    font: fonts.medium,
    size: FONT_SIZE_SUMMARY_LABEL,
    color: COLOURS.black,
  });
  drawRightAligned(
    page,
    formatGBP(data.totals.value_total),
    MARGIN_LEFT + 80,
    80,
    y,
    fonts.bold,
    FONT_SIZE_SUMMARY_VALUE,
    COLOURS.black,
  );
  y -= 24;

  // Write back modified state
  ctx.page = page;
  ctx.y = y;
}

/**
 * @description Generate a standalone PDF for the Household Assets report.
 * Creates a PDF document, renders the block, adds footers, and returns bytes.
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generateHouseholdAssetsPdf() {
  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const page = pdf.addPage({ size: "a4", orientation: "portrait" });
  const pages = [page];
  const y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_HEIGHT, MARGIN_TOP, fonts);

  const ctx = { pdf: pdf, page: page, pages: pages, y: y, fonts: fonts };
  renderHouseholdAssetsBlock(ctx);

  drawPageFooters(ctx.pages, "Household Assets", MARGIN_LEFT, USABLE_WIDTH, fonts);
  return await pdf.save();
}
