import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { toast } from "sonner";
import { api } from "../lib/api";

type Mode =
  | { kind: "new" }
  | { kind: "update"; connectionId: string; consent?: string[] };

function Launcher({
  token,
  mode,
  onDone,
}: {
  token: string;
  mode: Mode;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (mode.kind === "new") {
          if (!publicToken) throw new Error("Plaid didn't return a token");
          const t = toast.loading(
            `Connecting ${metadata.institution?.name ?? "your bank"}…`,
          );
          await api.exchange(publicToken, {
            id: metadata.institution?.institution_id,
            name: metadata.institution?.name,
          });
          toast.success(
            `${metadata.institution?.name ?? "Institution"} connected`,
            { id: t },
          );
        } else {
          await api.refreshConnection(mode.connectionId);
          toast.success("Connection updated");
        }
        await qc.invalidateQueries();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't finish connecting",
        );
      } finally {
        onDone();
      }
    },
    onExit: (err) => {
      if (err)
        toast.error(
          err.display_message ||
            err.error_message ||
            "Plaid closed with an error",
        );
      onDone();
    },
  });
  useEffect(() => {
    if (ready) open();
  }, [ready, open]);
  return null;
}

/**
 * Opens Plaid Link: a new institution, re-authentication, or granting a
 * product an existing connection lacks (e.g. holdings for a brokerage).
 */
export function usePlaidFlow() {
  const [state, setState] = useState<{ token: string; mode: Mode } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const start = useCallback(async (mode: Mode = { kind: "new" }) => {
    setBusy(true);
    try {
      const { linkToken } = await api.linkToken(
        mode.kind === "update"
          ? {
              connectionId: mode.connectionId,
              ...(mode.consent ? { consent: mode.consent } : {}),
            }
          : {},
      );
      setState({ token: linkToken, mode });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start Plaid");
      setBusy(false);
    }
  }, []);
  const element = state ? (
    <Launcher
      key={state.token}
      token={state.token}
      mode={state.mode}
      onDone={() => {
        setState(null);
        setBusy(false);
      }}
    />
  ) : null;
  return { start, busy, element };
}
