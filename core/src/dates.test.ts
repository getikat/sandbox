import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, eachMonth, endOfMonth } from "./dates";

describe("dates", () => {
  it("adds days across a DST boundary without drifting", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("clamps month arithmetic to the month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("keeps an anchored day from drifting after a short month", () => {
    const feb = addMonths("2026-01-31", 1, 31);
    expect(addMonths(feb, 1, 31)).toBe("2026-03-31");
  });

  it("counts whole days", () => {
    expect(diffDays("2026-01-01", "2026-12-31")).toBe(364);
    expect(diffDays("2026-09-23", "2026-09-20")).toBe(-3);
  });

  it("lists months inclusively", () => {
    expect(eachMonth("2026-11-15", "2027-02-01")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
  });
});
