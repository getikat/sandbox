import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Segmented } from "./ui/segmented";

/** One-time Plaid keys. Stored encrypted on this machine; env vars take precedence. */
export function PlaidSetup({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [env, setEnv] = useState<"production" | "sandbox">("production");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.savePlaid(clientId.trim(), secret.trim(), env);
      await qc.invalidateQueries({ queryKey: ["status"] });
      toast.success("Plaid is ready");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-fg-2">
        Ikat reads your accounts through Plaid. Create a free account, then copy
        your keys from the dashboard — the free Trial plan covers real banks.{" "}
        <a
          href="https://dashboard.plaid.com/developers/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
        >
          Open Plaid <ExternalLink className="size-3" />
        </a>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          placeholder="Secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={env}
          onChange={setEnv}
          options={[
            { value: "production", label: "Real banks" },
            { value: "sandbox", label: "Sandbox" },
          ]}
        />
        <Button
          variant="primary"
          onClick={save}
          disabled={saving || clientId.length < 10 || secret.length < 10}
        >
          Save keys
        </Button>
      </div>
    </div>
  );
}
