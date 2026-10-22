import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg hover:opacity-90 shadow-[0_1px_0_rgba(255,255,255,0.12)_inset]",
  accent: "bg-accent text-white hover:brightness-110 dark:text-[#0b0b14]",
  secondary:
    "bg-surface-2 text-fg shadow-[0_0_0_1px_var(--line)] hover:bg-surface-3",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
  danger: "bg-negative-soft text-negative hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-[14.5px] gap-2 rounded-[12px]",
  icon: "h-9 w-9 rounded-[10px]",
  "icon-sm": "h-8 w-8 rounded-[9px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", className, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background,opacity,color,filter,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
