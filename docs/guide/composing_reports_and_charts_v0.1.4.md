---
title: Composing Reports and Charts
summary: How to create and customise PDF reports, performance charts and composite multi-page reports
created: 2026-03-24
published: y
file-type: markdown
style: github
---

# Composing Reports and Charts

Portfolio 60 can produce PDF reports that you view in your browser or print. Reports are defined in a configuration file called `user-reports.json`. Each entry in the file describes one report that appears in the **Reports** dropdown menu.

You do not need to be a programmer to edit this file. It is written in a simple text format called JSON. This guide walks you through the format step by step, starting with the simplest possible report and building towards multi-page reports that combine tables and charts.

---

## How to Edit Reports

1. Open the **Settings** menu (gear icon) in the navigation bar.
2. Click **Edit Reports**.
3. The editor opens showing the current `user-reports.json` contents. A timestamped backup is created automatically each time you open the editor.
4. Make your changes, then click **Save**.
5. Your new or modified reports appear in the dropdown immediately — no restart needed.

> **Tip:** If you make a mistake and the file won't save, the error message will tell you where the problem is. The most common issue is a missing comma between entries.

---

## The Basics

The file contains a list of report definitions inside square brackets. Each report is wrapped in curly braces `{ }` and separated by commas.

Every report needs at least three fields:

| Field | What it does |
|-------|-------------|
| `id` | A unique short name (no spaces). Used internally — you won't see this. |
| `title` | The name shown in the Reports dropdown menu. |
| `pdfEndpoint` | Tells the system which type of report to generate. |

---

## Example 1: Household Assets (simplest report)

This is the simplest possible report. It shows a summary of all household assets — pensions, property, savings and other non-investment assets.

```json
{
  "id": "my_assets",
  "title": "Household Assets",
  "pdfEndpoint": "/api/reports/pdf/household-assets",
  "params": []
}
```

**What each line means:**
- `"id": "my_assets"` — a short unique name for this report.
- `"title": "Household Assets"` — the label shown in the Reports dropdown.
- `"pdfEndpoint": "/api/reports/pdf/household-assets"` — tells the system to generate a household assets PDF.
- `"params": []` — this report needs no extra information, so the list is empty.

---

## Example 2: Portfolio Summary

A portfolio summary shows the value of each person's accounts. The `params` list tells the report which people to include, using tokens like `USER1` and `USER2`.

Tokens are short placeholders that are replaced with real initials (e.g. `USER1` becomes `BW` for Ben Wilson). You set these up in **Settings > Edit Settings** under report parameters.

```json
{
  "id": "my_summary",
  "title": "Portfolio Summary",
  "pdfEndpoint": "/api/reports/pdf/portfolio-summary",
  "params": ["USER2", "USER1", "USER2 + USER1"]
}
```

This produces three tables on one page: one for each person, plus a combined household total.

### Comparison mode

You can add a `compareTo` field to show how the portfolio has changed over a period. The value is a number followed by `m` (months) or `y` (years):

```json
{
  "id": "my_summary_compare",
  "title": "Portfolio Summary (vs 3 months ago)",
  "pdfEndpoint": "/api/reports/pdf/portfolio-summary",
  "compareTo": "3m",
  "params": ["USER2", "USER1", "USER2 + USER1"]
}
```

This adds a column showing the change in value and percentage since the comparison date. Useful values include `"1m"`, `"3m"`, `"6m"`, `"1y"` and `"3y"`.

---

## Example 3: Portfolio Detail

A portfolio detail report shows every holding in an account with performance over selected time periods. Each entry in `params` follows the pattern:

```
PERSON:ACCOUNT_TYPE:periods
```

Where:
- **PERSON** is a token like `USER1` or `USER2`
- **ACCOUNT_TYPE** is `ISA`, `sipp`, `trading`, or a combination like `isa+sipp+trading`
- **periods** is a comma-separated list chosen from: `1m`, `3m`, `6m`, `1y`, `3y`, `5y`

```json
{
  "id": "my_detail",
  "title": "Portfolio Detail",
  "pdfEndpoint": "/api/reports/pdf/portfolio-detail",
  "params": [
    "USER1:ISA:1m,3m,1y",
    "USER1:sipp:1m,3m,1y",
    "USER1:trading:1m,3m,1y"
  ]
}
```

