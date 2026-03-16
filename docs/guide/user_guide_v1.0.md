---
title: Portfolio 60 User Guide
summary: User Guide for installation and setup of a UK Financial Portfolio
created: 2025-12-21T10:35:00-00:00
published: y
file-type: markdown
style: github
sticky: true
---

# Portfolio 60 User Guide

## Introduction

Portfolio 60 is a desktop application for UK families to track investments across multiple people and account types. It supports shares, mutual funds, investment trusts, savings accounts and other instruments. All valuations and reports are in GBP, with automatic currency conversion for foreign-currency investments.

The application runs on your desktop and stores all data locally in a SQLite database. It connects to the internet to fetch current prices, currency exchange rates and benchmark index values from public financial data APIs.

Key features:

- Track investments across multiple family members and account types (Trading, ISA, SIPP)
- Automatic price fetching via public financial data APIs
- Currency conversion for non-GBP investments
- Portfolio valuation with drill-down to individual holdings
- Buy/sell transaction recording with automatic cash balance updates
- Scheduled price fetching on a configurable timetable
- Database backup and restore
- Built-in documentation system for notes and guides
- Embedded spreadsheet lists via Google Sheets or Excel Online

Portfolio 60 is a UK-only application due to the complexity of UK tax rules and account types.

---

## Installation

Portfolio 60 is distributed as a desktop application via GitHub Releases. Downloads are available for Windows, macOS and Linux.

### Windows

Download the `.msi` installer from the latest GitHub Release and run it. Windows may display a SmartScreen warning because the application is not code-signed. To proceed:

1. Click **More info** on the SmartScreen dialog
2. Click **Run anyway**

This warning appears because code-signing certificates are expensive and Portfolio 60 is a personal/family application. The application is safe to install.

### macOS

Download the `.dmg` file from the latest GitHub Release. macOS will likely block the application because it is not signed with an Apple Developer certificate. To open it:

1. Open **System Settings > Privacy & Security**
2. Scroll down to find a message about Portfolio 60 being blocked
3. Click **Open Anyway**
4. You may need to enter your macOS password to confirm

Alternatively, right-click the application in Finder and select **Open** — this sometimes bypasses the Gatekeeper warning directly.

### Linux

Two package formats are available:

- **`.deb`** — For Debian-based distributions (Ubuntu, Linux Mint, Pop!_OS). Install with:
  ```
  sudo dpkg -i portfolio-60_x.x.x_amd64.deb
  ```
  If there are missing dependencies, run `sudo apt-get install -f` afterwards.

- **`.AppImage`** — A portable, self-contained format that works on most Linux distributions without installation. Simply make it executable and run:
  ```
  chmod +x Portfolio-60_x.x.x_amd64.AppImage
  ./Portfolio-60_x.x.x_amd64.AppImage
  ```

The `.deb` package integrates with your system (desktop menu entry, file associations). The `.AppImage` is useful if you prefer not to install system-wide or if your distribution does not use `.deb` packages.

---

## Set Up

When you first launch Portfolio 60, you will be asked to set a passphrase. This passphrase protects access to the application — you will need to enter it every time you start the app. Choose something memorable but secure. The passphrase is stored as a one-way hash and cannot be recovered if forgotten.

Once past the passphrase screen, the application will create the database and you can begin setting up your data. The suggested order is:

### Add Users

Navigate to **Set Up > Users**.

Each user represents a family member whose investments you want to track. A user has one investment provider (e.g. Interactive Investor, Hargreaves Lansdown) and may have up to three account types at that provider.

Required fields:
- **Initials** — Up to 5 characters, used as a short identifier (e.g. "JDS")
- **Provider** — Select from the configured list of providers (ii, hl, etc.)
- **First Name** and **Last Name**

Optional fields:
- **NI Number** — National Insurance number (e.g. AB123456C)
- **UTR** — Unique Taxpayer Reference
- **Trading Ref**, **ISA Ref**, **SIPP Ref** — Account reference numbers at the provider. These are used when creating accounts in Portfolio Setup.

