import { Switch as S } from "radix-ui";
import { cn } from "../../lib/cn";

export function Switch({
  checked,
  onCheckedChange,
  className,
  ...rest
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-accent" : "bg-surface-3 shadow-[0_0_0_1px_var(--line)]",
        className,
      )}
      {...rest}
    >
      <S.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}
