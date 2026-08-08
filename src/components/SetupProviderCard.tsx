import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

type SetupProviderVariant = "google" | "openrouter" | "dyad";

export function SetupProviderCard({
  variant,
  title,
  subtitle,
  chip,
  leadingIcon,
  onClick,
  tabIndex = 0,
  className,
}: {
  variant: SetupProviderVariant;
  title: string;
  subtitle?: string;
  chip?: ReactNode;
  leadingIcon: ReactNode;
  onClick: () => void;
  tabIndex?: number;
  className?: string;
}) {
  const styles = getVariantStyles(variant);

  return (
    <div
      className={cn(
        "p-3 border rounded-lg cursor-pointer transition-colors relative",
        styles.container,
        className,
      )}
      onClick={onClick}
      role="button"
      tabIndex={tabIndex}
    >
      {chip && (
        <div
          className={cn(
            "absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-semibold",
            styles.chipColor,
          )}
        >
          {chip}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn("p-1.5 rounded-full", styles.iconWrapper)}>
            {leadingIcon}
          </div>
          <div>
            <h4 className={cn("font-medium text-[15px]", styles.titleColor)}>
              {title}
            </h4>
            {subtitle ? (
              <div
                className={cn(
                  "text-sm flex items-center gap-1",
                  styles.subtitleColor,
                )}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
        <ChevronRight className={cn("w-4 h-4", styles.chevronColor)} />
      </div>
    </div>
  );
}

function getVariantStyles(variant: SetupProviderVariant) {
  switch (variant) {
    case "google":
      return {
        container:
          "bg-blue-50/50 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-800/30 hover:bg-blue-50 dark:hover:bg-blue-900/30",
        iconWrapper: "bg-blue-100/50 dark:bg-blue-800/30",
        titleColor: "text-zinc-700 dark:text-zinc-300",
        subtitleColor: "text-blue-500/70 dark:text-blue-400/70",
        chipColor:
          "text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700",
        chevronColor: "text-zinc-400 dark:text-zinc-500",
      } as const;
    case "openrouter":
      return {
        container:
          "bg-blue-50/50 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-800/30 hover:bg-blue-50 dark:hover:bg-blue-900/30",
        iconWrapper: "bg-blue-100/50 dark:bg-blue-800/30",
        titleColor: "text-zinc-700 dark:text-zinc-300",
        subtitleColor: "text-blue-500/70 dark:text-blue-400/70",
        chipColor:
          "text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700",
        chevronColor: "text-zinc-400 dark:text-zinc-500",
      } as const;
    case "dyad":
      return {
        container:
          "bg-primary/10 border-primary/50 dark:bg-violet-800/50 dark:border-violet-700 hover:bg-violet-100 dark:hover:bg-violet-900/70",
        iconWrapper: "bg-primary/5 dark:bg-violet-800",
        titleColor: "text-violet-800 dark:text-violet-300",
        subtitleColor: "text-violet-600 dark:text-violet-400",
        chipColor:
          "text-violet-700 dark:text-violet-200 bg-violet-100 dark:bg-violet-900 border border-violet-200 dark:border-violet-700",
        chevronColor: "text-violet-600 dark:text-violet-400",
      } as const;
  }
}

export default SetupProviderCard;