Click **Add** to save the user. You can edit or delete users later. Deleting a user will also remove all their accounts, holdings, transactions and movements — the application will ask you to confirm your passphrase before proceeding.

### Add Investments

Navigate to **Set Up > Investments**.

An investment represents a financial instrument that one or more family members may hold — a share, mutual fund, investment trust, or other product.

Required fields:
- **Description** — The name of the investment (e.g. "Vanguard FTSE All-World ETF")
- **Investment Type** — Select from: Shares, Mutual Funds, Investment Trusts, Savings Accounts, Other
- **Currency** — The currency in which this investment is priced (e.g. GBP, USD)

Optional fields:
- **Public ID** — The ISIN code for mutual funds (e.g. GB00B4PQW151), or an Exchange:Ticker code for shares and investment trusts (e.g. LSE:AZN). For ETFs, use the format Ticker:Exchange:Currency (e.g. ISF:LSE:GBX). Click the info icon for full details. This is the key field for automatic price fetching — the system uses it to look up the investment on Morningstar.

The form also shows **Price Page URL**, **Known Site** and **CSS Selector** fields. These are legacy fields from an earlier version that fetched prices by visiting web pages. They are no longer used for price fetching and can be left blank.

### Add Benchmarks

Navigate to **Set Up > Benchmarks**.

Benchmarks are market indices or reference points you want to track alongside your portfolio (e.g. FTSE 100, S&P 500). Live values are fetched automatically via the Yahoo Finance API.

Required fields:
- **Description** — The name of the benchmark (e.g. "FTSE 100 Index"). The system matches this to a Yahoo Finance ticker symbol automatically.
- **Benchmark Type** — Select the appropriate type
- **Currency** — The currency of the benchmark value

The form also shows **Benchmark URL**, **Known Site** and **CSS Selector** fields. These are legacy fields from an earlier version and can be left blank.

### Add Currencies

Navigate to **Set Up > Currencies**.

GBP is pre-configured. Add any other currencies used by your investments (e.g. USD, EUR). Each currency needs:

- **Code** — The standard 3-letter currency code (e.g. USD). Automatically uppercased.
- **Description** — A readable name (e.g. "US Dollar")

Currency exchange rates (to GBP) are fetched automatically when you run a price fetch.

### Fetching

Navigate to **Set Up > Fetching**.

This page lets you manually fetch current prices, currency rates and benchmark values. Click **Fetch All** to run all three in sequence. The page shows:

- The date and time of the last successful fetch for each data type
- The current scheduled fetch time (if scheduling is enabled)
- Real-time progress as each item is fetched
- Results showing the fetched values, with success/failure status for each item

A fetch always runs in this order: currency rates first, then investment prices, then benchmarks. This ensures prices and exchange rates are contemporaneous.

Click **View Fetching History** to see a log of all past fetch attempts, including any errors.

### Portfolio Setup

Navigate to **Set Up > Portfolio Setup** (or **Portfolio > Summary Valuation** and click **Setup**).

Portfolio Setup is where you connect users, accounts and holdings together.

#### Accounts

Select a user from the dropdown, then add their accounts:

- **Account Type** — Trading, ISA, or SIPP
- **Account Reference** — Populated from the references you entered on the user record
- **Cash Balance** — The current cash balance in the account (GBP)
- **Warning Threshold** — If the cash balance falls below this amount, a warning is shown on the valuation report

Each user can have at most one account of each type.

#### Holdings

Select an account, then add the investments held in that account:

- **Investment** — Type to search and select from your investments list
- **Quantity** — The number of units/shares held (up to 4 decimal places)
- **Average Cost Price** or **Book Cost Value** — Enter either one; the other is calculated automatically. Average cost is the price per unit; book cost is the total cost of the holding.

You can also record **Buy** and **Sell** transactions, **Deposits** and **Withdrawals** of cash, and **Fee** adjustments. Stock splits are supported via a checkbox on the edit holding form.

---

## Portfolio Valuation

Navigate to **Portfolio > Summary Valuation** (this is also the default home page).

The Summary Valuation shows the current value of all investments across all users and accounts. For each account you can see:

