import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface SkippableBannerProps {
  icon: LucideIcon;
  message: React.ReactNode;
  enableLabel: string;
  onEnable: () => void;
  onSkip: () => void;
  "data-testid"?: string;
}

const colors = {
  container: "bg-indigo-50/60 dark:bg-indigo-900/30",
  ring: "ring-black/5 dark:ring-white/10",
  icon: "text-indigo-600 dark:text-indigo-200 bg-indigo-100 dark:bg-white/15",
  text: "text-indigo-900 dark:text-indigo-100",
  enableBtn: "bg-white/90 hover:bg-white text-indigo-800 shadow font-semibold",
  skipBtn:
    "text-indigo-600 dark:text-indigo-200 hover:text-indigo-800 dark:hover:text-indigo-100",
};

export function SkippableBanner({
  icon: Icon,
  message,
  enableLabel,
  onEnable,
  onSkip,
  "data-testid": testId,
}: SkippableBannerProps) {
  const c = colors;

  return (
    <div className="px-3 pt-1 flex justify-center" data-testid={testId}>
      <div
        className={`max-w-3xl w-full mb-2 rounded-lg ${c.container} ring-1 ring-inset ${c.ring} relative`}
      >
        <button
          type="button"
          onClick={onSkip}
          className={`absolute -top-2 -right-2 inline-flex items-center justify-center rounded-full p-1 transition-colors duration-150 ${c.skipBtn} cursor-pointer bg-white dark:bg-indigo-800 ring-1 ring-inset ${c.ring} shadow-sm`}
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="flex items-center gap-3 px-3 py-2 pr-8">
          {/* Icon badge */}
          <div className={`shrink-0 rounded-lg p-2 ${c.icon}`}>
            <Icon className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium leading-snug ${c.text}`}>
              {message}
            </p>
          </div>

          {/* Action */}
          <button
            type="button"
            onClick={onEnable}
            className={`inline-flex items-center shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-150 ${c.enableBtn} cursor-pointer`}
          >
            {enableLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
