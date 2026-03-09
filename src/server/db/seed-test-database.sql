-- ============================================================================
-- Test Database Seed Data
-- ============================================================================
-- Creates all reference data for the test database: currencies, investments,
-- benchmarks, users, accounts, holdings, and opening cash transactions.
--
-- Prerequisites:
--   - Database created via createDatabase() (schema.sql + seed.sql applied)
--   - Migrations have run (investment_types, GBP currency already exist)
--
-- Investment types (from seed.sql):
--   id=1 SHARE, id=2 MUTUAL, id=3 TRUST, id=4 SAVINGS, id=5 OTHER
--
-- Usage: Called by seed-test-database.js script
-- ============================================================================

-- ============================================================================
-- CURRENCIES
-- GBP (id=1) already exists from seed.sql
-- ============================================================================

INSERT INTO currencies (code, description) VALUES
    ('USD', 'US Dollar'),
    ('EUR', 'Euro');

-- ============================================================================
-- INVESTMENTS — GBP Mutual Funds (FT Markets via ISIN)
-- auto_scrape defaults to 1; selector NULL = use site config from settings
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 2, 'Fundsmith Equity I Acc', 'GB00B41YBW71'),
    (1, 2, 'Vanguard LifeStrategy 80% Equity Acc', 'GB00B4PQW151'),
    (1, 2, 'Vanguard FTSE Global All Cap Index', 'GB00BD3RZ582'),
    (1, 2, 'Fidelity Index World P Acc', 'GB00BJS8SJ34'),
    (1, 2, 'L&G Global Technology Index C Acc', 'GB00BJLP1W53'),
    (1, 2, 'Rathbone Global Opportunities S Acc', 'GB00BH0P2M97'),
    (1, 2, 'Baillie Gifford American B Acc', 'GB0006061963'),
    (1, 2, 'Jupiter Gold & Silver L Acc', 'IE00BYVJRB33');

-- ============================================================================
-- INVESTMENTS — GBP Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 1, 'Rolls-Royce Holdings PLC', 'LSE:RR.'),
    (1, 1, 'BAE Systems PLC', 'LSE:BA.'),
    (1, 1, 'AstraZeneca PLC', 'LSE:AZN'),
    (1, 1, 'Shell PLC', 'LSE:SHEL'),
    (1, 1, 'Raspberry Pi Holdings PLC', 'LSE:RPI'),
    (1, 1, 'Barclays PLC', 'LSE:BARC'),
    (1, 1, 'Legal & General Group PLC', 'LSE:LGEN');

-- ============================================================================
-- INVESTMENTS — GBP Investment Trusts (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 3, 'Polar Capital Technology Trust', 'LSE:PCT');

-- ============================================================================
-- INVESTMENTS — USD Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (2, 1, 'NVIDIA Corp', 'NSQ:NVDA'),
    (2, 1, 'Microsoft Corp', 'NSQ:MSFT'),
    (2, 1, 'Alphabet Inc Class C', 'NSQ:GOOG'),
    (2, 1, 'Amazon.com Inc', 'NSQ:AMZN'),
    (2, 1, 'Berkshire Hathaway Class B', 'NYQ:BRK.B');

-- ============================================================================
-- INVESTMENTS — EUR Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (3, 1, 'ASML Holding NV', 'AEX:ASML');

-- ============================================================================
-- BENCHMARKS
-- All use FT Markets with auto-detected selectors from site config.
-- yahoo_ticker populated for historic backfill via Yahoo Finance API.
-- ============================================================================

INSERT INTO benchmarks (currencies_id, benchmark_type, description, benchmark_url, selector) VALUES
    (1, 'index', 'FTSE 100',
     'https://www.google.com/finance/quote/UKX:INDEXFTSE', NULL),
    (1, 'index', 'FTSE 250',
     'https://www.google.com/finance/quote/MCX:INDEXFTSE', NULL),
     (1, 'index', 'FTSE All Share',
      'https://www.google.com/finance/quote/ASX:INDEXFTSE', NULL),
    (2, 'index', 'S&P 500',
     'https://www.google.com/finance/quote/INX:INDEXSP', NULL),
    (2, 'index', 'Dow Jones',
     'https://www.google.com/finance/quote/DJI:INDEXDJX', NULL),
     (2, 'index', 'Nasdaq',
      'https://www.google.com/finance/quote/IXIC:INDEXNASDAQ', NULL);

-- ============================================================================
-- USERS
-- Two family members, both with Interactive Investor (ii) accounts.
-- NI numbers and UTRs are fictitious test data.
-- ============================================================================

