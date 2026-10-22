import { Slider as S } from "radix-ui";
import { cn } from "../../lib/cn";

export function Slider({
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  className,
  ...rest
}: {
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <S.Root
      value={[value]}
      onValueChange={(v) => onValueChange(v[0]!)}
      min={min}
      max={max}
      step={step}
      className={cn(
        "relative flex h-5 w-full touch-none items-center select-none",
        className,
      )}
      {...rest}
    >
      <S.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <S.Range className="absolute h-full rounded-full bg-accent" />
      </S.Track>
      <S.Thumb className="block size-[18px] rounded-full bg-white shadow-[0_0_0_1px_var(--line-strong),0_1px_4px_rgba(0,0,0,0.25)] transition-transform outline-none hover:scale-110 focus-visible:ring-4 focus-visible:ring-accent-soft" />
    </S.Root>
  );
}
