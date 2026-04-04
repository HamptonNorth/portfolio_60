-- Delete corrupted prices fetched with bad morningstar_id universe suffixes
-- Usage: sqlite3 portfolio60.db < fix-delete-todays-prices.sql

DELETE FROM prices WHERE price_date > '2026-03-30';
