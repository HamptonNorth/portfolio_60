---
title: Portfolio 60 Technical Reference
summary: Installation, configuration and advanced settings for Portfolio 60
created: 2026-03-24
published: y
file-type: markdown
style: github
sticky: false
---

# Portfolio 60 Technical Reference

This document covers installation, configuration and advanced settings. For a guide to using the application day-to-day, see the **User Guide**.

---

## Installation

Portfolio 60 is currently distributed as a standalone compiled executable for Windows, macOS and Linux. The installation process is straightforward but does require a few steps at the command line.

For up-to-date installation instructions, platform-specific notes and download links, please refer to the **README.md** on the project's GitHub repository:

**[github.com/rcollins/portfolio-60](https://github.com/rcollins/portfolio-60)**

Packaged installers (`.msi`, `.dmg`, `.deb`) may be made available in future if there is sufficient demand.

---

## Application Settings

Navigate to **Settings > Edit Settings** to open the configuration editor.

Settings are stored in a `user-settings.json` file and edited directly in the application as raw JSON. Make changes, then click **Save**. Changes take effect immediately. A timestamped backup of the previous settings is created automatically each time you save.

**Important:** Do not copy and paste from Microsoft Word, Google Docs or similar word processors. These applications often replace straight quotes (`"`) with curly/smart quotes (" "), which will break the JSON format. Use a plain text editor if you need to draft changes outside the app.

### Providers

```json
"allowed_providers": [
  { "code": "ii", "name": "Interactive Investor" },
  { "code": "hl", "name": "Hargreaves Lansdown" }
]
```

Two providers are configured by default. Add more by adding entries to the array:

- `{ "code": "aj", "name": "AJ Bell" }`
- `{ "code": "vg", "name": "Vanguard" }`
- `{ "code": "fi", "name": "Fidelity" }`

The `code` is a short identifier (up to 5 characters) shown in compact views. The `name` is the full display name.

### Scheduled Fetching

```json
"scheduling": {
  "enabled": true,
  "cron": "10 8 * * 6",
  "runOnStartupIfMissed": true,
  "startupDelayMinutes": 10
}
```

- **enabled** — `true` to activate automatic fetching, `false` to disable
- **cron** — a cron expression defining when fetches run. The default `"10 8 * * 6"` means "at 8:10am every Saturday". Common alternatives:
  - `"0 8 * * 1-5"` — 8am on weekdays only
  - `"0 8 * * 6"` — 8am on Saturdays only
  - `"0 7,19 * * *"` — 7am and 7pm daily
  - A useful tool for building cron expressions: [crontab.guru](https://crontab.guru/)
- **runOnStartupIfMissed** — if the app was closed when a scheduled fetch was due, run it when the app next starts (after a short delay)
- **startupDelayMinutes** — how long to wait after startup before running a missed fetch (default: 10 minutes)

### Retry on Failed Fetches

```json
"retry": {
  "delayMinutes": 5,
  "maxAttempts": 5
}
```

When a scheduled fetch fails for one or more items (e.g. an API is temporarily unavailable), the scheduler retries the failed items:

- **delayMinutes** — wait this many minutes between retry attempts (default: 5)
- **maxAttempts** — maximum total attempts including the initial one (default: 5)

Only failed items are retried — successful items are not re-fetched.

### Fetch Batching

```json
"fetchBatch": {
  "batchSize": 10,
  "cooldownSeconds": 25
}
```

Controls how prices and benchmark values are fetched in batches to avoid overwhelming the data services:

- **batchSize** — number of items fetched per batch (1–50). Default: 10
- **cooldownSeconds** — pause in seconds between batches (0–600). Default: 25

The default settings are designed to be respectful of the public APIs. Reducing the cooldown or increasing the batch size may result in requests being blocked.

### ISA Allowance

```json
"isaAllowance": {
  "annualLimit": 20000,
  "taxYearStartMonth": 4,
  "taxYearStartDay": 6
}
```

Configures the UK ISA annual contribution limit and the tax year start date. Update `annualLimit` if the government changes the allowance (currently £20,000).

---

## Automatic Gap Detection

Because Portfolio 60 runs on your desktop rather than a server, data gaps can occur if the computer is switched off or the application is not running. For example, if you go on holiday for several weeks, the scheduled fetches will not run and you will have missing data for that period.

Portfolio 60 detects these gaps automatically. Each time a fetch runs (whether manual or scheduled), the application checks each investment, currency and benchmark for the date of the most recent stored data. If the gap is greater than 10 days, the missing data is fetched before collecting today's values.

This targeted gap-fill is much faster than a full historic backfill because it only fetches the specific date range that is missing. The data sources are:

- **Investment prices** — Morningstar API (weekly data points)
- **Benchmark values** — Yahoo Finance API (weekly data points)
- **Currency rates** — Bank of England (daily data filtered to weekly Fridays)

Gap-fill happens automatically and requires no action from you. Progress messages appear in the fetch results.

---

## Documentation System — Advanced

### Front Matter Format

Every Markdown document in the Docs system starts with a YAML front matter block enclosed in `---` lines:

```yaml
---
title: My Document Title
summary: A brief description shown in the document list
created: 2026-01-15
published: y
file-type: markdown
style: github
sticky: false
---
```

Fields:

- **title** (required) — the document heading
- **summary** — a brief description shown beneath the title in the document list
- **created** — the date the document was written (YYYY-MM-DD format)
- **published** — `y` to publish, `n` to keep as a draft. Drafts appear in the list (marked "Draft") but are excluded from search results
- **file-type** — always `markdown`
- **style** — CSS theme for rendering: `github` (clean, modern) or `modest` (traditional). If omitted, the category default is used
- **sticky** — `true` to pin the document to the top of the list

### Configuring Document Categories

Categories are defined in **Settings > Edit Settings** under the `docs` section:

```json
"docs": {
  "categories": {
    "guide": { "style": "github", "label": "User Guide" },
    "notes": { "style": "modest", "label": "Financial Notes" }
  }
}
```

Each key (e.g. `"guide"`) is a folder name. The `label` is the display name in the Docs menu. The `style` sets the default CSS theme for that category. Add more categories by adding entries to the object.

### Spell Checking

The documentation editor includes spell checking with a UK English dictionary. Misspelt words are highlighted with a red underline as you type. Right-click a highlighted word and select **Add to dictionary** to add it to your custom dictionary (useful for names, technical terms or abbreviations).

### Uploading Images

To include images in a document:

1. Open the document for editing (click **edit** next to the title)
2. Click **Upload Image** in the editor header
3. Select an image file (JPG, PNG, GIF, WebP, or SVG)
4. The editor shows the Markdown snippet to paste into your document

---

## Embedding Spreadsheets (Lists)

Lists are configured in **Settings > Edit Settings** under the `lists` section:

```json
"lists": {
  "items": [
    {
      "title": "Non-SIPP Pensions",
      "spreadsheet": "google",
      "iframe": "<iframe src=\"https://docs.google.com/spreadsheets/d/e/...\"></iframe>",
      "range": "A2:F14"
    }
  ]
}
```

Each list item has:

- **title** — the name shown in the Lists menu
- **spreadsheet** — either `"google"` or `"microsoft"`
- **iframe** — the full embed HTML code from the spreadsheet provider
- **range** — optional cell range (Google Sheets) or named range (Excel Online)

### Embedding a Google Sheet

1. Open your Google Sheet
2. Go to **File > Share > Publish to web**
3. Select the sheet or range to publish
4. Choose **Embed** as the format
5. Click **Publish** and copy the entire `<iframe>` HTML code
6. Paste into the `iframe` field in settings

Use the `range` field to limit the visible area (e.g. `"A1:D20"`).

### Embedding an Excel Spreadsheet

1. Save your Excel file to OneDrive
2. Open it in Excel Online
3. Go to **File > Share > Embed**
4. Customise the appearance (hide gridlines, headers, etc.)
5. Click **Generate** and copy the entire `<iframe>` HTML code
6. Paste into the `iframe` field in settings, with `"spreadsheet": "microsoft"`

For Excel, the `range` field should be a **named range** defined in the workbook (not a cell reference). To create a named range: select the cells, then type a name in the Name Box (left of the formula bar).

### Refresh of Data

Embedded spreadsheets show live data from the source:

- **Google Sheets** — changes are reflected automatically (there may be a short delay)
- **Excel Online** — changes are reflected after saving the file in OneDrive

---

## Custom Views and Reports

### Editing View Definitions

Navigate to **Settings > Edit Views** to configure custom HTML composite views. Views are defined as JSON and appear in the **Views** dropdown menu. Each view specifies a layout of data panels.

### Editing Report Definitions

Navigate to **Settings > Edit Reports** to configure custom PDF reports. Reports are defined as JSON and appear in the **Reports** dropdown menu. Each report specifies the page layout, data blocks and formatting.

See the separate guide **Composing Reports and Charts** for detailed instructions on building custom reports.

---

## Fetch Server Integration

Portfolio 60 can optionally integrate with a companion application called **fetch-server-60** — a lightweight server that runs independently and fetches prices, rates and benchmark values on its own schedule. This is useful if you want prices to be fetched even when Portfolio 60 is not running (for example, on an always-on home server).

Configuration is in **Settings > Edit Settings** under the `fetchServer` section:

```json
"fetchServer": {
  "enabled": false,
  "url": "http://localhost:1421"
}
```

When enabled, Portfolio 60 pushes its fetch configuration to the fetch server on startup and whenever investments, currencies or benchmarks change. It can then pull the latest data back, upserting into the database.

---

## Test Mode (Write-Enabled)

For development and testing purposes, a write-enabled test mode is available. This is separate from the read-only demo mode described in the User Guide.

To enter write-enabled test mode, type `test$rnc` as the passphrase. This opens the test database with full read/write access — you can add, edit and delete data, run real fetches against external APIs, and make any changes you wish.

The navigation bar changes to a green colour and shows **Portfolio 60 - Test** to distinguish it from both normal mode and demo mode.

**Note:** The standard `test` and `demo` passphrases open the test database in read-only (demo) mode. Only `test$rnc` provides write access.

---

## Data Storage

All application data is stored locally on your computer:

- **Database** — a SQLite file containing all portfolio data, prices, rates and settings
- **Configuration** — a `user-settings.json` file with application preferences
- **Documents** — Markdown files in a `docs/` directory
- **Backups** — timestamped copies of the database in a `backups/` directory

No data is sent to any external service. The only internet connections made are to fetch prices, exchange rates and benchmark values from public financial data APIs (Morningstar, Yahoo Finance and the Bank of England).

---

## Price Data Sources

Portfolio 60 uses three public data services:

- **Morningstar** — for investment prices (shares, funds, trusts). Prices are resolved via ISIN or exchange:ticker codes entered in the Public ID field
- **Yahoo Finance** — for benchmark index values (FTSE 100, S&P 500, etc.)
- **Bank of England / Frankfurter** — for currency exchange rates (GBP to USD, EUR, etc.)

These are free, publicly accessible services. Portfolio 60 uses them respectfully with built-in rate limiting and batching to avoid excessive requests.
