import { Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Marks a server that was added from the curated catalog. The detail
// header uses the larger size. The summary card uses the icon-only size
// so the name keeps the title row; hovering it explains the mark and
// screen readers still read "Catalog".
export function CatalogBadge({ size = "sm" }: { size?: "sm" | "md" | "icon" }) {
  const colors =
    "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100";
  if (size === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-testid="catalog-badge"
              className={`${colors} inline-flex size-5 shrink-0 items-center justify-center rounded-full`}
            />
          }
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          <span className="sr-only">Catalog</span>
        </TooltipTrigger>
        <TooltipContent>Added from the catalog</TooltipContent>
      </Tooltip>
    );
  }
  const sizing =
    size === "md" ? "font-medium px-2 py-1" : "font-normal px-2 py-0.5";
  return (
    <span
      data-testid="catalog-badge"
      className={`text-xs ${sizing} rounded-full ${colors} inline-flex items-center gap-1 shrink-0`}
    >
      <Sparkles className="w-3 h-3" />
      Catalog
    </span>
  );
}
