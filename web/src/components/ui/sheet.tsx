import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Side sheet on desktop, bottom sheet on phones. Used for detail views that
 * shouldn't lose the list behind them.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed z-50 flex flex-col bg-surface shadow-pop outline-none max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[88dvh] max-md:rounded-t-[20px] md:inset-y-2 md:right-2 md:w-[440px] md:rounded-[18px]"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <Dialog.Title className="truncate text-[15px] font-semibold">
                      {title}
                    </Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-0.5 text-[12.5px] text-fg-3">
                        {description}
                      </Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">
                        Details
                      </Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close className="-mr-1 rounded-[8px] p-1.5 text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg">
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
