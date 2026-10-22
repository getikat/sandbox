import { ArrowUpRight } from "lucide-react";
import { useLocation } from "react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { NAV } from "../components/layout/nav";
import { Card } from "../components/ui/card";

const APP_URL = "https://getikat.com/app/";

/** What a section of the iPhone app is, shown where this web app has no such screen. */
export function GetTheAppPage() {
  const { pathname } = useLocation();
  const item = NAV.flatMap((section) => section.items).find(
    (i) => i.to === pathname,
  );
  const name = item?.label ?? "This";
  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader title={`${name} is in the Ikat iPhone app`} />
      <Card className="p-6">
        <p className="text-[15px] text-fg-2">
          This web app keeps to your accounts, net worth, transactions,
          spending, budgets and bills, and runs only on your own machine. {name}{" "}
          is part of Ikat for iPhone, which keeps your data on your phone and in
          your own iCloud.
        </p>
        <a
          href={APP_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-[13.5px] font-medium text-white"
        >
          Get the iPhone app
          <ArrowUpRight className="size-4" />
        </a>
      </Card>
    </div>
  );
}
