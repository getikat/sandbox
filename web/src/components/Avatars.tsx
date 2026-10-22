import { useState } from "react";
import { cn } from "../lib/cn";
import { CategoryIcon } from "./CategoryIcon";

function initials(name: string) {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** The institution's logo when the provider has one; its brand colour and initials otherwise. */
export function InstitutionAvatar({
  name,
  logo,
  color,
  size = 32,
  className,
}: {
  name: string;
  logo?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const radius = Math.round(size * 0.28);
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn(
          "shrink-0 bg-white object-contain p-[3px] shadow-[0_0_0_1px_var(--line)]",
          className,
        )}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(145deg, ${color ?? "#5b5f6a"}, color-mix(in oklab, ${color ?? "#5b5f6a"} 72%, black))`,
        letterSpacing: "-0.02em",
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Merchant logo when the provider supplies one; the category glyph otherwise. */
export function MerchantAvatar({
  logoUrl,
  categoryId,
  size = 34,
}: {
  logoUrl?: string | null;
  categoryId: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-white object-cover shadow-[0_0_0_1px_var(--line)]"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <CategoryIcon id={categoryId} size={size} className="[&_svg]:size-[15px]" />
  );
}
