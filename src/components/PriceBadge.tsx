import React from "react";
import { cn } from "@/lib/utils";

const PILL_BASE =
  "text-[10px] leading-none px-1.5 py-1 rounded-full font-medium";

function HalfDollar() {
  return (
    <span className="relative inline-block align-baseline" aria-hidden="true">
      <span className="opacity-30">$</span>
      <span
        className="absolute inset-0"
        style={{ clipPath: "inset(0 35% 0 0)" }}
      >
        $
      </span>
    </span>
  );
}

export function PriceBadge({
  dollarSigns,
}: {
  dollarSigns: number | undefined;
}) {
  if (dollarSigns === undefined || dollarSigns === null) return null;

  if (dollarSigns === 0) {
    return (
      <span
        className={cn(
          PILL_BASE,
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        )}
      >
        Free
      </span>
    );
  }

  const full = Math.floor(dollarSigns / 2);
  const half = dollarSigns % 2 === 1;

  return (
    <span
      aria-label={`Price: ${(dollarSigns / 2).toFixed(1)}`}
      className={cn(PILL_BASE, "bg-primary/10 text-primary tracking-tight")}
    >
      {"$".repeat(full)}
      {half && <HalfDollar />}
    </span>
  );
}

export default PriceBadge;
