---
title: Portfolio 60 User Guide
summary: A complete guide to setting up and using Portfolio 60 for tracking your family's investments
created: 2026-03-24
published: y
file-type: markdown
style: github
sticky: true
---

# Portfolio 60 User Guide

## What is Portfolio 60?

Portfolio 60 is an application for UK families to keep track of their investments in one place. If you or your family have investments spread across different account types — Trading accounts, ISAs and SIPPs — and perhaps with more than one person investing, Portfolio 60 brings everything together so you can see the full picture.

The application tracks shares, mutual funds, investment trusts, savings accounts and other instruments. All valuations are shown in pounds sterling (GBP), with automatic currency conversion for any investments priced in other currencies such as US dollars or euros.

Portfolio 60 fetches current prices, exchange rates and benchmark index values from public financial data services, so your portfolio valuations stay up to date without manual data entry.

### Who is it for?

Portfolio 60 is designed for UK families who want a clear, private view of their combined investments. It is particularly suited to households where:

- More than one family member has investments
- Investments are spread across different providers (Interactive Investor, Hargreaves Lansdown, AJ Bell, etc.)
- You want to see everything in one place rather than logging into multiple provider websites
- You value keeping your financial data private and stored locally on your own computer

### What can it do?

- **Track investments** across multiple family members and account types (Trading, ISA, SIPP)
- **Fetch prices automatically** from public financial data services
- **Convert currencies** for non-GBP investments using live exchange rates
- **Show portfolio valuations** with drill-down to individual holdings
- **Record transactions** — buys, sells, deposits, withdrawals and fees
- **Analyse performance** with league tables, comparison charts and risk/return views
- **Generate PDF reports** for printing or sharing
- **Track other assets** such as pensions, property and savings alongside investments
- **Back up your data** with one-click backup and restore
- **Store notes and documents** using the built-in documentation system

---

## Getting Started

When you first open Portfolio 60, you will see the passphrase screen. This is the gateway to the application — every time you start the app, you enter your passphrase to unlock it.

### Setting your passphrase

On the very first run, you will be asked to **set** a passphrase. Choose something you will remember — it must be at least 8 characters. This passphrase protects access to your data and cannot be recovered if forgotten, so make a note of it somewhere safe.

On subsequent runs, you simply enter the passphrase you chose and press Enter.

### Resetting your passphrase

If you forget your passphrase or simply want to change it, you can reset it. This does **not** delete or alter your portfolio data in any way — it only removes the stored passphrase so the application treats you as a first-time user and asks you to choose a new one.

To reset your passphrase:

