import {
  ArrowLeftRight,
  CalendarCheck,
  ChartCandlestick,
  ChartPie,
  ChartSpline,
  Compass,
  CreditCard,
  HandCoins,
  House,
  Landmark,
  ReceiptText,
  Repeat,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Part of the iPhone app, not this web app: the page links to it. */
  app?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

// Pages join the nav as they ship — never a link to a page that isn't there.
export const NAV: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: House, end: true },
      { to: "/accounts", label: "Accounts", icon: Landmark },
      { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/spending", label: "Spending", icon: ChartPie },
      { to: "/budgets", label: "Budgets", icon: Target },
      { to: "/recurring", label: "Recurring", icon: Repeat },
      {
        to: "/review",
        label: "Monthly review",
        icon: CalendarCheck,
        app: true,
      },
    ],
  },
  {
    label: "Wealth",
    items: [
      { to: "/plan", label: "Plan", icon: Compass, app: true },
      {
        to: "/investments",
        label: "Investments",
        icon: ChartSpline,
        app: true,
      },
      { to: "/equity", label: "Equity", icon: ChartCandlestick, app: true },
      { to: "/taxes", label: "Tax & retirement", icon: ReceiptText, app: true },
    ],
  },
  {
    label: "Credit",
    items: [
      { to: "/cards", label: "Cards & rewards", icon: CreditCard, app: true },
      { to: "/loans", label: "Loans & debt", icon: HandCoins, app: true },
    ],
  },
];

export const SETTINGS: NavItem = {
  to: "/settings",
  label: "Settings",
  icon: Settings,
};

const all = NAV.flatMap((s) => s.items);
const by = (to: string) => all.find((i) => i.to === to)!;

/** Bottom bar on phones: the most-used destinations; everything else is under More. */
export const MOBILE_NAV: NavItem[] = [
  by("/"),
  by("/accounts"),
  by("/transactions"),
  by("/spending"),
];
