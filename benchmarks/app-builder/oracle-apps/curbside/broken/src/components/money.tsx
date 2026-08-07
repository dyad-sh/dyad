import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Every element that displays money renders through this component, so the
 * pinned `data-cents` integer and the text a human reads can never disagree.
 */
export function Money({
  cents,
  testId,
  className,
}: {
  cents: number;
  testId: string;
  className?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-cents={cents}
      className={cn("tabular-nums", className)}
    >
      {formatCents(cents)}
    </span>
  );
}
