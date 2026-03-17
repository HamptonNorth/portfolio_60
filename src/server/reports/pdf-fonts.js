/**
 * @description Shared Roboto font loader for PDF report generation.
 * Loads Roboto Regular (400), Medium (500), and Bold (700) TTF files
 * and embeds them into a PDF document. Font bytes are cached after first load.
 *
 * Usage in each PDF generator:
 *   var fonts = embedRobotoFonts(pdf);
 *   page.drawText("Hello", { font: fonts.regular, size: 10 });
 *   var w = fonts.medium.widthOfTextAtSize("Hello", 10);
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** @description Directory containing the Roboto TTF files */
const fontsDir = resolve(import.meta.dir, "../../ui/fonts");

/** @description Cached font bytes (loaded once from disk) */
var regularBytes = null;
var mediumBytes = null;
var boldBytes = null;

/**
 * @description Load font bytes from disk, caching after first call.
 * @returns {{ regular: Uint8Array, medium: Uint8Array, bold: Uint8Array }}
 */
function loadFontBytes() {
  if (!regularBytes) {
    regularBytes = readFileSync(resolve(fontsDir, "Roboto-Regular.ttf"));
  }
  if (!mediumBytes) {
    mediumBytes = readFileSync(resolve(fontsDir, "Roboto-Medium.ttf"));
  }
  if (!boldBytes) {
    boldBytes = readFileSync(resolve(fontsDir, "Roboto-Bold.ttf"));
  }
  return { regular: regularBytes, medium: mediumBytes, bold: boldBytes };
}

/**
 * @description Embed Roboto fonts into a PDF document.
 * Returns an object with three EmbeddedFont instances that can be
 * passed to drawText() and used for text measurement via widthOfTextAtSize().
 * @param {Object} pdf - The PDF document instance
 * @returns {{ regular: EmbeddedFont, medium: EmbeddedFont, bold: EmbeddedFont }}
 */
export function embedRobotoFonts(pdf) {
  var bytes = loadFontBytes();
  return {
    regular: pdf.embedFont(bytes.regular),
    medium: pdf.embedFont(bytes.medium),
    bold: pdf.embedFont(bytes.bold),
  };
}
