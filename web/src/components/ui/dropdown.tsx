import { DropdownMenu as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Dropdown = D.Root;
export const DropdownTrigger = D.Trigger;

export function DropdownContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <D.Portal>
      <D.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-[200px] rounded-[12px] bg-surface p-1 shadow-pop dark:bg-surface-2",
          className,
        )}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  danger,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <D.Item
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-[8px] px-2.5 text-[13px] outline-none select-none data-[highlighted]:bg-surface-2 dark:data-[highlighted]:bg-surface-3 [&_svg]:size-4 [&_svg]:text-fg-3",
        danger ? "text-negative" : "text-fg",
        className,
      )}
    >
      {children}
    </D.Item>
  );
}

export const DropdownSeparator = () => (
  <D.Separator className="my-1 h-px bg-line" />
);
