import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  DownloadCloud,
  Landmark,
  Loader2,
  Sparkles,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { LogoMark } from "../components/Logo";
import { usePlaidFlow } from "../components/PlaidLink";
import { PlaidSetup } from "../components/PlaidSetup";
import { Card } from "../components/ui/card";
import { api } from "../lib/api";
import { useStatus } from "../lib/queries";

/** First run with real data selected and nothing connected yet. */
export function WelcomePage() {
  const qc = useQueryClient();
  const { data: status } = useStatus();
  const plaid = usePlaidFlow();
  const [busy, setBusy] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  return (
    <div className="glow flex min-h-dvh items-center justify-center px-5 py-12">
      {plaid.element}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-[560px]"
      >
        <LogoMark size={44} />
        <h1 className="mt-6 text-[34px] leading-[1.1] font-semibold tracking-[-0.035em]">
          Your whole financial picture, in one place.
        </h1>
        <p className="mt-3 text-[15px] text-fg-2">
          Every bank, card, brokerage and loan — synced daily, analysed on this
          Mac, and never sent anywhere you didn't choose.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {status?.plaid.configured ? (
            <Option
              icon={<Landmark />}
              title="Connect a bank or brokerage"
              body="Sign in securely through Plaid. Ikat never sees your password."
              busy={plaid.busy}
              onClick={() => plaid.start()}
            />
          ) : (
            <Card className="p-4">
              <button
                onClick={() => setShowKeys((v) => !v)}
                className="flex w-full items-center gap-3 text-left"
              >
                <IconBox>
                  <Landmark />
                </IconBox>
                <div className="flex-1">
                  <div className="text-[14.5px] font-semibold">
                    Connect with Plaid
                  </div>
                  <div className="text-[13px] text-fg-3">
                    Add your free Plaid keys once, then link any institution.
                  </div>
                </div>
                <ArrowRight className="size-4 text-fg-3" />
              </button>
              {showKeys && (
                <div className="mt-4 border-t border-line pt-4">
                  <PlaidSetup />
                </div>
              )}
            </Card>
          )}
          <Option
            icon={<Sparkles />}
            title="Explore the demo"
            body="A realistic household with every feature switched on. Your data stays separate."
            onClick={async () => {
              await api.setProfile("demo");
              await qc.invalidateQueries();
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}

function IconBox({
  children,
  primary,
}: {
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <span
      className={
        primary
          ? "flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-accent text-white [&_svg]:size-5 dark:text-[#0b0b14]"
          : "flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-surface-2 text-fg-2 shadow-[0_0_0_1px_var(--line)] [&_svg]:size-5"
      }
    >
      {children}
    </span>
  );
}

function Option({
  icon,
  title,
  body,
  onClick,
  primary,
  busy,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  onClick: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Card className="transition-shadow hover:shadow-pop">
      <button
        onClick={onClick}
        disabled={busy}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <IconBox primary={primary}>{icon}</IconBox>
        <div className="flex-1">
          <div className="text-[14.5px] font-semibold">{title}</div>
          <div className="text-[13px] text-fg-3">{body}</div>
        </div>
        {busy ? (
          <Loader2 className="size-4 animate-spin text-fg-3" />
        ) : (
          <ArrowRight className="size-4 text-fg-3" />
        )}
      </button>
    </Card>
  );
}
