import { describe, expect, it } from "vitest";
import {
  categoryForMcc,
  categoryForProvider,
  categoryKind,
} from "./categories";
import { merchantKey, prettifyMerchant } from "./merchants";

describe("categories", () => {
  it("splits groceries from dining and gas from transit by MCC", () => {
    expect(categoryForMcc("5411")).toBe("groceries");
    expect(categoryForMcc("5812")).toBe("dining");
    expect(categoryForMcc(5542)).toBe("gas");
    expect(categoryForMcc("4111")).toBe("transit");
  });

  it("defers unmapped and deliberately-unmapped codes to the provider", () => {
    expect(categoryForMcc("4899")).toBeNull();
    expect(categoryForMcc("7997")).toBeNull();
    expect(categoryForMcc("")).toBeNull();
    expect(categoryForMcc(null)).toBeNull();
  });

  it("maps airline and hotel MCC ranges", () => {
    expect(categoryForMcc("3058")).toBe("travel");
    expect(categoryForMcc("3710")).toBe("lodging");
  });

  it("prefers the detailed provider category, where groceries is distinguishable", () => {
    expect(
      categoryForProvider("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
    ).toBe("groceries");
    expect(
      categoryForProvider("FOOD_AND_DRINK", "FOOD_AND_DRINK_UNKNOWN_THING"),
    ).toBe("dining");
    // Plaid's v2 taxonomy renamed wages; loan money arriving isn't income.
    expect(categoryForProvider("INCOME", "INCOME_SALARY")).toBe("paycheck");
    expect(
      categoryForProvider(
        "LOAN_DISBURSEMENTS",
        "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
      ),
    ).toBe("transfer");
  });

  it("treats card payments and transfers as non-spending", () => {
    expect(categoryKind("card_payment")).toBe("transfer");
    expect(categoryKind("paycheck")).toBe("income");
    expect(categoryKind("dining")).toBe("expense");
  });
});

describe("merchantKey", () => {
  it("collapses processor prefixes, store numbers and reference codes", () => {
    expect(merchantKey("SQ *BLUE BOTTLE 0423 OAKLAND CA")).toBe("blue bottle");
    expect(merchantKey("AMZN Mktp US*2K4L19")).toBe("amzn mktp");
    expect(merchantKey("TST* SWEETGREEN #1234")).toBe("sweetgreen");
    // A processor in front, not the merchant ("Cl", "Fsi" before).
    expect(prettifyMerchant("CL *Chase Travel")).toBe("Chase Travel");
    expect(prettifyMerchant("Payment to Chase card ending in 1111 09/23")).toBe(
      "Payment to Chase Card",
    );
    expect(merchantKey("FSI*CONED BILL PAYMENT")).toBe("coned bill payment");
    // …but a merchant's own "*" stays the merchant.
    expect(merchantKey("UBER *EATS")).toBe("uber");
    expect(merchantKey("Netflix.com")).toBe("netflix");
    expect(merchantKey("Harbor CU ACH PAY PPD ID: 123456789")).toBe("harbor");
    expect(merchantKey("NORTHWIND LABS DES:PAYROLL ID:XXXXX4821")).toBe(
      "northwind labs",
    );
    expect(prettifyMerchant("Harbor CU ACH PAY PPD ID: 123456789")).toBe(
      "Harbor",
    );
  });
});
