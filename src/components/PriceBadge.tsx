import React from "react";

export function PriceBadge({
  dollarSigns,
}: {
  dollarSigns: number | undefined;
}) {
  if (dollarSigns === undefined || dollarSigns === null) return null;

  const label = dollarSigns === 0 ? "Free" : "$".repeat(dollarSigns);

  const className =
    dollarSigns === 0
      ? "text-[10px] text-primary border border-primary px-1.5 py-0.5 rounded-full font-medium"
      : "text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium";

  return <span className={className}>{label}</span>;
}

export default PriceBadge;
