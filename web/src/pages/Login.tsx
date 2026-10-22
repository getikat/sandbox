import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { LogoMark } from "../components/Logo";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { api } from "../lib/api";

export function LoginPage({ passwordSet }: { passwordSet: boolean }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await qc.invalidateQueries();
    } catch {
      setError("That password didn't match.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glow flex min-h-dvh items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[380px]"
      >
        <Card className="p-7">
          <LogoMark size={40} />
          {passwordSet ? (
            <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em]">
                Welcome back
              </h1>
              <p className="-mt-1 text-[13px] text-fg-3">
                Enter your Ikat password to continue.
              </p>
              <Input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              {error && <p className="text-[12.5px] text-negative">{error}</p>}
              <Button
                variant="primary"
                size="lg"
                type="submit"
                disabled={!password || busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Lock />} Unlock
              </Button>
            </form>
          ) : (
            <div className="mt-6">
              <h1 className="text-[20px] font-semibold tracking-[-0.02em]">
                Not open to other devices yet
              </h1>
              <p className="mt-2 text-[13.5px] text-fg-2">
                On the Mac running Ikat, open Settings → Access from your phone
                and set a password. Then reload this page.
              </p>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
