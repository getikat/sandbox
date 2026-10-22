import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Shell } from "./components/layout/Shell";
import { api } from "./lib/api";
import { useStatus } from "./lib/queries";
import { AccountsPage } from "./pages/Accounts";
import { BudgetsPage } from "./pages/Budgets";
import { RecurringPage } from "./pages/Recurring";
import { SpendingPage } from "./pages/Spending";
import { GetTheAppPage } from "./pages/GetTheApp";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { SettingsPage } from "./pages/Settings";
import { TransactionsPage } from "./pages/Transactions";
import { WelcomePage } from "./pages/Welcome";

export function App() {
  const qc = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: api.authState,
    staleTime: Infinity,
  });
  const status = useStatus();

  // Any 401 anywhere drops back to the login screen.
  useEffect(() => {
    const onAuth = () => qc.invalidateQueries({ queryKey: ["auth"] });
    window.addEventListener("ikat:auth", onAuth);
    return () => window.removeEventListener("ikat:auth", onAuth);
  }, [qc]);

  if (auth.data && !auth.data.authenticated)
    return <LoginPage passwordSet={auth.data.passwordSet} />;
  if (!auth.data || !status.data)
    return <div className="min-h-dvh bg-canvas" />;

  // Real profile with nothing linked yet: the welcome flow, not an empty dashboard.
  if (status.data.profile === "real" && status.data.connections.length === 0)
    return <WelcomePage />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="spending" element={<SpendingPage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="recurring" element={<RecurringPage />} />
        <Route path="investments" element={<GetTheAppPage />} />
        <Route path="equity" element={<GetTheAppPage />} />
        <Route path="taxes" element={<GetTheAppPage />} />
        <Route path="plan" element={<GetTheAppPage />} />
        <Route path="review" element={<GetTheAppPage />} />
        <Route path="cards" element={<GetTheAppPage />} />
        <Route path="loans" element={<GetTheAppPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
