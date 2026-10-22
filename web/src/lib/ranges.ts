import { addDays, addMonths, startOfYear, type ISODate } from "@ikat/core";

export type RangeKey = "1m" | "3m" | "6m" | "ytd" | "1y" | "all";

export const RANGES: Array<{ value: RangeKey; label: string; long: string }> = [
  { value: "1m", label: "1M", long: "past month" },
  { value: "3m", label: "3M", long: "past 3 months" },
  { value: "6m", label: "6M", long: "past 6 months" },
  { value: "ytd", label: "YTD", long: "this year" },
  { value: "1y", label: "1Y", long: "past year" },
  { value: "all", label: "All", long: "all time" },
];

export function rangeStart(key: RangeKey, today: ISODate): ISODate | null {
  switch (key) {
    case "1m":
      return addMonths(today, -1);
    case "3m":
      return addMonths(today, -3);
    case "6m":
      return addMonths(today, -6);
    case "ytd":
      return addDays(startOfYear(today), -1);
    case "1y":
      return addMonths(today, -12);
    case "all":
      return null;
  }
}
