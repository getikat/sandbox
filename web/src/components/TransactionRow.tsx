import type { TransactionDTO } from "@ikat/core";
import { categoryKind } from "@ikat/core";
import { cn } from "../lib/cn";
import { categoryName } from "../lib/queries";
import { MerchantAvatar } from "./Avatars";
import { Money } from "./Money";

export function TransactionRow({
  tx,
  onClick,
  showAccount = true,
  dense = false,
}: {
  tx: TransactionDTO;
  onClick?: () => void;
  showAccount?: boolean;
  dense?: boolean;
}) {
  const transfer = categoryKind(tx.categoryId) === "transfer";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 text-left transition-colors hover:bg-surface-2/60 dark:hover:bg-surface-2/50",
        dense ? "px-4 py-2" : "px-5 py-2.5",
      )}
    >
      <MerchantAvatar
        logoUrl={tx.logoUrl}
        categoryId={tx.categoryId}
        size={dense ? 30 : 34}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">
            {tx.merchant}
          </span>
          {tx.pending && (
            <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10.5px] font-medium text-fg-3 shadow-[0_0_0_1px_var(--line)]">
              Pending
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-fg-3">
          {/* One category covers both directions; money coming back out of investments isn't a contribution. */}
          {tx.categoryId === "investment_transfer" && tx.amountCents > 0
            ? "From investments"
            : categoryName(tx.categoryId)}
          {showAccount && <> · {tx.accountName}</>}
        </div>
      </div>
      <Money
        cents={tx.amountCents}
        tone="income"
        className={cn("text-[13.5px] font-medium num", transfer && "text-fg-3")}
      />
    </button>
  );
}
