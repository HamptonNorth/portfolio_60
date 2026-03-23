import { describe, test, expect } from "bun:test";
import { parsePortfolioParam, buildSeriesLabel } from "../../src/server/services/portfolio-chart-data-service.js";
import { generateFortnightlyDates, formatISODate } from "../../src/server/services/price-utils.js";

// --- parsePortfolioParam ---

describe("parsePortfolioParam", function () {
  test("parses single user single account type", function () {
    var result = parsePortfolioParam("BW:ISA");
    expect(result).not.toBeNull();
    expect(result.userInitials).toEqual(["BW"]);
    expect(result.accountTypes).toEqual(["isa"]);
  });

  test("parses single user multiple account types", function () {
    var result = parsePortfolioParam("BW:isa+sipp+trading");
    expect(result).not.toBeNull();
    expect(result.userInitials).toEqual(["BW"]);
    expect(result.accountTypes).toEqual(["isa", "sipp", "trading"]);
  });

  test("parses multiple users single account type", function () {
    var result = parsePortfolioParam("BW+AW:sipp");
    expect(result).not.toBeNull();
    expect(result.userInitials).toEqual(["BW", "AW"]);
    expect(result.accountTypes).toEqual(["sipp"]);
  });

  test("parses multiple users multiple account types", function () {
    var result = parsePortfolioParam("BW+AW:isa+sipp+trading");
    expect(result).not.toBeNull();
    expect(result.userInitials).toEqual(["BW", "AW"]);
    expect(result.accountTypes).toEqual(["isa", "sipp", "trading"]);
  });

  test("uppercases user initials", function () {
    var result = parsePortfolioParam("bw:isa");
    expect(result.userInitials).toEqual(["BW"]);
  });

  test("lowercases account types", function () {
    var result = parsePortfolioParam("BW:ISA+SIPP");
    expect(result.accountTypes).toEqual(["isa", "sipp"]);
  });

  test("returns null for missing colon", function () {
    expect(parsePortfolioParam("BW-ISA")).toBeNull();
  });

  test("returns null for empty input", function () {
    expect(parsePortfolioParam("")).toBeNull();
    expect(parsePortfolioParam(null)).toBeNull();
  });

  test("returns null for empty user part", function () {
    expect(parsePortfolioParam(":isa")).toBeNull();
  });

  test("returns null for empty account part", function () {
    expect(parsePortfolioParam("BW:")).toBeNull();
  });
});

// --- buildSeriesLabel ---

describe("buildSeriesLabel", function () {
  test("single user single account type", function () {
    expect(buildSeriesLabel(["Ben Wilson"], ["isa"])).toBe("Ben Wilson (ISA)");
  });

  test("single user all account types", function () {
    expect(buildSeriesLabel(["Ben Wilson"], ["isa", "sipp", "trading"])).toBe("Ben Wilson (All accounts)");
  });

  test("single user two account types", function () {
    expect(buildSeriesLabel(["Ben Wilson"], ["isa", "sipp"])).toBe("Ben Wilson (ISA + SIPP)");
  });

  test("multiple users shows Combined", function () {
    expect(buildSeriesLabel(["Ben Wilson", "Alexis Wilson"], ["isa", "sipp", "trading"])).toBe("Combined (All accounts)");
  });

  test("multiple users single account type", function () {
    expect(buildSeriesLabel(["Ben Wilson", "Alexis Wilson"], ["sipp"])).toBe("Combined (SIPP)");
  });
});

// --- generateFortnightlyDates ---

describe("generateFortnightlyDates", function () {
  test("produces 14-day intervals", function () {
    var start = new Date("2025-01-01");
    var end = new Date("2025-03-01");
    var dates = generateFortnightlyDates(start, end);

    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0]).toBe("2025-01-01");

    // Check interval between first two dates is 14 days
    var d1 = new Date(dates[0]);
    var d2 = new Date(dates[1]);
    var diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(14);
  });

  test("includes the end date", function () {
    var start = new Date("2025-01-01");
    var end = new Date("2025-02-15");
    var dates = generateFortnightlyDates(start, end);

    expect(dates[dates.length - 1]).toBe("2025-02-15");
  });

  test("produces fewer points than weekly for same range", async function () {
    var start = new Date("2024-01-01");
    var end = new Date("2026-01-01");

    // Import generateWeeklyDates for comparison
    var { generateWeeklyDates } = await import("../../src/server/services/price-utils.js");
    var weeklyDates = generateWeeklyDates(start, end);
    var fortnightlyDates = generateFortnightlyDates(start, end);

    expect(fortnightlyDates.length).toBeLessThan(weeklyDates.length);
    // Fortnightly should be roughly half of weekly
    expect(fortnightlyDates.length).toBeGreaterThan(weeklyDates.length * 0.4);
    expect(fortnightlyDates.length).toBeLessThan(weeklyDates.length * 0.6);
  });
});
