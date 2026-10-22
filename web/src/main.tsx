import "@fontsource-variable/inter";
import "./styles/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className:
              "!bg-surface !text-fg !shadow-pop !border-0 !rounded-[12px]",
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// The service worker (push alerts, offline shell) only in production builds,
// so development never serves stale modules.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener(
    "load",
    () => void navigator.serviceWorker.register("/sw.js"),
  );
}
