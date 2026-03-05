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
  container:
    "from-white via-indigo-50 to-sky-100 dark:from-indigo-700 dark:via-indigo-700 dark:to-indigo-900",
  ring: "ring-black/5 dark:ring-white/10",
  orb1: "bg-violet-200/40 dark:bg-violet-400/10",
  orb2: "bg-sky-200/40 dark:bg-sky-400/10",
  icon: "text-indigo-600 dark:text-indigo-200 bg-indigo-100 dark:bg-white/15",
  text: "text-indigo-900 dark:text-indigo-100",
  enableBtn: "bg-white/90 hover:bg-white text-indigo-800 shadow font-semibold",
  skipBtn:
    "text-indigo-600/70 dark:text-indigo-200/60 hover:text-indigo-800 dark:hover:text-indigo-100 hover:bg-indigo-100/50 dark:hover:bg-white/10",
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
    <div className="px-3 flex justify-center" data-testid={testId}>
      <div
        className={`max-w-3xl w-full my-3 rounded-xl bg-gradient-to-br ${c.container} relative overflow-hidden ring-1 ring-inset ${c.ring} shadow-sm transition-all duration-200 hover:shadow-md`}
      >
        {/* Decorative gradient overlay */}
        <div
          className="absolute inset-0 z-0 bg-gradient-to-tr from-white/60 via-transparent to-transparent pointer-events-none dark:from-white/5"
          aria-hidden="true"
        />
        {/* Decorative blur orbs */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          aria-hidden="true"
        >
          <div
            className={`absolute -top-8 -left-6 h-36 w-36 rounded-full blur-2xl ${c.orb1}`}
          />
          <div
            className={`absolute -bottom-10 -right-6 h-40 w-40 rounded-full blur-3xl ${c.orb2}`}
          />
        </div>

        <div className="relative z-10 flex items-center gap-3.5 p-4">
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

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onEnable}
              className={`inline-flex items-center rounded-lg px-4 py-1.5 text-sm font-semibold transition-all duration-150 ${c.enableBtn} cursor-pointer`}
            >
              {enableLabel}
            </button>
            <button
              type="button"
              onClick={onSkip}
              className={`inline-flex items-center justify-center rounded-lg p-1.5 transition-colors duration-150 ${c.skipBtn} cursor-pointer`}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