1. Close Portfolio 60 if it is running
2. Open your data folder — this is typically `~/.config/portfolio_60/` on Linux or macOS, or `%APPDATA%\portfolio_60\` on Windows
3. Open the file called `.env` in a plain text editor (e.g. Notepad, TextEdit or nano)
4. Find the line that starts with `APP_PASSPHRASE_HASH=` and delete it entirely
5. Save the file and close the editor
6. Start Portfolio 60 — you will be asked to set a new passphrase

Your database, settings, documents, backups and all other data are completely unaffected by this process.

### Trying the demo first

If you would like to explore the application before entering your own data, type **demo** or **test** as the passphrase. This opens a pre-loaded set of sample data so you can browse around and see what the application does. Nothing you do in demo mode affects any real data, and no changes are saved. See the [Demo Mode](#demo-mode) section for more details.

### Your first steps after setting a passphrase

Once you are past the passphrase screen, the application creates your database and you are ready to begin. The suggested order for setting things up is:

1. **Add your family members** (Set Up > Users)
2. **Add the investments you hold** (Set Up > Investments)
3. **Add any non-GBP currencies** you need (Set Up > Currencies)
4. **Add benchmark indices** for comparison (Set Up > Benchmarks)
5. **Set up accounts and holdings** (Set Up > Portfolio Setup)
6. **Fetch current prices** (Set Up > Fetching)

Each of these steps is explained in detail below.

---

## Setting Up Your Portfolio

### Adding Users

Navigate to **Set Up > Users**.

Each user represents a family member whose investments you want to track. You might have two users — for example, yourself and your spouse — each with their own accounts at an investment provider.

For each user, enter:

- **Initials** — a short identifier (up to 5 characters), shown in compact views
- **First name** and **Last name**
- **Provider** — select from the list (e.g. Interactive Investor, Hargreaves Lansdown)

You can also enter optional reference numbers:

- **NI Number** — National Insurance number
- **UTR** — Unique Taxpayer Reference
- **Trading Ref**, **ISA Ref**, **SIPP Ref** — your account reference numbers at the provider

Click **Add** to save. You can edit or delete users later. Deleting a user also removes all their accounts, holdings and transactions — the application will ask you to confirm your passphrase before proceeding.

### Adding Investments

Navigate to **Set Up > Investments**.

An investment is a financial product that one or more family members may hold — a share, mutual fund, investment trust or other product. You add the investment once, then assign it to individual accounts in Portfolio Setup.

For each investment, enter:

- **Description** — the name (e.g. "Vanguard LifeStrategy 60% Equity")
- **Investment Type** — Shares, Mutual Funds, Investment Trusts, Savings Accounts, or Other
- **Currency** — the currency in which this investment is priced

The most important optional field is:

- **Public ID** — this is what the application uses to fetch prices automatically. For mutual funds, enter the ISIN code (e.g. GB00B4PQW151). For shares and investment trusts, enter an Exchange:Ticker code (e.g. LSE:AZN for AstraZeneca on the London Stock Exchange). Click the information icon next to this field for full details on the format.

If you leave the Public ID blank, the investment will be marked as "manually priced" — you can still enter prices by hand whenever you choose.

### Adding Currencies

Navigate to **Set Up > Currencies**.

GBP (pounds sterling) is already set up. If any of your investments are priced in other currencies, add them here. For example:

- **USD** — US Dollar
- **EUR** — Euro

Just enter the standard 3-letter currency code and a description. Exchange rates are fetched automatically whenever you run a price fetch.

### Adding Benchmarks

Navigate to **Set Up > Benchmarks**.

Benchmarks are market indices you want to track alongside your portfolio — they give you a reference point to judge how your investments are performing. Common choices include:

- FTSE 100 Index
- FTSE 250 Index
- FTSE All-Share Index
- S&P 500 (for US market comparison)

For each benchmark, enter a description, type and currency. The application matches the description to the correct data source automatically. Benchmark values are fetched alongside your investment prices.

### Setting Up Accounts and Holdings

Navigate to **Set Up > Portfolio Setup**.

This is where you connect everything together — linking users to their accounts, and accounts to the investments held in them.

#### Adding accounts

Select a user from the dropdown. For each account they have, click **Add Account** and choose:

- **Account Type** — Trading, ISA, or SIPP
- **Cash Balance** — the current cash balance in the account
- **Warning Threshold** — if the cash balance drops below this amount, a warning will appear on your portfolio valuation (useful for spotting when an account needs topping up)

Each user can have one account of each type.

#### Adding holdings

Select an account, then click **Add Holding** to add each investment held in that account:

- **Investment** — start typing to search and select from your investments list
- **Quantity** — the number of units or shares held
- **Average Cost Price** or **Book Cost Value** — enter either one and the other is calculated automatically

#### Recording transactions

Once you have holdings set up, you can record buy and sell transactions, deposits and withdrawals of cash, and fee adjustments. These update the holding quantities and cash balances automatically. Stock splits are also supported.

---

## Fetching Prices

Navigate to **Set Up > Fetching**.

This page is your control centre for keeping prices, exchange rates and benchmark values up to date.

### Running a manual fetch

Click **Fetch All** to fetch everything in one go. The page shows live progress as each item is fetched — you will see a table of investments updating one by one with their current prices and a status indicator showing success or failure.

A fetch always runs in this order: currency rates first, then investment prices, then benchmark values. This ensures prices and exchange rates are from the same time period.

### Automatic scheduled fetching

You can set the application to fetch prices automatically on a schedule — for example, every Saturday morning. This is configured in Settings (see the Technical Reference guide for details). When a scheduled fetch is due but the application was not running (for example, your computer was switched off), it will run the missed fetch automatically when you next start the app.

### Viewing fetch history

Click **View Fetching History** to see a log of all past fetch attempts. This is useful for checking that automatic fetches are running as expected, or for diagnosing why a particular investment's price might not be updating.

### What if prices stop updating?

If an investment's price stops updating, check:

- The Public ID is correct on the investment record
- The investment is still listed on the London Stock Exchange or the relevant exchange
- The investment has not been delisted or merged

You can also set an investment to "manually priced" by turning off automatic fetching on the investment edit screen — useful for savings accounts or other products where the value changes infrequently.

---

## Viewing Your Portfolio

### Summary Valuation

Navigate to **Portfolio > Summary Valuation**.

This is the main view of your portfolio. It shows the current value of all investments across all users and accounts. For each account you can see:

- Account type and reference number
- Total investments value
- Cash balance
- Account total
- A warning if the cash balance is below the threshold you set

Use the **User** dropdown at the top to filter by individual family member, or select **All Users** to see the complete picture.

### Account Detail

Click **View** on any account in the summary to drill down to individual holdings. This shows:

- Each investment held, with its name and identifier
- The currency it is priced in
- The number of units or shares held
- The current price and when it was last fetched
- The exchange rate (for non-GBP investments)
- The value in both the local currency and in GBP
- The average cost price and unrealised gain or loss

From this view you can also record buys, sells, deposits, withdrawals and fees.

### Historic Comparison

On the summary valuation page, you can compare the current portfolio with how it looked at an earlier date — for example, one month ago, three months ago or a year ago. This shows which accounts have grown and which have declined, giving you a clear picture of how your portfolio has changed over time.

---

## Investment Analysis

Navigate to **Views > Analysis**.

The analysis page provides four different ways to examine how your investments are performing. All four views share a common set of controls at the top of the page.

### Filters

Two filters appear beneath the page title:

- **Show** — choose between:
  - *Current holdings only* (the default) — only investments you currently hold
  - *Historic holdings only* — investments you held in the past but have since sold
  - *All investments* — everything in your investments list, whether currently held or not

- **Users** — select which family members' holdings to include. By default all users are selected. Click the dropdown to select or deselect individual users.

These filters apply to all four analysis tabs and are also reflected in any PDFs you print from this page.

### Period Selection

For the League Table, Risk vs Return and Top/Bottom 5 tabs, you can choose the time period to analyse: 1 week, 1 month, 3 months, 6 months, 1 year, 2 years or 3 years.

### Benchmark Comparison

If you have benchmarks configured, a row of checkboxes appears allowing you to overlay up to three benchmark indices on the charts and tables. This lets you see how your investments are performing relative to the market.

### Comparison Tab

A table showing each investment's return over multiple time periods side by side. The default columns are 3 months, 6 months, 1 year and 3 years, but you can change any column to a different period using the dropdown in the column header. Click a column header to sort by that period's return.

Returns are colour-coded: green for gains, red for losses.

### League Table Tab

A ranked list of all your investments ordered by return. The best performer is at the top, the worst at the bottom. Each row includes a small trend chart (sparkline) showing the price movement over the selected period.

You can sort by return, name or investment type, and filter to show only the top or bottom 10 or 20 performers.

### Risk vs Return Tab

A scatter plot showing each investment as a point, with return on the vertical axis and volatility (price variability) on the horizontal axis. This helps you identify:

- **Top left** — strong returns with low volatility (the ideal)
- **Top right** — strong returns but volatile (higher risk for the reward)
- **Bottom left** — weak returns but steady (defensive but underperforming)
- **Bottom right** — weak returns and volatile (candidates for review)

Dashed lines mark the median return and volatility, dividing the chart into four quadrants.

### Top / Bottom 5 Tab

Two line charts showing the five best-performing and five worst-performing investments over the selected period. Each line is rebased to a common starting point (0%) so you can compare the trajectory of different investments directly, regardless of their actual price.

### Printing to PDF

Click the **Print to PDF** button to generate a PDF of whichever tab you are currently viewing. The PDF reflects your current filter and period selections, and shows a subtitle indicating which filters are active.

---

## Reports and Charts

### PDF Reports

Navigate to **Reports** in the menu bar.

Portfolio 60 generates a range of PDF reports that you can view on screen, print or save. Available reports include:

- **Portfolio Summary** — a one-page overview of all accounts and their current values, with optional comparison to a previous date
- **Portfolio Detail** — a detailed breakdown of every holding across all accounts, with current prices, exchange rates and values
- **Household Assets** — a combined view of investment accounts alongside other assets such as pensions and property
- **Performance Charts** — line charts showing how individual investments and benchmarks have performed over time
- **Chart Groups** — multiple performance charts arranged on a single page for easy comparison

Investment names in the PDF reports are clickable links to external research pages on FT Markets and Morningstar, where you can find further information about each investment.

### Portfolio Value Chart

Available from **Reports > Portfolio Value Chart**.

This chart plots the total value of each account over time as a line graph. It gives you a visual history of how your portfolio has grown (or declined) over weeks, months and years.

### Custom Views

If you have configured custom views (see the Technical Reference), they appear in the **Views** menu alongside the built-in views. These are composite HTML pages that can combine multiple data panels.

---

## Other Assets

Navigate to **Set Up > Other Assets**.

Not all your family's assets are held in investment accounts. Portfolio 60 lets you record other significant assets alongside your investments, so the Household Assets report gives a more complete picture of your financial position.

You can record assets such as:

- **Defined benefit pensions** — with an annual income amount
- **Defined contribution pensions** — with a current fund value
- **Property** — with an estimated value
- **Savings accounts** — with a current balance
- **Other assets** — anything else of significant value

Each asset can have a description, a value or income amount, and notes. Asset values are included in the Household Assets report.

---

## Global Events

Navigate to **Set Up > Global Events**.

Global events let you record significant dates and milestones — things like market events, changes to tax rules, or personal financial milestones. These appear as reference markers in charts and reports, helping you remember why a particular period looked the way it did.

For each event, enter a date, a short title, and an optional longer description.

---

## Backup and Restore

Navigate to **Set Up > Backup**.

Regular backups are important. Portfolio 60 stores all your data in a single database file. If this file were corrupted or accidentally deleted, your data would be lost. Backups are your safety net.

### Creating a backup

Click **Backup Now** to create a timestamped copy of your database. The backup is stored in a `backups` folder and the filename includes the date and time so you can tell backups apart.

Take a backup before making significant changes to your data, and periodically as a matter of routine — perhaps weekly or monthly.

### Restoring from a backup

The backup page shows all your existing backup files with their dates and sizes. Click **Restore** next to a backup to replace the current database with that backup. You will be asked to confirm — restoring a backup replaces all current data with the data from the backup file.

### Deleting old backups

Click **Delete** next to a backup to remove it. Keep at least a few recent backups and periodically remove older ones to save disk space.

### What is backed up

The backup includes all your portfolio data — users, investments, accounts, holdings, transactions, prices, exchange rates, benchmark values and dictionary words. It is good practice to also keep a separate copy of your data folder on an external drive or cloud storage for extra protection.

---

## Built-in Documentation

Navigate to **Docs** in the menu bar.

Portfolio 60 includes a built-in documentation system for storing notes, guides and reference material. You might use it for:

- Investment research notes
- Tax planning guides
- Provider contact details and account numbers
- This user guide itself

Documents are written in Markdown format (a simple way of formatting text) and organised into categories. You can search across all documents, pin important ones to the top of the list, and mark documents as draft or published.

The Docs menu shows your configured document categories. Click a category to see its documents, or use **Search Docs** to find content across all categories.

---

## Lists

If configured, the **Lists** menu provides links to embedded spreadsheets — for example, a Google Sheet or Excel Online spreadsheet that you maintain separately. This is useful for data that you keep in a spreadsheet and want to view alongside your portfolio, such as a list of non-SIPP pensions or insurance policies.

Lists are set up in the application settings (see the Technical Reference guide for details).

---

## Demo Mode

Portfolio 60 includes a demo mode that lets you explore the application with pre-loaded sample data. This is useful for:

- **Trying before installing** — see what the application does before committing to setting it up with your own data
- **Showing someone else** — demonstrate the application without revealing your personal financial information

### Entering demo mode

On the passphrase screen, type **demo** or **test** as the passphrase and press Enter. The application opens with a set of sample data including example users, accounts, investments and recent prices.

### What you can do in demo mode

You can browse all views, run reports, view analysis charts, and even try the Fetch All process (which simulates fetching prices without actually contacting any external services). Everything works as it would with real data.

What you cannot do is make changes — demo mode is read-only. If you try to add, edit or delete anything, you will see a message explaining that the application is in demonstration mode.

### How to tell you are in demo mode

The navigation bar at the top changes to an amber colour and shows **Portfolio 60 - Demo** as the title. A banner beneath the navigation bar confirms that you are in read-only demonstration mode.

### Leaving demo mode

Click **Sign Out** (in the Settings menu) to return to the passphrase screen. Enter your real passphrase to access your own data, or close the application.

---

## Getting Help

If you encounter a problem, have a question or would like to suggest an improvement:

- **Email** — send a message to [support@redmug.co.uk](mailto:support@redmug.co.uk)
- **About screen** — navigate to **Settings > About** to check the application version and build date, which is helpful when reporting issues

When reporting a problem, it helps to include:

- What you were doing when the problem occurred
- What you expected to happen
- What actually happened
- The application version from the About screen
- A screenshot if relevant