This produces a landscape PDF with three tables — one for each of the person's accounts.

### Adding a page break

If you have many accounts, you can insert `"new_page"` between entries to start a new page:

```json
"params": [
  "USER2:ISA:1m,3m,1y,3y",
  "USER2:sipp:1m,3m,1y,3y",
  "new_page",
  "USER1:ISA:1m,3m,1y,3y",
  "USER1:sipp:1m,3m,1y,3y"
]
```

### Combining account types

You can combine accounts by joining them with `+`. This shows all holdings across the named accounts in a single table:

```
"USER1:isa+sipp+trading:1m,3m,1y,3y"
```

---

## Example 4: Performance Chart (single chart)

A performance chart plots the percentage change of your investments and benchmark indices over time on a line graph. Charts are printed in landscape orientation for maximum width.

```json
{
  "id": "my_chart",
  "title": "Fund Performance",
  "subTitle": "12 month performance versus FTSE 100",
  "pdfEndpoint": "/api/reports/pdf/chart",
  "monthsToShow": "12",
  "smooth": true,
  "params": [
    "inv:GB00B41YBW71",
    "inv:GB00B4PQW151",
    "bm:FTSE 100"
  ]
}
```

### Chart fields explained

| Field | What it does |
|-------|-------------|
| `title` | Chart heading (also shown in the Reports dropdown). |
| `subTitle` | Smaller text below the title. |
| `monthsToShow` | How many months of history to plot (e.g. `"6"`, `"12"`, `"36"`). |
| `smooth` | `true` for smooth curves, `false` for straight lines between points. |
| `showGlobalEvents` | `true` to show numbered marker circles for global events (e.g. tariff announcements). |
| `fromMonthsAgo` | Shift the end date backwards. `"0"` means up to today. `"6"` means end 6 months ago. |

### Choosing what to plot

Each entry in `params` starts with either `inv:` or `bm:`:

- **`inv:`** followed by the investment's Public ID (its ISIN code or exchange:ticker). You can find this on the Investments page.
  - ISIN example: `"inv:GB00B41YBW71"` (Fundsmith Equity)
  - Ticker example: `"inv:LSE:RR."` (Rolls-Royce on the London Stock Exchange)
  - Foreign share example: `"inv:NSQ:NVDA"` (NVIDIA on Nasdaq)

- **`bm:`** followed by the benchmark name exactly as it appears on the Benchmarks page.
  - Example: `"bm:FTSE 100"`, `"bm:S&P 500"`, `"bm:FTSE 250"`

> **Tip:** You can plot up to about 8 items comfortably. Beyond that the legend becomes crowded, though the system will automatically shorten names to fit.

---

## Example 5: Portfolio Value Chart

A portfolio value chart plots the total value of each account over time as a line graph. Unlike performance charts (which show percentage change), this shows actual GBP values or percentage change from the start of the period.

```json
{
  "id": "my_value_chart",
  "title": "Portfolio Value",
  "subTitle": "Account values over 12 months",
  "pdfEndpoint": "/api/reports/pdf/portfolio-value-chart",
  "monthsToShow": "12",
  "smooth": true,
  "showPercentOrValue": "value",
  "params": [
    "USER1:isa",
    "USER1:sipp",
    "USER2:isa",
    "USER2:sipp"
  ]
}
```

### Portfolio value chart fields

| Field | What it does |
|-------|-------------|
| `showPercentOrValue` | `"value"` shows GBP amounts on the Y-axis. `"percent"` shows percentage change from the start of the period. |
| `showGlobalEvents` | `true` to show numbered event markers on the chart. |

The `params` entries follow the pattern `USER:account_type`, where the account type can be `isa`, `sipp`, `trading`, or combined with `+` (e.g. `"USER1:isa+sipp+trading"` for a total across all accounts).

---

## Example 6: Chart Group (multiple charts on one page)

A chart group puts 2, 3 or 4 smaller charts on a single page. This is useful for comparing the same investments over different time periods at a glance.

