import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CATEGORIES, CATEGORY_BY_ID, type CategoryKind } from "@ikat/core";
import { cn } from "../lib/cn";
import { CategoryIcon } from "./CategoryIcon";

const GROUPS: Array<{ kind: CategoryKind; label: string }> = [
  { kind: "expense", label: "Spending" },
  { kind: "income", label: "Income" },
  { kind: "transfer", label: "Moving money" },
];

/** Searchable category menu; the trigger shows the current category. */
export function CategoryPicker({
  value,
  onChange,
  trigger,
}: {
  value: string;
  onChange: (id: string) => void;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {trigger ?? (
          <button className="flex h-9 items-center gap-2 rounded-[10px] bg-surface-2 pr-2.5 pl-1.5 text-[13px] font-medium shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-surface-3">
            <CategoryIcon id={value} size={24} className="[&_svg]:size-3.5" />
            {CATEGORY_BY_ID[value]?.name ?? value}
            <ChevronDown className="size-3.5 text-fg-3" />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[60] w-[280px] overflow-hidden rounded-[14px] bg-surface shadow-pop dark:bg-surface-2"
        >
          <Command loop>
            <Command.Input
              autoFocus
              placeholder="Find a category…"
              className="h-11 w-full border-b border-line bg-transparent px-3.5 text-[13.5px] outline-none placeholder:text-fg-3"
            />
            <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
              <Command.Empty className="py-6 text-center text-[12.5px] text-fg-3">
                No category matches.
              </Command.Empty>
              {GROUPS.map((g) => (
                <Command.Group
                  key={g.kind}
                  heading={g.label}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase"
                >
                  {CATEGORIES.filter((c) => c.kind === g.kind).map((c) => (
                    <Command.Item
                      key={c.id}
                      value={`${c.name} ${c.id}`}
                      onSelect={() => {
                        onChange(c.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex h-9 cursor-default items-center gap-2.5 rounded-[9px] px-2 text-[13px] data-[selected=true]:bg-surface-2 dark:data-[selected=true]:bg-surface-3",
                      )}
                    >
                      <CategoryIcon
                        id={c.id}
                        size={24}
                        className="[&_svg]:size-3.5"
                      />
                      <span className="flex-1">{c.name}</span>
                      {c.id === value && (
                        <Check className="size-3.5 text-accent" />
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
