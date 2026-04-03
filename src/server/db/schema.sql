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
    auto_fetch INTEGER NOT NULL DEFAULT 1,
    morningstar_id TEXT,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    replaced INTEGER NOT NULL DEFAULT 0,
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
    yahoo_ticker TEXT,
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

-- Fetch history: log of all fetch attempts for monitoring
CREATE TABLE IF NOT EXISTS fetch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetch_type TEXT NOT NULL CHECK(fetch_type IN ('currency', 'investment', 'benchmark')),
    reference_id INTEGER NOT NULL,
    fetch_datetime TEXT NOT NULL,
    started_by INTEGER NOT NULL DEFAULT 0,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    success INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT
);

-- Accounts: user investment accounts (trading, ISA, SIPP)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_type TEXT NOT NULL CHECK(account_type IN ('trading', 'isa', 'sipp')),
    account_ref TEXT NOT NULL CHECK(length(account_ref) <= 15),
    cash_balance INTEGER NOT NULL DEFAULT 0,
    warn_cash INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, account_type)
);

-- Holdings: investment positions within an account (SCD2 — temporal history)
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    investment_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    average_cost INTEGER NOT NULL DEFAULT 0,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (investment_id) REFERENCES investments(id),
    UNIQUE(account_id, investment_id, effective_from)
);

-- Cash transactions: deposits, withdrawals, drawdowns and adjustments (future UI)
CREATE TABLE IF NOT EXISTS cash_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    holding_movement_id INTEGER,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('deposit', 'withdrawal', 'drawdown', 'adjustment', 'buy', 'sell')),
    transaction_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    balance_after INTEGER,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (holding_movement_id) REFERENCES holding_movements(id)
);

-- Holding movements: buy, sell and adjustment transactions (future UI)
CREATE TABLE IF NOT EXISTS holding_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holding_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL CHECK(movement_type IN ('buy', 'sell', 'adjustment', 'replacement')),
    movement_date TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    movement_value INTEGER NOT NULL,
    book_cost INTEGER NOT NULL DEFAULT 0,
    deductible_costs INTEGER NOT NULL DEFAULT 0,
    revised_avg_cost INTEGER NOT NULL DEFAULT 0,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    FOREIGN KEY (holding_id) REFERENCES holdings(id)
);

-- Drawdown schedules: recurring SIPP pension withdrawals
CREATE TABLE IF NOT EXISTS drawdown_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'annually')),
    trigger_day INTEGER NOT NULL CHECK(trigger_day >= 1 AND trigger_day <= 28),
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- Other assets: non-portfolio financial assets (pensions, property, savings, alternatives)
CREATE TABLE IF NOT EXISTS other_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    description TEXT NOT NULL CHECK(length(description) <= 40),
    category TEXT NOT NULL CHECK(category IN ('pension', 'property', 'savings', 'alternative')),
    value_type TEXT NOT NULL CHECK(value_type IN ('recurring', 'value')),
    frequency TEXT CHECK(frequency IS NULL OR frequency IN ('weekly', 'fortnightly', '4_weeks', 'monthly', 'quarterly', '6_monthly', 'annually')),
    value INTEGER NOT NULL DEFAULT 0,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 60),
    executor_reference TEXT CHECK(executor_reference IS NULL OR length(executor_reference) <= 80),
    last_updated TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Other assets history: tracks changes to value, notes, and executor_reference
CREATE TABLE IF NOT EXISTS other_assets_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    other_asset_id INTEGER NOT NULL,
    change_date TEXT NOT NULL,
    revised_value INTEGER NOT NULL,
    revised_notes TEXT CHECK(revised_notes IS NULL OR length(revised_notes) <= 80),
    revised_executor_reference TEXT CHECK(revised_executor_reference IS NULL OR length(revised_executor_reference) <= 80),
    FOREIGN KEY (other_asset_id) REFERENCES other_assets(id) ON DELETE CASCADE
);

-- Scheduler log: timestamped log entries from the scheduled fetcher
CREATE TABLE IF NOT EXISTS scheduler_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_datetime TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
    message TEXT NOT NULL
);

-- Daily visitors: anonymous aggregate visitor counts per day
-- No PII stored — only totals, split by Accept-Language preference
CREATE TABLE IF NOT EXISTS daily_visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_date TEXT NOT NULL UNIQUE,
    en_gb_count INTEGER NOT NULL DEFAULT 0,
    other_count INTEGER NOT NULL DEFAULT 0
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
CREATE INDEX IF NOT EXISTS idx_fetch_history_datetime ON fetch_history(fetch_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_history_type_ref ON fetch_history(fetch_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_investment ON holdings(investment_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON cash_transactions(account_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_holding_movements_holding ON holding_movements(holding_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_drawdown_schedules_account ON drawdown_schedules(account_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_user ON other_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_other_assets_category ON other_assets(category);
CREATE INDEX IF NOT EXISTS idx_other_assets_history_asset ON other_assets_history(other_asset_id, change_date DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_log_datetime ON scheduler_log(log_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_daily_visitors_date ON daily_visitors(visit_date DESC);
