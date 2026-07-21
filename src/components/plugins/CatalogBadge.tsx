import { Sparkles } from "lucide-react";

// Marks a server that was added from the curated catalog. The summary
// card uses the smaller size; the detail header uses the larger one.
export function CatalogBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  const sizing =
    size === "md" ? "font-medium px-2 py-1" : "font-normal px-2 py-0.5";
  return (
    <span
      className={`text-xs ${sizing} rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100 inline-flex items-center gap-1 shrink-0`}
    >
      <Sparkles className="w-3 h-3" />
      Catalog
    </span>
  );
}
