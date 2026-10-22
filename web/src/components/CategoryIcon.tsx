import {
  AppWindow,
  ArrowLeftRight,
  Baby,
  BadgePercent,
  BedDouble,
  Briefcase,
  Car,
  CircleDashed,
  CirclePlus,
  Coffee,
  CreditCard,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  Package,
  PawPrint,
  Percent,
  Plane,
  Receipt,
  Shield,
  ShoppingBag,
  ShoppingBasket,
  Sofa,
  Sparkles,
  Ticket,
  TrainFront,
  TrendingUp,
  Tv,
  Undo2,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_BY_ID } from "@ikat/core";
import { cn } from "../lib/cn";

const ICONS: Record<string, LucideIcon> = {
  "app-window": AppWindow,
  "arrow-left-right": ArrowLeftRight,
  baby: Baby,
  "badge-percent": BadgePercent,
  "bed-double": BedDouble,
  briefcase: Briefcase,
  car: Car,
  "circle-dashed": CircleDashed,
  "plus-circle": CirclePlus,
  coffee: Coffee,
  "credit-card": CreditCard,
  dumbbell: Dumbbell,
  fuel: Fuel,
  gift: Gift,
  "graduation-cap": GraduationCap,
  "hand-coins": HandCoins,
  "heart-pulse": HeartPulse,
  house: House,
  landmark: Landmark,
  package: Package,
  "paw-print": PawPrint,
  percent: Percent,
  plane: Plane,
  receipt: Receipt,
  shield: Shield,
  "shopping-bag": ShoppingBag,
  "shopping-basket": ShoppingBasket,
  sofa: Sofa,
  sparkles: Sparkles,
  ticket: Ticket,
  "train-front": TrainFront,
  "trending-up": TrendingUp,
  tv: Tv,
  "undo-2": Undo2,
  utensils: Utensils,
  wifi: Wifi,
  wrench: Wrench,
  zap: Zap,
};

// Colour follows the category, never its rank, so Dining is the same orange
// in every chart and list. Eight validated slots; rarer categories share.
const SLOT: Record<string, number> = {
  dining: 2,
  groceries: 3,
  coffee: 4,
  gas: 8,
  transit: 1,
  auto: 7,
  travel: 1,
  lodging: 7,
  shopping: 5,
  online: 5,
  home: 6,
  rent: 7,
  utilities: 4,
  phone_internet: 1,
  streaming: 8,
  software: 7,
  entertainment: 5,
  health: 8,
  fitness: 3,
  personal_care: 5,
  insurance: 6,
  education: 1,
  kids: 4,
  pets: 2,
  gifts: 5,
  fees: 8,
  taxes: 6,
  services: 6,
  loan_payment: 7,
  other: 0,
  paycheck: 3,
  interest_income: 3,
  refund: 3,
  rewards_income: 3,
  other_income: 3,
  transfer: 0,
  card_payment: 0,
  investment_transfer: 1,
};

export function categoryColor(id: string): string {
  const slot = SLOT[id] ?? 0;
  return slot ? `var(--chart-${slot})` : "var(--fg-3)";
}

export function CategoryGlyph({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const Icon =
    ICONS[CATEGORY_BY_ID[id]?.icon ?? "circle-dashed"] ?? CircleDashed;
  return <Icon className={className} />;
}

/** The category icon on a soft tint of its colour. */
export function CategoryIcon({
  id,
  size = 32,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const color = categoryColor(id);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={{ width: size, height: size, color }}
    >
      <span
        className="absolute inset-0 rounded-full opacity-[0.14]"
        style={{ background: color }}
      />
      <CategoryGlyph id={id} className="relative" />
    </span>
  );
}
