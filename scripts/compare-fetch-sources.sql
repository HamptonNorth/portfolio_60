-- Compare Fetch Sources
-- Run against the main Portfolio 60 database after both a local Fetch All
-- and a Sync from Fetch Server have been performed on the same day.
--
-- Compares the latest price/rate/value from the main app's tables against
-- what the fetch server returned (synced into the same tables with time '00:00:00').
--
-- Usage: Open in Beekeeper Studio and run each query separately.

-- ============================================================================
-- 1. Currency Rates — compare latest local fetch vs fetch server sync
-- ============================================================================
-- Local fetches have a real time (e.g. '08:10:23'), synced data has '00:00:00'.

SELECT
    c.code AS currency,
    c.description,
    local_r.rate_date AS local_date,
    local_r.rate / 10000.0 AS local_rate,
    sync_r.rate_date AS server_date,
    sync_r.rate / 10000.0 AS server_rate,
    CASE
        WHEN local_r.rate IS NULL THEN 'NO LOCAL'
        WHEN sync_r.rate IS NULL THEN 'NO SERVER'
        WHEN local_r.rate = sync_r.rate AND local_r.rate_date = sync_r.rate_date THEN 'MATCH'
        WHEN local_r.rate = sync_r.rate THEN 'RATE MATCH (date differs)'
        ELSE 'MISMATCH: ' || ROUND((sync_r.rate - local_r.rate) / 10000.0, 4)
    END AS comparison
FROM currencies c
LEFT JOIN (
    SELECT cr1.currencies_id, cr1.rate_date, cr1.rate
    FROM currency_rates cr1
    WHERE cr1.rate_time != '00:00:00'
      AND cr1.rate_date = (
          SELECT MAX(cr2.rate_date) FROM currency_rates cr2
          WHERE cr2.currencies_id = cr1.currencies_id AND cr2.rate_time != '00:00:00'
      )
) local_r ON local_r.currencies_id = c.id
LEFT JOIN (
    SELECT cr1.currencies_id, cr1.rate_date, cr1.rate
    FROM currency_rates cr1
    WHERE cr1.rate_time = '00:00:00'
      AND cr1.rate_date = (
          SELECT MAX(cr2.rate_date) FROM currency_rates cr2
          WHERE cr2.currencies_id = cr1.currencies_id AND cr2.rate_time = '00:00:00'
      )
) sync_r ON sync_r.currencies_id = c.id
WHERE c.code != 'GBP'
ORDER BY c.code;

-- ============================================================================
-- 2. Investment Prices — compare latest local fetch vs fetch server sync
-- ============================================================================

SELECT
    i.description AS investment,
    c.code AS currency,
    i.morningstar_id,
    local_p.price_date AS local_date,
    local_p.price / 1000000.0 AS local_price_pence,
    sync_p.price_date AS server_date,
    sync_p.price / 1000000.0 AS server_price_pence,
    CASE
        WHEN local_p.price IS NULL THEN 'NO LOCAL'
        WHEN sync_p.price IS NULL THEN 'NO SERVER'
        WHEN local_p.price = sync_p.price AND local_p.price_date = sync_p.price_date THEN 'MATCH'
        WHEN local_p.price = sync_p.price THEN 'PRICE MATCH (date differs)'
        ELSE 'MISMATCH: ' || ROUND((sync_p.price - local_p.price) / 1000000.0, 4)
    END AS comparison
FROM investments i
JOIN currencies c ON i.currencies_id = c.id
LEFT JOIN (
    SELECT p1.investment_id, p1.price_date, p1.price
    FROM prices p1
    WHERE p1.price_time != '00:00:00'
      AND p1.price_date = (
          SELECT MAX(p2.price_date) FROM prices p2
          WHERE p2.investment_id = p1.investment_id AND p2.price_time != '00:00:00'
      )
) local_p ON local_p.investment_id = i.id
LEFT JOIN (
    SELECT p1.investment_id, p1.price_date, p1.price
    FROM prices p1
    WHERE p1.price_time = '00:00:00'
      AND p1.price_date = (
          SELECT MAX(p2.price_date) FROM prices p2
          WHERE p2.investment_id = p1.investment_id AND p2.price_time = '00:00:00'
      )
) sync_p ON sync_p.investment_id = i.id
WHERE i.auto_fetch = 1
ORDER BY i.description;

-- ============================================================================
-- 3. Benchmark Values — compare latest local fetch vs fetch server sync
-- ============================================================================

SELECT
    b.description AS benchmark,
    b.benchmark_type AS type,
    b.yahoo_ticker,
    local_b.benchmark_date AS local_date,
    local_b.value / 10000.0 AS local_value,
    sync_b.benchmark_date AS server_date,
    sync_b.value / 10000.0 AS server_value,
    CASE
        WHEN local_b.value IS NULL THEN 'NO LOCAL'
        WHEN sync_b.value IS NULL THEN 'NO SERVER'
        WHEN local_b.value = sync_b.value AND local_b.benchmark_date = sync_b.benchmark_date THEN 'MATCH'
        WHEN local_b.value = sync_b.value THEN 'VALUE MATCH (date differs)'
        ELSE 'MISMATCH: ' || ROUND((sync_b.value - local_b.value) / 10000.0, 4)
    END AS comparison
FROM benchmarks b
LEFT JOIN (
    SELECT bd1.benchmark_id, bd1.benchmark_date, bd1.value
    FROM benchmark_data bd1
    WHERE bd1.benchmark_time != '00:00:00'
      AND bd1.benchmark_date = (
          SELECT MAX(bd2.benchmark_date) FROM benchmark_data bd2
          WHERE bd2.benchmark_id = bd1.benchmark_id AND bd2.benchmark_time != '00:00:00'
      )
) local_b ON local_b.benchmark_id = b.id
LEFT JOIN (
    SELECT bd1.benchmark_id, bd1.benchmark_date, bd1.value
    FROM benchmark_data bd1
    WHERE bd1.benchmark_time = '00:00:00'
      AND bd1.benchmark_date = (
          SELECT MAX(bd2.benchmark_date) FROM benchmark_data bd2
          WHERE bd2.benchmark_id = bd1.benchmark_id AND bd2.benchmark_time = '00:00:00'
      )
) sync_b ON sync_b.benchmark_id = b.id
ORDER BY b.description;