The layout is chosen automatically:
- **1 chart** — full landscape page (same as a single chart)
- **2 charts** — portrait page, charts stacked vertically
- **3 or 4 charts** — landscape page, charts in a 2 x 2 grid

```json
{
  "id": "my_multi_chart",
  "title": "UK Funds Comparison",
  "pdfEndpoint": "/api/reports/pdf/chart-group",
  "charts": [
    {
      "title": "36 Months",
      "subTitle": "3 year performance",
      "monthsToShow": "36",
      "smooth": true,
      "params": [
        "inv:GB00B41YBW71",
        "inv:GB00B4PQW151",
        "bm:FTSE 100"
      ]
    },
    {
      "title": "12 Months",
      "subTitle": "1 year performance",
      "monthsToShow": "12",
      "smooth": true,
      "params": [
        "inv:GB00B41YBW71",
        "inv:GB00B4PQW151",
        "bm:FTSE 100"
      ]
    }
  ]
}
```

Each entry in the `charts` list has the same fields as a single chart (`title`, `subTitle`, `monthsToShow`, `smooth`, `params`), but you leave out `id` and `pdfEndpoint` — those belong to the outer group definition.

### Global events on chart groups

You can add `"showGlobalEvents": true` at the top level of a chart group (next to `id` and `title`). Each sub-chart will show the numbered event marker circles at the relevant dates, and a single shared legend describing the events appears at the bottom of the page.

```json
{
  "id": "my_multi_chart_events",
  "title": "UK Funds with Events",
  "pdfEndpoint": "/api/reports/pdf/chart-group",
  "showGlobalEvents": true,
  "charts": [
    { "title": "12 Months", "monthsToShow": "12", "smooth": true, "params": ["inv:GB00B41YBW71", "bm:FTSE 100"] },
    { "title": "6 Months", "monthsToShow": "6", "smooth": true, "params": ["inv:GB00B41YBW71", "bm:FTSE 100"] }
  ]
}
```

---

## Example 7: Composite Report (multi-page)

A composite report combines several different report types into a single multi-page PDF. Instead of `pdfEndpoint`, you use `blocks` — a list of report sections, each on its own page.

Each block has a `type` field that tells the system what kind of page to produce:

| Block type | Page orientation | What it shows |
|-----------|-----------------|--------------|
| `household_assets` | Portrait | Pensions, property, savings and other non-investment assets |
| `portfolio_summary` | Portrait | Account values for selected people (with optional comparison) |
| `portfolio_detail` | Landscape | Individual holdings with performance periods |
| `chart` | Landscape | Performance line chart |
| `chart_group` | Varies | 1–4 charts on one page |
| `portfolio_value_chart` | Landscape | Portfolio account values over time |

Here is a simple two-page composite — a summary followed by a chart:

```json
{
  "id": "my_overview",
  "title": "Monthly Overview",
  "blocks": [
    {
      "type": "portfolio_summary",
      "compareTo": "1m",
      "params": ["USER2", "USER1", "USER2 + USER1"]
    },
    {
      "type": "chart",
      "title": "Fund Performance",
      "subTitle": "12 month trend",
      "monthsToShow": "12",
      "smooth": true,
      "params": [
        "inv:GB00B41YBW71",
        "inv:GB00B4PQW151",
        "bm:FTSE 100"
      ]
    }
  ]
}
```

**Important differences for composite reports:**
- Use `"blocks"` instead of `"pdfEndpoint"` and `"params"`.
- Each block starts on a new page.
- The `title` at the top level is used for the dropdown menu label and the page footers.
- Charts and portfolio value charts within blocks use the same fields as their standalone equivalents, nested inside a block with the appropriate `"type"`.

---

## Example 8: Full Weekly Report

This is a comprehensive multi-page report that you might generate once a week. It combines all the report types into a single PDF:

