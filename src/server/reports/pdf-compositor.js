import { PDF } from "@libpdf/core";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";
import { embedRobotoFonts } from "./pdf-fonts.js";
import { renderHouseholdAssetsBlock } from "./pdf-household-assets.js";
import { renderPortfolioSummaryBlock } from "./pdf-portfolio-summary.js";
import { renderPortfolioDetailBlock } from "./pdf-portfolio-detail.js";
import { renderChartBlock, renderChartGroupBlock, getChartGroupLayout } from "./pdf-chart.js";
import { renderPortfolioValueChartBlock } from "./pdf-portfolio-value-chart.js";

/**
 * @description Block type registry mapping type names to their renderer
 * function and default page orientation.
 * Each entry contains:
 *   - render: the block renderer function (receives ctx and optional params)
 *   - orientation: "portrait" or "landscape"
 *   - pageHeight: A4 page height for that orientation (in points)
 *   - usableWidth: usable content width for that orientation (in points)
 * @type {Object<string, Object>}
 */
const BLOCK_TYPES = {
  household_assets: {
    render: renderHouseholdAssetsBlock,
    orientation: "portrait",
    pageHeight: 841.89,
    usableWidth: 515.28,
  },
  portfolio_summary: {
    render: renderPortfolioSummaryBlock,
    orientation: "portrait",
    pageHeight: 841.89,
    usableWidth: 515.28,
  },
  portfolio_detail: {
    render: renderPortfolioDetailBlock,
    orientation: "landscape",
    pageHeight: 595.28,
    usableWidth: 761.89,
  },
  chart: {
    render: renderChartBlock,
    orientation: "landscape",
    pageHeight: 595.28,
    usableWidth: 761.89,
  },
  chart_group: {
    render: renderChartGroupBlock,
    getLayout: getChartGroupLayout,
  },
  portfolio_value_chart: {
    render: renderPortfolioValueChartBlock,
    orientation: "landscape",
    pageHeight: 595.28,
    usableWidth: 761.89,
  },
};

/** @description Shared margins (same for all page orientations) */
const MARGIN_LEFT = 40;
const MARGIN_TOP = 40;

/**
 * @description Generate a composite PDF from a report definition containing
 * multiple blocks. Each block starts on a new page with the appropriate
 * orientation. All pages share unified footers with the report title and
 * continuous page numbering.
 * @param {Object} reportDef - The report definition from user-reports.json
 * @param {string} reportDef.title - The composite report title (used in footers)
 * @param {Array<Object>} reportDef.blocks - Array of block definitions
 * @param {string} reportDef.blocks[].type - Block type name (e.g. "household_assets")
 * @param {Array<string>} [reportDef.blocks[].params] - Optional params for the block
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generateCompositePdf(reportDef) {
  const blocks = reportDef.blocks || [];

  if (blocks.length === 0) {
    // Return a minimal PDF with a "no blocks" message
    const pdf = PDF.create();
    const fonts = embedRobotoFonts(pdf);
    const page = pdf.addPage({ size: "a4", orientation: "portrait" });
    const emptyY = drawPageHeader(pdf, page, MARGIN_LEFT, 841.89, MARGIN_TOP, fonts);
    page.drawText(reportDef.title + " \u2014 no blocks defined.", {
      x: MARGIN_LEFT,
      y: emptyY - 14,
      font: fonts.medium,
      size: 14,
      color: { r: 0.15, g: 0.23, b: 0.42 },
    });
    drawPageFooters([page], reportDef.title, MARGIN_LEFT, 515.28, fonts);
    return await pdf.save();
  }

  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const pages = [];
  const pageWidths = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockType = BLOCK_TYPES[block.type];

    if (!blockType) {
      // Unknown block type — skip it
      continue;
    }

    // Determine layout — static for most block types, dynamic for chart_group
    const layout = blockType.getLayout ? blockType.getLayout(block) : blockType;

    // Start a new page for each block with the correct orientation
    const page = pdf.addPage({ size: "a4", orientation: layout.orientation });
    pages.push(page);
    pageWidths.push(layout.usableWidth);

    // Draw page header and get starting y position
    const y = drawPageHeader(pdf, page, MARGIN_LEFT, layout.pageHeight, MARGIN_TOP, fonts);

    // Build context for the block renderer
    const ctx = {
      pdf: pdf,
      page: page,
      pages: pages,
      y: y,
      pageWidths: pageWidths,
      fonts: fonts,
    };

    // Call the block renderer (chart blocks also receive the full block definition)
    blockType.render(ctx, block.params || [], block);

    // The renderer may have added more pages; ctx.page and ctx.y
    // reflect the final state but we don't need them between blocks
  }

  // Draw unified footers across all pages with per-page widths
  drawPageFooters(pages, reportDef.title, MARGIN_LEFT, pageWidths, fonts);

  return await pdf.save();
}
