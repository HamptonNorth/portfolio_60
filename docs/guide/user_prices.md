---
title: Prices, Values and Currency Rates
summary: How Portfolio 60 fetches and manages investment prices, benchmark values and currency exchange rates
created: 2026-03-04T12:00:00-00:00
published: y
file-type: markdown
style: github
---

# Prices, Values and Currency Rates

Portfolio 60 keeps your portfolio up to date by fetching three types of financial data:

- **Investment prices** — the current price of each share, fund or trust you hold
- **Benchmark values** — the current level of market indexes such as the FTSE 100 or S&P 500
- **Currency exchange rates** — how much foreign currency you get for one pound sterling (GBP)

This guide explains where this data comes from, how to fetch it, and how to review what has been collected.

---

## Where does the data come from?

### Investment prices

Live prices are fetched from the **Morningstar API** — the same data provider used for loading historical prices. The system looks up each investment using its Public ID (ISIN or exchange:ticker) or a previously cached Morningstar identifier, then retrieves the most recent price from Morningstar's timeseries data feed.

You do not need to configure anything beyond the Public ID on each investment. The system resolves the Morningstar identifier automatically and caches it for future fetches.

### Benchmark values

Live benchmark values are fetched from the **Yahoo Finance API** — the same data provider used for loading historical benchmark data. The system matches each benchmark to its Yahoo Finance ticker symbol automatically (for example, FTSE 100 maps to ^FTSE) and retrieves the most recent value from Yahoo's chart data feed.

You do not need to configure anything beyond the benchmark description. The system resolves the Yahoo ticker automatically and caches it for future fetches.

### Currency exchange rates

Live exchange rates are fetched from the **Frankfurter API**, which provides European Central Bank (ECB) reference rates. The rate tells you how many units of the foreign currency equal one pound sterling. For example, a USD rate of 1.2700 means £1 = $1.27.

Currency rates are always fetched before investment prices. This ensures that prices and exchange rates are captured within minutes of each other, giving you an accurate GBP valuation.

---

## Fetching current data

There are two ways to fetch the latest prices, values and rates.

### Manual fetch

From the **Fetching** page you can start a fetch at any time. The system works through each investment and benchmark one at a time, showing you the result for each as it completes. If any fail on the first attempt, the system automatically retries them before reporting the final result.

You can also fetch a single investment or benchmark price from its row on the Investments or Benchmarks page.

### Scheduled fetch

Portfolio 60 can fetch prices automatically on a schedule (for example, every Saturday morning at 8am). When enabled, the system runs the same process as a manual fetch — currency rates first, then all investment prices and benchmark values.

If the application was not running at the scheduled time (for instance, you had shut it down overnight), it will detect the missed run when you next start the application and carry out the fetch after a short delay.

Scheduled fetching is configured in the application settings.

---

## Loading historical data

When you first set up an investment, benchmark or currency, you will only have prices going forward from the date you start fetching. To get meaningful reporting and performance charts, you need historical data going back further.

The **Load History** button on each investment, benchmark and currency row fetches approximately three years of weekly historical data. Each source provides this differently:

| Data type | Historical source | Coverage |
|---|---|---|
| Investment prices | **Morningstar UK** — a financial data provider | ~3 years of weekly prices |
| Benchmark values | **Yahoo Finance** — via their public data feed | ~3 years of weekly values |
| Currency rates | **Bank of England** — official daily exchange rates | ~3 years, filtered to weekly |

Historical data is recorded on Fridays to give a consistent weekly snapshot. If a Friday falls on a bank holiday, the nearest preceding weekday is used instead.

### Load History vs Replace History

- **Load History** appears when no historical data exists for that item. Clicking it fetches three years of weekly data immediately.

- **Replace History** appears when historical data has already been loaded. Clicking it shows a confirmation prompt before proceeding, because the existing historical data will be overwritten with a fresh set. This is useful if you need to correct data or if the original load was incomplete.

The system determines which label to show by checking whether any data exists from more than six days ago. Recent data from live fetching (today or the last few days) does not count as historical — only older backfilled data triggers the "Replace" label.

You can safely use Replace History at any time. It is a self-correcting mechanism: if you set up a portfolio, start live price fetching, and later realise you need historical data for reporting, simply go back and run Replace History on each item.

---

## Viewing collected data

Each investment, benchmark and currency has a detail view where you can review the data that has been collected.

To view the detail:
- Click the **View** button on a table row, or
- Double-click the row

At the bottom of the detail view you will see a **Show price history** (or **Show value history** / **Show rate history**) checkbox. Tick it to display a compact table of the most recent records in reverse date order (newest first).

The table shows the date and the price, value or rate for each record. Above the table, a count shows the total number of records held — for example, "156 prices recorded".

If there are more records than can be shown at once, a **Load more** link appears below the table. Click it to fetch and display the next batch of records.

This viewer is useful for:
- Confirming that live price fetching is working correctly
- Checking that historical data loaded successfully
- Spotting gaps or unexpected values in the data

---

## Summary

| What | Live source | Historical source | Frequency |
|---|---|---|---|
| Investment prices | Morningstar API | Morningstar API | On demand or scheduled |
| Benchmark values | Yahoo Finance API | Yahoo Finance API | On demand or scheduled |
| Currency rates | Frankfurter API (ECB rates) | Bank of England | On demand or scheduled |

All data is stored locally in your database. No account or login is needed with any of these external services — they all provide public data freely.
