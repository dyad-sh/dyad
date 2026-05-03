/**
 * JoyDeprecationBanner — small banner shown on legacy marketplace pages,
 * pointing users at the new `/joy/*` unified pages.
 *
 * Per Joy Unification PR D9: deprecate-don't-delete.
 */

import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight } from "lucide-react";

interface Props {
  /** Default: /joy/marketplace */
  to?: string;
  /** Default: "Joy Marketplace" */
  label?: string;
}

export function JoyDeprecationBanner({
  to = "/joy/marketplace",
  label = "Joy Marketplace",
}: Props) {
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 flex items-center gap-3 text-sm">
      <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1">
        <span className="font-medium">This page is being replaced.</span>{" "}
        <span className="text-muted-foreground">
          Try the new unified {label} for a faster, simpler experience.
        </span>
      </div>
      <Link
        to={to}
        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 hover:underline shrink-0"
      >
        Open {label} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export default JoyDeprecationBanner;
