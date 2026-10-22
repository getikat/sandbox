import { Select as S } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/** Compact filter select. The empty-string value means "any". */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  className?: string;
}) {
  const ANY = "__any__";
  return (
    <S.Root
      value={value || ANY}
      onValueChange={(v) => onChange(v === ANY ? "" : v)}
    >
      <S.Trigger
        className={cn(
          "inline-flex h-9 max-w-[220px] items-center gap-2 rounded-[10px] bg-surface-2 px-3 text-[13px] shadow-[0_0_0_1px_var(--line)] outline-none transition-colors hover:bg-surface-3 data-[placeholder]:text-fg-3",
          value ? "text-fg" : "text-fg-2",
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-3" />
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[360px] min-w-[220px] overflow-hidden rounded-[12px] bg-surface shadow-pop dark:bg-surface-2"
        >
          <S.Viewport className="p-1">
            <Item value={ANY} label={placeholder} />
            <S.Separator className="my-1 h-px bg-line" />
            {options.map((o) => (
              <Item
                key={o.value}
                value={o.value}
                label={o.label}
                icon={o.icon}
              />
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

function Item({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <S.Item
      value={value}
      className="relative flex h-8 cursor-default items-center gap-2 rounded-[8px] pr-8 pl-2.5 text-[13px] outline-none select-none data-[highlighted]:bg-surface-2 dark:data-[highlighted]:bg-surface-3"
    >
      {icon}
      <S.ItemText>{label}</S.ItemText>
      <S.ItemIndicator className="absolute right-2.5">
        <Check className="size-3.5 text-accent" />
      </S.ItemIndicator>
    </S.Item>
  );
}
