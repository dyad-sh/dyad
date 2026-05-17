import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { ArrowUpRight, KeyRound, Wallet } from "lucide-react";

import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export function ManageDyadProButton({ className }: { className?: string }) {
  const { t } = useTranslation("home");
  return (
    <Button
      variant="outline"
      size="lg"
      className={cn(
        "cursor-pointer w-full mt-4 bg-(--background-lighter) text-primary",
        className,
      )}
      onClick={() => {
        ipc.system.openExternalUrl("https://academy.dyad.sh/subscription");
      }}
    >
      <Wallet aria-hidden="true" className="w-5 h-5" />
      {t("proBanner.manageDyadPro")}
      <ArrowUpRight aria-hidden="true" className="w-5 h-5" />
    </Button>
  );
}

export function SetupDyadProButton() {
  const { t } = useTranslation("home");
  return (
    <Button
      variant="outline"
      size="lg"
      className="cursor-pointer w-full bg-(--background-lighter) text-primary"
      onClick={() => {
        ipc.system.openExternalUrl("https://academy.dyad.sh/settings");
      }}
    >
      <KeyRound aria-hidden="true" />
      {t("proBanner.alreadyHavePro")}
    </Button>
  );
}
