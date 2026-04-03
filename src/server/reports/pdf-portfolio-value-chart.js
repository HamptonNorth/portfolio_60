import { PDF } from "@libpdf/core";
import { embedRobotoFonts } from "./pdf-fonts.js";
import { drawPageHeader, drawPageFooters } from "./pdf-common.js";
import { renderChartBlock } from "./pdf-chart.js";
import { getPortfolioChartData } from "../services/portfolio-chart-data-service.js";

/** @description A4 landscape dimensions in points */
const A4_LANDSCAPE_HEIGHT = 595.28;
const MARGIN_LEFT = 40;
const MARGIN_TOP = 40;
const USABLE_WIDTH = 841.89 - MARGIN_LEFT - 40;

/**
 * @description Render a portfolio value chart block into a shared PDF context.
 * Gathers portfolio valuation data at regular intervals, then delegates
 * to the standard line chart renderer with pre-built chart data.
 *
 * @param {Object} ctx - Shared rendering context
 * @param {Object} ctx.pdf - The PDF document
 * @param {Object} ctx.page - Current page (updated in place on ctx)
 * @param {Array<Object>} ctx.pages - Array of all pages
 * @param {number} ctx.y - Current y position (updated in place on ctx)
 * @param {Array<number>} ctx.pageWidths - Per-page usable widths
 * @param {Array<string>} params - Params array (USER:account_type entries)
 * @param {Object} [blockDef] - Block definition with title, subTitle, monthsToShow, etc.
 */
export function renderPortfolioValueChartBlock(ctx, params, blockDef) {
  // Build the chart definition for the data service
  const chartDef = {
    title: (blockDef && blockDef.title) || "Portfolio Value",
    subTitle: (blockDef && blockDef.subTitle) || "",
    monthsToShow: (blockDef && blockDef.monthsToShow) || "12",
    showPercentOrValue: (blockDef && blockDef.showPercentOrValue) || "percent",
    showGlobalEvents: blockDef && blockDef.showGlobalEvents === true,
    params: params,
  };

  // Gather portfolio valuation data at regular intervals
  const chartData = getPortfolioChartData(chartDef);

  // Delegate to the standard line chart renderer with pre-built data
  const rendererDef = {
    title: chartData.title,
    subTitle: chartData.subTitle,
    monthsToShow: chartDef.monthsToShow,
    smooth: blockDef && blockDef.smooth === true,
    showGlobalEvents: chartDef.showGlobalEvents,
    _chartData: chartData,
  };

  // Preserve bounds for multi-chart layouts
  if (blockDef && blockDef._bounds) {
    rendererDef._bounds = blockDef._bounds;
  }

  renderChartBlock(ctx, params, rendererDef);
}

/**
 * @description Generate a standalone PDF for a portfolio value chart.
 * Creates a landscape A4 PDF with a single chart showing portfolio account
 * values over time.
 * @param {Object} chartDef - Chart definition from user-reports.json
 * @returns {Promise<Uint8Array>} The PDF file bytes
 */
export async function generatePortfolioValueChartPdf(chartDef) {
  const pdf = PDF.create();
  const fonts = embedRobotoFonts(pdf);
  const page = pdf.addPage({ size: "a4", orientation: "landscape" });
  const pages = [page];
  const y = drawPageHeader(pdf, page, MARGIN_LEFT, A4_LANDSCAPE_HEIGHT, MARGIN_TOP, fonts);

  const ctx = { pdf: pdf, page: page, pages: pages, y: y, pageWidths: [USABLE_WIDTH], fonts: fonts };
  renderPortfolioValueChartBlock(ctx, chartDef.params || [], chartDef);

  drawPageFooters(ctx.pages, chartDef.title || "Portfolio Value", MARGIN_LEFT, USABLE_WIDTH, fonts);
  return await pdf.save();
}
