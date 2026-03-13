import { rgb, StandardFonts, Standard14Font } from "@libpdf/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Shared constants and utility functions for PDF report generation.
 * Provides consistent page headers (logo + "Portfolio 60") and footers
 * (date, report title, page numbering) across all PDF report blocks.
 */

/** @description Font sizes used in headers and footers */
const FONT_SIZE_HEADER_TITLE = 12;
const FONT_SIZE_FOOTER = 6;

/** @description Brand colours for header/footer elements */
const COLOURS = {
  brand800: rgb(0.15, 0.23, 0.42),
  brand600: rgb(0.35, 0.42, 0.55),
  brand200: rgb(0.82, 0.85, 0.9),
};

/**
 * @description Path to the logo PNG file.
 * @type {string}
 */
const logoPath = resolve(import.meta.dir, "../../ui/images/redmug-logo.png");

/**
 * @description Load the logo PNG bytes from disk. Cached after first load.
 * @type {Uint8Array|null}
 */
var logoBytes = null;

/**
 * @description Get the logo PNG bytes, loading from disk on first call.
 * @returns {Uint8Array} The PNG file bytes
 */
function getLogoBytes() {
  if (!logoBytes) {
    logoBytes = readFileSync(logoPath);
  }
  return logoBytes;
}

/**
 * @description Get today's date formatted as DD/MM/YYYY.
 * @returns {string} Formatted date string
 */
export function todayFormatted() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

/**
 * @description Draw the page header on a single page: logo image + "Portfolio 60" text.
 * The header is drawn at the top of the page within margins.
 * @param {Object} pdf - The PDF document (needed to embed image)
 * @param {Object} page - The PDFPage instance
 * @param {number} marginLeft - Left margin in points
 * @param {number} pageHeight - Total page height in points
 * @param {number} marginTop - Top margin in points
 * @returns {number} The y position after the header (for content to start from)
 */
export function drawPageHeader(pdf, page, marginLeft, pageHeight, marginTop) {
  const headerY = pageHeight - marginTop;
  const logoSize = 16;

  try {
    const bytes = getLogoBytes();
    const logoImage = pdf.embedImage(bytes);
    page.drawImage(logoImage, {
      x: marginLeft,
      y: headerY - logoSize,
      width: logoSize,
      height: logoSize,
    });
  } catch {
    // If logo fails to load, skip it silently
  }

  page.drawText("Portfolio 60", {
    x: marginLeft + logoSize + 6,
    y: headerY - FONT_SIZE_HEADER_TITLE - 1,
    font: StandardFonts.HelveticaBold,
    size: FONT_SIZE_HEADER_TITLE,
    color: COLOURS.brand800,
  });

  // Return the y position below the header with a small gap
  return headerY - logoSize - 10;
}

/**
 * @description Draw the footer on every page: separator line, date on left,
 * report title centred, page number on right.
 * Supports mixed page orientations: usableWidth can be a single number
 * (all pages same width) or an array of numbers (per-page width).
 * @param {Array<Object>} pages - Array of PDFPage instances
 * @param {string} reportTitle - The report block title for the centre text
 * @param {number} marginLeft - Left margin in points
 * @param {number|Array<number>} usableWidth - Usable content width in points,
 *   either a single value for all pages or an array with one value per page
 */
export function drawPageFooters(pages, reportTitle, marginLeft, usableWidth) {
  const footerTextY = 20;
  const footerLineY = footerTextY + 8;
  const dateStr = todayFormatted();
  const totalPages = pages.length;
  const footerFont = Standard14Font.of(StandardFonts.Helvetica);

  for (var p = 0; p < pages.length; p++) {
    var pageWidth = Array.isArray(usableWidth) ? usableWidth[p] : usableWidth;

    // Separator line
    pages[p].drawLine({
      start: { x: marginLeft, y: footerLineY },
      end: { x: marginLeft + pageWidth, y: footerLineY },
      color: COLOURS.brand200,
      thickness: 0.5,
    });

    // Date on the left
    pages[p].drawText(dateStr, {
      x: marginLeft,
      y: footerTextY,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_FOOTER,
      color: COLOURS.brand600,
    });

    // Report title centred
    var titleWidth = footerFont.widthOfTextAtSize(reportTitle, FONT_SIZE_FOOTER);
    var titleX = marginLeft + (pageWidth - titleWidth) / 2;
    pages[p].drawText(reportTitle, {
      x: titleX,
      y: footerTextY,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_FOOTER,
      color: COLOURS.brand600,
    });

    // Page number on the right
    var pageStr = "page " + (p + 1) + "/" + totalPages;
    var pageNumWidth = footerFont.widthOfTextAtSize(pageStr, FONT_SIZE_FOOTER);
    pages[p].drawText(pageStr, {
      x: marginLeft + pageWidth - pageNumWidth,
      y: footerTextY,
      font: StandardFonts.Helvetica,
      size: FONT_SIZE_FOOTER,
      color: COLOURS.brand600,
    });
  }
}