- Account type and reference
- Total investments value (GBP)
- Cash balance
- Account total
- Cash warnings (if balance is below the warning threshold)

Use the **User** dropdown to filter by individual family member, or select **All Users** for the complete picture.

Click **View** on any account to drill down to individual holdings, showing:

- Investment name and public ID
- Currency
- Quantity held
- Current price (with the date it was fetched)
- Exchange rate (for non-GBP investments)
- Value in local currency and in GBP
- Average cost price

From the holdings detail view you can also record buy/sell movements, deposits, withdrawals and fee adjustments.

### Validating Your Setup

When you first set up Portfolio 60, compare the valuations shown here against your investment provider's own website or app. The values should be very close but small differences are expected — these arise from timing differences between when prices were fetched and when you are viewing the provider's figures. A difference of a few pounds on a large holding is normal.

If the values are significantly different, check:

- The Public ID is correct and the system can resolve it on Morningstar
- The currency is set correctly on the investment
- The quantity matches what your provider shows
- Currency exchange rates have been fetched recently

---

## Auto Fetch of Prices

Portfolio 60 can automatically fetch prices, currency rates and benchmark values on a schedule, so you do not need to run manual fetches.

### Cron Set Up for Fetching

The fetch schedule is configured in **Settings > Edit Settings** under the `scheduling` section:

```json
"scheduling": {
  "enabled": true,
  "cron": "10 8 * * 6",
  "runOnStartupIfMissed": true,
  "startupDelayMinutes": 10
}
```

- **enabled** — Set to `true` to activate scheduled fetching, or `false` to disable it
- **cron** — A cron expression defining when fetches run. The default `"10 8 * * 6"` means "at 8:10am every Saturday". Common alternatives:
  - `"0 8 * * 1-5"` — 8am on weekdays only
  - `"0 8 * * 6"` — 8am on Saturdays only
  - `"0 7,19 * * *"` — 7am and 7pm daily
- **runOnStartupIfMissed** — If the app was closed when a scheduled fetch was due, run it when the app next starts (after a short delay)
- **startupDelayMinutes** — How long to wait after startup before running a missed fetch (default: 10 minutes). This gives the app time to fully initialise.

Each scheduled fetch runs all three data types in sequence: currency rates, investment prices, then benchmarks.

If any items fail, the scheduler will retry them automatically according to the retry settings:

```json
"retry": {
  "delayMinutes": 5,
  "maxAttempts": 5
}
```

This means failed items are retried every 5 minutes, up to 5 total attempts.

### Cron Settings for Fees

*This feature is planned for a future release.* Automatic monthly fee deductions (e.g. platform management charges) will be configurable on a schedule.

### Cron Settings for Auto Backup

*This feature is planned for a future release.* Automatic database backups will be configurable on a schedule.

---

## Reports

Navigate to **Reports**.

The Reports page provides PDF reports and performance charts for your portfolio. Available report types include:

- **Portfolio Summary** — A one-page overview of all accounts and their current values
- **Portfolio Detail Valuation** — A detailed breakdown of every holding across all accounts, with current prices, exchange rates and GBP values
- **Household Assets** — A combined view of investment accounts and other assets
- **Performance Charts** — Line charts showing investment and benchmark performance over time, rebased to a common starting point for comparison

Reports open as PDF documents in your browser. Investment names in the reports are clickable links to external research pages (FT Markets and Morningstar) where available.

Charts can be configured as individual charts or chart groups (multiple charts on one page). Chart definitions are managed in **Settings > Edit Settings** under the report parameters.

---

## Docs

The Docs system is a built-in documentation feature for storing notes, guides and reference material as Markdown files. You might use it for investment research notes, tax planning guides, provider contact details, or this user guide itself.

### Features

- Organise documents into categories (e.g. "User Guide", "Financial Notes")
- Write in Markdown with live preview
- Upload images for use in documents
- Full-text search across all documents
- Spell checking with UK English dictionary
- Pin important documents to the top of the list
- Draft/published status control
- Print-friendly document view
- Two CSS styles for rendering: "github" (clean, modern) and "modest" (traditional)