```json
{
  "id": "weekly_report",
  "title": "Weekly Report",
  "blocks": [
    { "type": "household_assets" },
    {
      "type": "portfolio_summary",
      "compareTo": "1m",
      "params": ["USER2", "USER1", "USER2 + USER1"]
    },
    {
      "type": "portfolio_detail",
      "params": [
        "USER2:ISA:1m,3m,1y,3y",
        "USER2:sipp:1m,3m,1y,3y",
        "USER2:trading:1m,3m,1y,3y",
        "USER2:isa+sipp+trading:1m,3m,1y,3y"
      ]
    },
    {
      "type": "portfolio_detail",
      "params": [
        "USER1:ISA:1m,3m,1y,3y",
        "USER1:sipp:1m,3m,1y,3y",
        "USER1:trading:1m,3m,1y,3y",
        "USER1:isa+sipp+trading:1m,3m,1y,3y"
      ]
    },
    {
      "type": "portfolio_value_chart",
      "title": "Portfolio Value",
      "subTitle": "12 month account values",
      "monthsToShow": "12",
      "smooth": true,
      "showPercentOrValue": "value",
      "showGlobalEvents": true,
      "params": [
        "USER2:isa+sipp+trading",
        "USER1:isa+sipp+trading"
      ]
    },
    {
      "type": "chart",
      "title": "UK Funds & Shares",
      "subTitle": "36 month performance versus FTSE 100 and S&P 500",
      "monthsToShow": "36",
      "smooth": true,
      "showGlobalEvents": true,
      "params": [
        "inv:GB00B41YBW71",
        "inv:GB00B4PQW151",
        "inv:LSE:RR.",
        "bm:FTSE 100",
        "bm:S&P 500"
      ]
    },
    {
      "type": "chart_group",
      "charts": [
        {
          "title": "Key Funds",
          "subTitle": "12 month trend",
          "monthsToShow": "12",
          "smooth": true,
          "params": [
            "inv:GB00B41YBW71",
            "inv:GB00B4PQW151",
            "inv:GB00BD3RZ582",
            "bm:FTSE 100"
          ]
        },
        {
          "title": "Key Funds",
          "subTitle": "6 month trend",
          "monthsToShow": "6",
          "smooth": true,
          "params": [
            "inv:GB00B41YBW71",
            "inv:GB00B4PQW151",
            "inv:GB00BD3RZ582",
            "bm:FTSE 100"
          ]
        }
      ]
    }
  ]
}
```

This produces a PDF with:
1. **Page 1** — Household assets (portrait)
2. **Page 2** — Portfolio summary with month-on-month comparison (portrait)
3. **Page 3** — Alexis's account details (landscape)
4. **Page 4** — Ben's account details (landscape)
5. **Page 5** — Portfolio value chart showing total account values (landscape)
6. **Page 6** — 36-month performance chart with global events (landscape)
7. **Page 7** — Two comparison charts side by side (portrait)

All pages share the same footer with the report title and continuous page numbering.

---

## Quick Reference: Report Types

| `pdfEndpoint` value | Description |
|---------------------|-------------|
| `/api/reports/pdf/household-assets` | Household assets summary |
| `/api/reports/pdf/portfolio-summary` | Portfolio values by person (with optional comparison) |
| `/api/reports/pdf/portfolio-detail` | Holdings with performance periods |
| `/api/reports/pdf/chart` | Single performance chart |
| `/api/reports/pdf/portfolio-value-chart` | Portfolio account values over time |
| `/api/reports/pdf/chart-group` | Multiple charts on one page |
| *(use `blocks` instead)* | Multi-page composite report |

## Quick Reference: Tokens

Tokens like `USER1` and `USER2` are replaced with real initials before the report runs. You manage tokens in **Settings > Edit Settings** under report parameters. This means you can share the same report file across different setups — only the token mappings change.

---

## Troubleshooting

**"Report not found" error:** Make sure the `id` in your report is unique, and that the file is valid JSON (no trailing commas, all strings in double quotes).

**Chart shows "No data":** Check that the investment Public IDs in your `params` are correct and that prices have been fetched for the time period you've chosen.

**Nothing appears in the dropdown:** The file may have a JSON syntax error. Open the editor and check the error message. Common mistakes include forgetting a comma between entries or using single quotes instead of double quotes.

**Charts look cramped with many items:** Try reducing the number of investments per chart, or use a chart group to spread items across multiple smaller charts.

**Comparison shows no change:** The `compareTo` period must have historic valuation data available. If you only recently started using the application, there may not be enough history for longer comparison periods.
