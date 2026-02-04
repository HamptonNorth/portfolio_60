-- Portfolio 60 database schema (v0.1.0)
-- SQLite with WAL mode, foreign keys enforced via PRAGMA

-- Users: family members with provider account details
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    initials TEXT NOT NULL CHECK(length(initials) <= 5),
    first_name TEXT NOT NULL CHECK(length(first_name) <= 30),
    last_name TEXT NOT NULL CHECK(length(last_name) <= 30),
    ni_number TEXT CHECK(ni_number IS NULL OR length(ni_number) <= 9),
    utr TEXT CHECK(utr IS NULL OR length(utr) <= 15),
    provider TEXT NOT NULL CHECK(length(provider) <= 5),
    trading_ref TEXT CHECK(trading_ref IS NULL OR length(trading_ref) <= 15),
    isa_ref TEXT CHECK(isa_ref IS NULL OR length(isa_ref) <= 15),
    sipp_ref TEXT CHECK(sipp_ref IS NULL OR length(sipp_ref) <= 15)
);

-- Investment types: hard-coded categories (seeded, no CRUD UI)
CREATE TABLE IF NOT EXISTS investment_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_description TEXT NOT NULL CHECK(length(short_description) <= 8),
    description TEXT NOT NULL CHECK(length(description) <= 30),
    usage_notes TEXT CHECK(usage_notes IS NULL OR length(usage_notes) <= 240)
);

-- Currencies: GBP is the base currency, others added by user
CREATE TABLE IF NOT EXISTS currencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE CHECK(length(code) = 3),
    description TEXT NOT NULL CHECK(length(description) <= 30)
);

-- Investments: tracked financial instruments
CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    investment_type_id INTEGER NOT NULL,
    description TEXT NOT NULL CHECK(length(description) <= 60),
    investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 120),
    FOREIGN KEY (currencies_id) REFERENCES currencies(id),
    FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
);

-- Currency rates: exchange rates to GBP, stored as integer x 10000
CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    rate_date TEXT NOT NULL,
    rate INTEGER NOT NULL,
    FOREIGN KEY (currencies_id) REFERENCES currencies(id),
    UNIQUE(currencies_id, rate_date)
);

-- Global events: notable dates for investment context
CREATE TABLE IF NOT EXISTS global_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date TEXT NOT NULL,
    description TEXT NOT NULL CHECK(length(description) <= 255)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_rates(currencies_id, rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_investments_type ON investments(investment_type_id);
CREATE INDEX IF NOT EXISTS idx_investments_currency ON investments(currencies_id);
CREATE INDEX IF NOT EXISTS idx_global_events_date ON global_events(event_date DESC);
