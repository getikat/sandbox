import { describe, expect, it } from "vitest";
import {
  parseAmount,
  parseCsv,
  parseDate,
  readCsv,
  readOfx,
  readStatement,
} from "./importers";

describe("csv", () => {
  it("parses quoted fields, BOMs and CRLF", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("reads amounts and dates the way banks write them", () => {
    expect(parseAmount("$1,234.56")).toBe(123_456);
    expect(parseAmount("(12.34)")).toBe(-1_234);
    expect(parseAmount("12.34-")).toBe(-1_234);
    expect(parseAmount("abc")).toBeNull();
    expect(parseDate("09/15/2026")).toBe("2026-09-15");
    expect(parseDate("9/5/26")).toBe("2026-09-05");
    expect(parseDate("20260915120000[-5:EST]")).toBe("2026-09-15");
  });

  it("reads a card export with one signed amount column", () => {
    const f = readCsv(
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n09/14/2026,09/15/2026,BLUE BOTTLE COFFEE,Food & Drink,Sale,-6.50,\n09/14/2026,09/15/2026,BLUE BOTTLE COFFEE,Food & Drink,Sale,-6.50,\n",
    )!;
    expect(f.transactions).toHaveLength(2);
    expect(f.transactions[0]).toMatchObject({
      date: "2026-09-14",
      amountCents: -650,
      category: "Food & Drink",
    });
    // The same purchase twice in a day stays two transactions, stably.
    expect(f.transactions[0]!.externalId).not.toBe(
      f.transactions[1]!.externalId,
    );
    expect(
      readCsv(
        "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n09/14/2026,09/15/2026,BLUE BOTTLE COFFEE,Food & Drink,Sale,-6.50,\n",
      )!.transactions[0]!.externalId,
    ).toBe(f.transactions[0]!.externalId);
  });

  it("reads split debit and credit columns, and flips positive-spending files", () => {
    const bank = readCsv(
      "Date,Description,Withdrawals,Deposits,Balance\n2026-09-01,RENT,2000.00,,500.00\n2026-09-02,PAYROLL,,3000.00,3500.00\n",
    )!;
    expect(bank.transactions.map((t) => t.amountCents)).toEqual([
      -200_000, 300_000,
    ]);
    const amex = readCsv(
      "Date,Description,Amount\n09/10/2026,UBER EATS,23.40\n",
      { flipSign: true },
    )!;
    expect(amex.transactions[0]!.amountCents).toBe(-2_340);
  });

  it("finds the header below preamble lines, and refuses files it can't read", () => {
    expect(
      readCsv(
        "Account: 1234\nExported 2026-09-24\nDate,Description,Amount\n2026-09-01,X,-1.00\n",
      )!.transactions,
    ).toHaveLength(1);
    expect(readCsv("hello,world\n1,2\n")).toBeNull();
  });
});

describe("ofx", () => {
  const sgml = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>123<ACCTID>987654<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260915<TRNAMT>-520.00<FITID>A1<NAME>HARBOR CU<MEMO>LOAN PMT
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260916120000<TRNAMT>3000.00<FITID>A2<NAME>PAYROLL
</BANKTRANLIST>
<LEDGERBAL><BALAMT>4321.09<DTASOF>20260917</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it("reads SGML statements, ids and the ending balance", () => {
    const f = readOfx(sgml)!;
    expect(f.transactions).toEqual([
      {
        date: "2026-09-15",
        description: "HARBOR CU LOAN PMT",
        amountCents: -52_000,
        externalId: "ofx-A1",
      },
      {
        date: "2026-09-16",
        description: "PAYROLL",
        amountCents: 300_000,
        externalId: "ofx-A2",
      },
    ]);
    expect(f.balanceCents).toBe(432_109);
    expect(f.account).toEqual({ id: "987654", type: "savings" });
    expect(readStatement("statement.qfx", sgml)!.format).toBe("ofx");
  });
});