### Setting Up Categories

Categories are configured in **Settings > Edit Settings** under the `docs` section:

```json
"docs": {
  "categories": {
    "guide": { "style": "github", "label": "User Guide" },
    "notes": { "style": "modest", "label": "Financial Notes" }
  }
}
```

Each key (e.g. `"guide"`) is a folder name created under the `docs/` directory. The **label** is the display name shown in the Docs menu. The **style** sets the default CSS theme for rendering Markdown in that category.

Two categories are set up by default: **User Guide** and **Financial Notes**. Add more by adding entries to the `categories` object.

### Authoring a Document in Markdown

To add a new document:

1. Navigate to **Docs** and select a category
2. Click **Upload** and drag-and-drop a `.md` file, or click to browse for one

Markdown files must include front matter at the top (see below). The document body is standard Markdown — headings, paragraphs, bold, italic, lists, links, images, code blocks, tables, and so on.

To include images in a document:

1. Open the document for editing (click **edit** next to the title)
2. Click **Upload Image** in the editor header
3. Select an image file (JPG, PNG, GIF, WebP, or SVG)
4. The editor shows the Markdown snippet to paste into your document

### Front Matter

Every Markdown document starts with a YAML front matter block enclosed in `---` lines:

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

- **title** (required) — The document heading, shown in the list and at the top of the page
- **summary** — A brief description displayed in the document list beneath the title
- **created** — The date the document was written, in YYYY-MM-DD format
- **published** — Set to `y` to publish the document, or `n` to keep it as a draft. Drafts are visible in the list (marked "Draft") but are not included in search results
- **file-type** — Always set to `markdown`
- **style** — The CSS theme for rendering: `github` or `modest`. If omitted, the category default is used
- **sticky** — Set to `true` to pin the document to the top of the list. Pinned documents are shown with a "Pinned" badge

### Editing and Spell Checking

To edit a document, click **edit** next to its title in the document list. This opens the editor modal where you can modify the raw Markdown content, including the front matter.

The editor includes a **Spell Check** button in the footer. Click it to check the document for spelling errors using a UK English dictionary. Misspelt words are highlighted with a red wavy underline, and the total error count is shown in the footer.

Spell check runs automatically as you type (after a short pause), so you can see errors appear and disappear as you edit.

To add a word to the custom dictionary (e.g. a name, technical term, or abbreviation that is correct but not in the standard dictionary):

1. Right-click on a highlighted word in the editor
2. Select **Add to dictionary** from the context menu

The word is stored in the database and will no longer be flagged in any document.

### Search

To search across all documents, click **Search Docs** in the Docs menu (or use the search option within any category view). Type your search term and results appear in real time, showing the document title, summary, category and date. Click a result to navigate directly to that document.

---

## Lists

The Lists feature lets you embed live spreadsheets from Google Sheets or Microsoft Excel Online into the application. This is useful for data that is maintained in a spreadsheet and shared with family members — for example, a list of non-SIPP pensions, insurance policies, or contact details.

### Set Up Using Config.json Edit

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

- **title** — The name shown in the Lists menu
- **spreadsheet** — Either `"google"` (Google Sheets) or `"microsoft"` (Excel Online)
- **iframe** — The full embed HTML code from the spreadsheet provider (see below)
- **range** — Optional. For Google Sheets, a cell range (e.g. `"A3:F14"`). For Excel Online, a named range defined in the workbook.

### Embedding a Google Sheet

1. Open your Google Sheet
2. Go to **File > Share > Publish to web**
3. Select the sheet/range you want to publish
4. Choose **Embed** as the format
5. Click **Publish** and copy the entire `<iframe>` HTML code
6. Paste this into the `iframe` field in config.json

Use the `range` field to limit the visible area (e.g. `"A1:D20"`).

### Embedding an Excel Spreadsheet

1. Save your Excel file to OneDrive
2. Open it in Excel Online
3. Go to **File > Share > Embed**
4. Customise the appearance (hide gridlines, headers, etc.)
5. Click **Generate** and copy the entire `<iframe>` HTML code
6. Paste this into the `iframe` field in config.json, with `"spreadsheet": "microsoft"`

