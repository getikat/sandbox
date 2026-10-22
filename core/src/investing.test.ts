import { describe, expect, it } from "vitest";
import {
  classifySecurity,
  expenseRatio,
  timeWeightedReturn,
  xirr,
  displayTicker,
  looksLikeCompany,
  sharesPerUnit,
  OPTION_SYMBOL,
} from "./investing";

describe("displayTicker", () => {
  it("reads option symbols", () => {
    expect(displayTicker("ABCD271217C00020000")).toBe("ABCD 20C 12/17/27");
    expect(displayTicker("SPY260116P00512500")).toBe("SPY 512.5P 01/16/26");
    expect(displayTicker("CUR:BTC")).toBe("BTC");
  });
});

describe("classification", () => {
  it("looks through curated funds, trusts the type for single securities, and never guesses a fund", () => {
    expect(classifySecurity({ ticker: "VTI", type: "etf" }).mix).toEqual({
      us_stock: 1,
    });
    expect(
      classifySecurity({ ticker: "FDKLX", type: "mutual fund" }).mix.bonds,
    ).toBeCloseTo(0.1);
    expect(
      classifySecurity({ ticker: "CUR:BTC", type: "cryptocurrency" }).mix,
    ).toEqual({ crypto: 1 });
    // Robinhood flags coins as cash equivalents; they are still crypto.
    expect(
      classifySecurity({
        ticker: "SHIB",
        type: "cryptocurrency",
        isCashEquivalent: true,
      }).mix,
    ).toEqual({ crypto: 1 });
    expect(classifySecurity({ ticker: "AAPL", type: "equity" }).mix).toEqual({
      us_stock: 1,
    });
    expect(
      classifySecurity({ ticker: "XYZFX", type: "mutual fund" }).mix,
    ).toEqual({ unclassified: 1 });
    expect(expenseRatio("fxaix")).toBe(0.00015);
  });
});

describe("returns", () => {
  it("time-weighted return ignores the size and timing of deposits", () => {
    // 10% on 1000, then a 1000 deposit, then 10% on 2100.
    const values = [
      { date: "2026-01-01", cents: 100_000 },
      { date: "2026-02-01", cents: 110_000 },
      { date: "2026-02-02", cents: 210_000 },
      { date: "2026-03-01", cents: 231_000 },
    ];
    const twr = timeWeightedReturn(values, [
      { date: "2026-02-02", cents: 100_000 },
    ]);
    expect(twr).toBeCloseTo(0.21, 6);
  });

  it("money-weighted return solves a simple one-year case", () => {
    const r = xirr([
      { date: "2025-01-01", cents: -100_000 },
      { date: "2026-01-01", cents: 110_000 },
    ]);
    expect(r).toBeCloseTo(0.1, 3);
  });

  it("returns null when there is nothing to solve", () => {
    expect(xirr([{ date: "2025-01-01", cents: -100 }])).toBeNull();
  });
});

describe("options", () => {
  it("recognises OCC symbols and contracts reported per contract", () => {
    expect(OPTION_SYMBOL.test("ABCD271217C00022000")).toBe(true);
    expect(OPTION_SYMBOL.test("AAPL")).toBe(false);
    // Robinhood: 3 contracts at $500 each, $5.10 a share on the market.
    expect(sharesPerUnit({ type: "derivative", closePrice: 5.1 }, 50_000)).toBe(
      100,
    );
    // Reported per share already.
    expect(sharesPerUnit({ type: "derivative", closePrice: 5.1 }, 500)).toBe(1);
    expect(sharesPerUnit({ type: "equity", closePrice: 5.1 }, 50_000)).toBe(1);
  });
});

describe("what a security is", () => {
  it("tells a company typed as a fund from a real fund", () => {
    expect(looksLikeCompany("Energy Transfer LP - Unit")).toBe(true);
    expect(looksLikeCompany("Brookfield Infrastructure Partners LP")).toBe(
      true,
    );
    expect(
      looksLikeCompany(
        "Vanguard Whitehall Funds - Vanguard High Dividend Yield Indx ETF",
      ),
    ).toBe(false);
    expect(
      looksLikeCompany(
        "Fidelity Salem Street Trust - Fidelity Global ex U.S. Index Fd USD",
      ),
    ).toBe(false);
    expect(looksLikeCompany("Fidelity Contrafund")).toBe(false);
  });

  it("files an option under other, never unclassified", () => {
    expect(
      classifySecurity({ ticker: "ABCD271217C00020000", type: "derivative" }),
    ).toEqual({ mix: { other: 1 }, source: "type" });
  });
});
