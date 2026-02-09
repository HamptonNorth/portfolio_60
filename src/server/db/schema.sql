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
    public_id TEXT CHECK(public_id IS NULL OR length(public_id) <= 20),
    investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
    FOREIGN KEY (currencies_id) REFERENCES currencies(id),
    FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
);

-- Currency rates: exchange rates to GBP, stored as integer x 10000
CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    rate_date TEXT NOT NULL,
    rate_time TEXT NOT NULL DEFAULT '00:00:00',
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

-- Benchmarks: indices and reference prices for performance comparison
CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    benchmark_type TEXT NOT NULL CHECK(benchmark_type IN ('index', 'price')),
    description TEXT NOT NULL CHECK(length(description) <= 60),
    benchmark_url TEXT CHECK(benchmark_url IS NULL OR length(benchmark_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
    FOREIGN KEY (currencies_id) REFERENCES currencies(id)
);

-- Prices: historical investment prices, stored as integer x 10000
CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    price_time TEXT NOT NULL DEFAULT '00:00:00',
    price INTEGER NOT NULL,
    FOREIGN KEY (investment_id) REFERENCES investments(id),
    UNIQUE(investment_id, price_date)
);

-- Benchmark data: historical benchmark values, stored as integer x 10000
CREATE TABLE IF NOT EXISTS benchmark_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    benchmark_date TEXT NOT NULL,
    benchmark_time TEXT NOT NULL DEFAULT '00:00:00',
    value INTEGER NOT NULL,
    FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id),
    UNIQUE(benchmark_id, benchmark_date)
);

-- Scraping history: log of all scrape attempts for monitoring
CREATE TABLE IF NOT EXISTS scraping_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_type TEXT NOT NULL CHECK(scrape_type IN ('currency', 'investment', 'benchmark')),
    reference_id INTEGER NOT NULL,
    scrape_datetime TEXT NOT NULL,
    started_by INTEGER NOT NULL DEFAULT 0,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    success INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT
);

-- Test investments: sandbox for testing scraper configurations (Phase B, v0.4.0)
CREATE TABLE IF NOT EXISTS test_investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    investment_type_id INTEGER NOT NULL,
    description TEXT NOT NULL CHECK(length(description) <= 60),
    public_id TEXT CHECK(public_id IS NULL OR length(public_id) <= 20),
    investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
    source_site TEXT CHECK(source_site IS NULL OR length(source_site) <= 60),
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    last_test_date TEXT,
    last_test_success INTEGER,
    last_test_price TEXT,
    FOREIGN KEY (currencies_id) REFERENCES currencies(id),
    FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
);

-- Test prices: scraped prices from test investments (kept for comparison)
CREATE TABLE IF NOT EXISTS test_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_investment_id INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    price_time TEXT NOT NULL DEFAULT '00:00:00',
    price INTEGER NOT NULL,
    FOREIGN KEY (test_investment_id) REFERENCES test_investments(id) ON DELETE CASCADE,
    UNIQUE(test_investment_id, price_date)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_rates(currencies_id, rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_investments_type ON investments(investment_type_id);
CREATE INDEX IF NOT EXISTS idx_investments_currency ON investments(currencies_id);
CREATE INDEX IF NOT EXISTS idx_global_events_date ON global_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_benchmarks_type ON benchmarks(benchmark_type);
CREATE INDEX IF NOT EXISTS idx_benchmarks_currency ON benchmarks(currencies_id);
CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices(investment_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_data_lookup ON benchmark_data(benchmark_id, benchmark_date DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_history_datetime ON scraping_history(scrape_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_history_type_ref ON scraping_history(scrape_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_test_prices_lookup ON test_prices(test_investment_id, price_date DESC);