For Excel, the `range` field should be a **named range** defined in the workbook (not a cell reference). To create a named range in Excel: select the cells, then type a name in the Name Box (left of the formula bar).

### Refresh of Data

Embedded spreadsheets show live data from the source. To see updated values:

- **Google Sheets** — Changes are reflected automatically, though there may be a short delay (typically a few minutes)
- **Excel Online** — Changes are reflected after saving the file in OneDrive

The iframe content is loaded fresh each time you navigate to the list page.

### Hiding Gridlines

For a cleaner appearance, you can hide gridlines in the embedded spreadsheet:

- **Google Sheets** — In the Publish to Web dialog, the embed code does not include gridlines by default
- **Excel Online** — In the Embed dialog, untick **Show gridlines** before generating the code. You can also add `&wdHideGridlines=True` to the iframe URL if needed

---

## Settings

Navigate to **Settings > Edit Settings** to open the configuration editor.

The settings are stored in a `config.json` file and can be edited directly in the application. The editor shows the raw JSON content. Make your changes, then click **Save**. Changes take effect immediately.

**Important:** Use a **text editor** mindset when editing config.json. Do not copy and paste from Microsoft Word, Google Docs, or similar word processors — these applications often replace straight quotes (`"`) with curly/smart quotes (" "), which will break the JSON format. If you need to draft settings changes outside the app, use a plain text editor such as Notepad (Windows), TextEdit in plain text mode (macOS), or any code editor.

### Providers

```json
"allowed_providers": [
  { "code": "ii", "name": "Interactive Investor" },
  { "code": "hl", "name": "Hargreaves Lansdown" }
]
```

Two providers are configured by default: **Interactive Investor** (ii) and **Hargreaves Lansdown** (hl). If your provider is not listed, add a new entry with a short code (up to 5 characters) and the full name. The code is what appears in dropdowns and reports; the name is for reference.

Other common UK providers you might add:
- `{ "code": "aj", "name": "AJ Bell" }`
- `{ "code": "vg", "name": "Vanguard" }`
- `{ "code": "fi", "name": "Fidelity" }`

### Scheduling

```json
prepare "scheduling": {
  "enabled": true,
  "cron": "10 8 * * 6",
  "runOnStartupIfMissed": true,
  "startupDelayMinutes": 10
}
```