INSERT INTO users (initials, first_name, last_name, ni_number, utr, provider, trading_ref, isa_ref, sipp_ref) VALUES
    ('BW', 'Ben',    'Wilson', 'YP439593D', '1023143571', 'ii', '3366524', '3366527', '3366521'),
    ('AW', 'Alexis', 'Wilson', 'XP275366T', '1044722194', 'ii', '3633173', '3633174', '3633175');

-- ============================================================================
-- ACCOUNTS
-- Each user has trading, ISA and SIPP accounts.
-- cash_balance and warn_cash are stored as GBP × 10000.
-- ============================================================================

INSERT INTO accounts (user_id, account_type, account_ref, cash_balance, warn_cash) VALUES
    (1, 'sipp',    '3366521', 48500000, 20000000),
    (1, 'isa',     '3366527',  9857500,  1500000),
    (1, 'trading', '3366524', 17500000,  1500000),
    (2, 'sipp',    '3633175', 36540000, 16000000),
    (2, 'trading', '3633173',  2140000,  1500000),
    (2, 'isa',     '3633174',  7880000,  1500000);

-- ============================================================================
-- HOLDINGS
-- Links accounts to investments. quantity and average_cost are × 10000.
-- Investment IDs are sequential from id=1 (first INSERT block above).
--
-- Investment ID reference (from INSERT order above):
--   1  = Fundsmith Equity I Acc
--   2  = Vanguard LifeStrategy 80% Equity Acc
--   3  = Vanguard FTSE Global All Cap Index
--   4  = Fidelity Index World P Acc
--   5  = L&G Global Technology Index C Acc
--   6  = Rathbone Global Opportunities S Acc
--   7  = Baillie Gifford American B Acc
--   8  = Jupiter Gold & Silver L Acc
--   9  = Rolls-Royce Holdings PLC
--  10  = BAE Systems PLC
--  11  = AstraZeneca PLC
--  12  = Shell PLC
--  13  = Raspberry Pi Holdings PLC
--  14  = Barclays PLC
--  15  = Legal & General Group PLC
--  16  = Polar Capital Technology Trust
--  17  = NVIDIA Corp
--  18  = Microsoft Corp
--  19  = Alphabet Inc Class C
--  20  = Amazon.com Inc
--  21  = Berkshire Hathaway Class B
--  22  = ASML Holding NV
-- ============================================================================

-- Ben SIPP (account 1): VG Global All Cap, VG LifeStrategy, Rathbone, BG American
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (1,  3,   6250000,  372600),
    (1,  2,   3500000,  294500),
    (1,  6,   1375000,   19100),
    (1,  7,  27500000,  132700);

-- Ben ISA (account 2): Fidelity Index World, Jupiter Gold & Silver, Polar Capital Tech
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (2,  4,  13750000000000,  31500),
    (2,  8,   4550000, 357200),
    (2, 16,  59000000,  49200);

-- Ben Trading (account 3): Alphabet, NVIDIA, Microsoft
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (3, 19,  1800000,  649870),
    (3, 17,  1050000,  150990),
    (3, 18, 1250000, 1045100);

-- Alexis SIPP (account 4): VG LifeStrategy, L&G Tech, Fidelity Index World
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (4,  2,   4150000,  163500),
    (4,  5, 132400000,   16480),
    (4,  4, 114550000,   31100);

-- Alexis Trading (account 5): Polar Capital Tech, Amazon, BG American
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (5, 16, 75650000,  35100),
    (5, 20,   5150000, 359280),
    (5,  7,  36000000, 118500);

-- Alexis ISA (account 6): Jupiter Gold & Silver, Rathbone, VG Global All Cap
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
    (6,  8,   4170000, 363700),
    (6,  6, 65000000,  19300),
    (6,  3,   4900000, 352800);

-- ============================================================================
-- CASH TRANSACTIONS — Opening balance deposits
-- ============================================================================

INSERT INTO cash_transactions (account_id, transaction_type, transaction_date, amount, notes) VALUES
    (1, 'deposit', '2026-03-02', 48500000, 'Opening balance'),
    (2, 'deposit', '2026-03-02',  9857500, 'Opening balance'),
    (3, 'deposit', '2026-03-02', 17500000, 'Opening balance'),
    (4, 'deposit', '2026-03-02', 36540000, 'Opening balance'),
    (5, 'deposit', '2026-03-02',  2140000, 'Opening balance'),
    (6, 'deposit', '2026-03-02',  7880000, 'Opening balance');
