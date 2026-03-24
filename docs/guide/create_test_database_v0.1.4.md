---
title: Create Test Database
summary: How the test and demo database is created and maintained
created: 2026-03-24
published: y
file-type: markdown
style: github
sticky: false
---

# Create Test Database

This guide explains how the test/demo database works in Portfolio 60. The test database contains anonymised sample data that you can use for demonstrations, training and exploring features without affecting your live data.

---

## How It Works

The test database is created **automatically** the first time you enter the developer test passphrase (`test****`). There is no manual setup required — the application handles everything.

### What happens when you type "test$rnc"

1. The application creates a fresh database in the `data/test_reference/` directory
2. It applies the schema and populates it with sample reference data (users, accounts, investments, holdings, benchmarks, currencies, other assets and global events)
3. It then runs a full historic backfill — fetching approximately 3 years of price history, benchmark values and currency exchange rates from public data services
4. Progress is shown on screen via a streaming progress display

The first-time setup takes **5–10 minutes** because of the volume of historic data being fetched. Subsequent entries into any test or demo mode are instant because the database already exists.

### After creation

Once the backfill completes, you are prompted to run **Fetch All** to collect today's prices. After that, the test database is fully functional with realistic, up-to-date valuations.

The `demo` and `test` passphrases (read-only modes) **do not** create the database — if the test database does not yet exist, they will show an error directing you to create it first using `test$rnc`.

---

## Accessing the Test Database

Three special passphrases provide access to the test database:

| Passphrase | Creates DB if missing? | Write access? | Navbar colour |
|---|---|---|---|
| **demo** | No — shows an error if the database does not exist | Read-only | Amber |
| **test** | No — shows an error if the database does not exist | Read-only | Amber |
| **test$rnc** | Yes — creates and backfills automatically | Full read/write | Green |

- **demo** and **test** both open the test database in read-only (demonstration) mode. You can browse all views, run reports and try the simulated Fetch All, but you cannot add, edit or delete any data.
- **test$rnc** opens the test database with full write access — you can make changes, run real fetches against external APIs, and modify the data freely. This is the developer/testing passphrase.

### How to tell which mode you are in

- **Demo/read-only** — the navbar is **amber** and shows **Portfolio 60 - Demo** with a read-only banner beneath
- **Write-enabled test** — the navbar is **green** and shows **Portfolio 60 - Test**
- **Live data** — the navbar is the normal **dark blue** and shows **Portfolio 60**

### Returning to live data

Click **Sign Out** (in the Settings menu) or close and restart the application. Enter your normal passphrase to return to your live data. Your live data is never touched while using the test database.

---

## Sample Data Summary

The test database includes:

| Data | Count | Details |
|------|-------|---------|
| Currencies | 3 | GBP, USD, EUR |
| Investments | 23 | 8 mutual funds, 7 GBP shares, 2 investment trusts, 5 USD shares, 1 EUR share |
| Benchmarks | 6 | FTSE 100, FTSE 250, FTSE All-Share, S&P 500, Dow Jones, Nasdaq |
| Users | 2 | Ben Wilson (BW), Alexis Wilson (AW) — both with Interactive Investor |
| Accounts | 6 | Trading, ISA and SIPP for each user |
| Holdings | 19 | Distributed across all accounts |
| Cash transactions | 6 | Opening cash deposits |
| Other assets | 10 | Pensions, property, savings, vehicles |
| Global events | 2 | Sample market events |

The investments include a realistic mix: UK mutual funds identified by ISIN, London-listed shares and trusts identified by exchange:ticker codes, US shares in USD, and a EUR-denominated share — giving a good spread for testing currency conversion, analysis views and reports.

---

## Refreshing the Test Database

To start fresh with a clean test database:

1. Delete the `data/test_reference/` directory from your data folder
2. Enter **test$rnc** as your passphrase
3. The database will be recreated and backfilled from scratch

This is useful after significant application updates that change the database schema, or if you simply want to reset the sample data to its original state.

### Keeping demo data current

If you are running a public demo (for example, via a Cloudflare tunnel), the test database prices will become stale unless updated. You can either:

- Enter **test$rnc** mode periodically and run **Fetch All** to get fresh prices
- Copy an up-to-date test database from your development machine to the server

---

## Simulated Fetch in Demo Mode

When using demo or test mode (read-only), the **Fetch All** function is simulated. The user interface shows the same progress display — spinners, row-by-row updates, batch progress — but no external API calls are made and no data is written. The simulated fetch reads existing prices from the database and displays them with short delays to look realistic.

This means you can safely demonstrate the fetch process to others without worrying about API rate limits or unintended data changes.