Controls automatic price, rate and benchmark fetching. See the [Auto Fetch of Prices](#auto-fetch-of-prices) section for full details.

The default schedule fetches at 8:10am every Saturday. Adjust the cron expression to suit your needs. A useful resource for building cron expressions is [crontab.guru](https://crontab.guru/).

### Retry on Price Fetching

```json
"retry": {
  "delayMinutes": 5,
  "maxAttempts": 5
}
```

When a scheduled fetch fails for one or more items (e.g. an API is temporarily unavailable), the scheduler retries the failed items:

- **delayMinutes** — Wait this many minutes between retry attempts (default: 5)
- **maxAttempts** — Maximum total attempts including the initial one (default: 5)

Only failed items are retried — successful items are not re-fetched.

### ISA Allowance

```json
"isaAllowance": {
  "annualLimit": 20000,
  "taxYearStartMonth": 4,
  "taxYearStartDay": 6
}
```

Configures the UK ISA annual contribution limit and the tax year start date. The current UK ISA allowance is £20,000 per tax year, starting on 6th April. Update the `annualLimit` if the government changes the allowance.

### Fetch Batching

```json
"fetchBatch": {
  "batchSize": 10,
  "cooldownSeconds": 25
}
```

Controls how investment prices and benchmark values are fetched in batches to avoid rate-limiting by the data APIs:

- **batchSize** — The number of items fetched per batch (1–50). Default: 10.
- **cooldownSeconds** — The pause in seconds between batches (0–600). Default: 25.

The default settings are designed to be respectful of the public APIs. Reducing the cooldown or increasing the batch size may result in requests being blocked by the API providers.

### Lists

See the [Lists](#lists) section above for full details on configuring embedded spreadsheets.

### Docs

See the [Docs](#docs) section above for full details on configuring documentation categories.

---

## Backup

Navigate to **Set Up > Backup**.

Regular backups are important. Portfolio 60 stores all your data in a single SQLite database file. If this file is corrupted or accidentally deleted, your data is lost. Backups are your safety net.

### Creating a Backup

Click **Backup Now** to create a timestamped copy of the database in the `backups/` directory. The filename includes the date and time (e.g. `portfolio60-2026-02-16-14-30-00.db`). Take a backup before making significant changes to your data, and periodically as a matter of routine.

### Restoring from a Backup

The backup page shows all existing backup files with their dates and sizes. Click **Restore** next to a backup to replace the current database with that backup. The application will ask you to confirm — restoring a backup overwrites all current data with the data from the backup file.

### Deleting Old Backups

Click **Delete** next to a backup to remove it. You will be asked to confirm. Consider keeping at least a few recent backups and periodically removing older ones to save disk space.

### What Is Backed Up

Currently, only the SQLite database is backed up. This includes all users, investments, accounts, holdings, transactions, prices, currency rates, benchmark data, and custom dictionary words.

The following are **not** currently included in backups:

- The `config.json` settings file
- Documents in the `docs/` directory
- Uploaded images in the `docs/media/` directory

A future release will extend the backup system to include these items and provide automatic scheduled backups with one-click restore.

**Recommendation:** In addition to using the built-in backup feature, consider periodically copying the entire `data/` and `docs/` directories to an external drive or cloud storage service for extra protection.

---

## Test/Reference Mode

Portfolio 60 includes a built-in test mode that lets you explore the application with sample data. This is useful for:

- **New users** — Try out the application before entering your own data
- **Training** — Practise adding users, recording transactions, and running fetches without affecting real data
- **Demonstrations** — Show the application to others without revealing personal financial information

### Entering Test Mode

On the passphrase screen (either the first-run "Set passphrase" screen or the normal "Enter passphrase" screen), type **test** as the passphrase and press Enter.

The application opens immediately with a pre-loaded set of anonymised sample data, including:

- Two example users (Ben Wilson and Alexis Wilson) with accounts and holdings
- A selection of investments covering shares, mutual funds and investment trusts in both GBP and foreign currencies
- Recent prices, currency rates and benchmark values
- Sample documents and configuration

No passphrase hash is created or checked — typing "test" bypasses authentication entirely.

### How to Tell You Are in Test Mode

When test mode is active, the navigation bar title changes from **Portfolio 60** to **Portfolio 60 - Test**. This is always visible at the top of the screen so you can tell at a glance which mode you are in.

### What You Can Do in Test Mode

You can use all features of the application normally — browse valuations, add or edit users, record transactions, run price fetches, view documents, and so on. Any changes you make are applied to the test database.

However, your changes are **not permanent**. The next time someone enters test mode, the sample data is restored to its original state. This means you can experiment freely without worrying about breaking anything.

### Passphrase Confirmation in Test Mode

Some destructive operations (e.g. deleting a user and all their accounts) require you to re-enter your passphrase as a safety check. In test mode:

- Enter **test** as the confirmation passphrase — this is the only value that is accepted
- Your real passphrase will **not** work as a confirmation in test mode

Similarly, when using the application with your real data, entering "test" as a confirmation passphrase will be rejected. The two modes are completely separate.

### Exiting Test Mode

Close the application and restart it. On the passphrase screen, enter your real passphrase to return to your live data. Your live data is never touched while in test mode — it remains exactly as you left it.

---

## Reporting Issues

Portfolio 60 is maintained as an open-source project. If you encounter a bug, unexpected behaviour, or have a suggestion for improvement:

1. Check the **About** screen (**Settings > About**) to note the application version and build date
2. Report the issue on GitHub at the project's Issues page
3. Include:
   - What you were doing when the problem occurred
   - What you expected to happen
   - What actually happened
   - The application version and build date from the About screen
   - Any error messages you saw
   - Screenshots if relevant

The About screen shows the application name, version number and the date/time it was built. This information helps when diagnosing issues.
