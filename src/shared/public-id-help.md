# Public ID Formats

The Public ID field identifies your investment for automatic price URL generation
on FT Markets and for Morningstar historic price lookups.

Three formats are supported:

## ISIN (Mutual Funds)

A 12-character International Securities Identification Number, starting with a
2-letter country code.

**Examples:** `GB00B4PQW151`, `IE00B5BMR087`, `LU1033663649`

You can find the ISIN on the fund factsheet or on websites like Morningstar or
FT Markets. ISINs generate a URL like:
`https://markets.ft.com/data/funds/tearsheet/summary?s=GB00B4PQW151:GBP`

## Exchange:Ticker (Shares and Investment Trusts)

The FT Markets exchange code and ticker symbol separated by a colon.

**Examples:** `LSE:AZN`, `NSQ:AMZN`, `NYQ:KO`, `LSE:SSON`

Common FT Markets exchange codes:
- **LSE** - London Stock Exchange
- **NSQ** - NASDAQ
- **NYQ** - New York Stock Exchange (NYSE)
- **AEX** - Euronext Amsterdam

The exchange and ticker are reversed when building the FT Markets URL:
`LSE:AZN` generates `https://markets.ft.com/data/equities/tearsheet/summary?s=AZN:LSE`

## Ticker:Exchange:Currency (ETFs)

Three parts separated by colons: the ETF ticker, exchange, and price currency.

**Examples:** `ISF:LSE:GBX`, `IH2O:LSE:GBX`, `VUSA:LSE:GBP`

The currency part is typically **GBX** (pence) or **GBP** (pounds) for UK-listed
ETFs. Check the FT Markets page to confirm which currency applies.

ETF codes generate a URL like:
`https://markets.ft.com/data/etfs/tearsheet/summary?s=ISF:LSE:GBX`

## When to Leave Blank

Leave the Public ID blank for savings accounts or other investments that do not
have a public price page on FT Markets. You can still enter a manual URL and CSS
selector for these investments.

## Manual URL Override

If you enter both a Public ID and a manual Price Page URL, the manual URL takes
priority for price scraping. The Public ID is still used for Morningstar historic
data lookups.
