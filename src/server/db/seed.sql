-- Portfolio 60 seed data (v0.1.0)
-- Investment types and base currency (GBP)

-- Investment types (hard-coded, no CRUD UI)
INSERT INTO investment_types (short_description, description, usage_notes) VALUES
    ('SHARE', 'Shares', 'Individual company shares listed on a stock exchange'),
    ('MUTUAL', 'Mutual Funds', 'Pooled investment funds managed by a fund manager'),
    ('TRUST', 'Investment Trusts', 'Closed-ended funds listed on a stock exchange'),
    ('SAVINGS', 'Savings Accounts', 'Bank or building society savings accounts'),
    ('OTHER', 'Other', 'Any other investment type not covered above');

-- Base currency (always GBP for a UK portfolio tracker)
INSERT INTO currencies (code, description) VALUES
    ('GBP', 'British Pound Sterling');

-- Joint user: represents jointly held assets (property, cars, etc.)
INSERT INTO users (initials, first_name, last_name, provider) VALUES
    ('JNT', 'Joint', 'Household', '-');
