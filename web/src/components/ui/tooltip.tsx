import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={250}>{children}</T.Provider>;
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-[260px] rounded-[8px] bg-surface-3 px-2.5 py-1.5 text-[12px] text-fg shadow-pop data-[state=delayed-open]:animate-[fadeIn_120ms_ease]"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
