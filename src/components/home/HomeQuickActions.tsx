import {
  Box,
  Clock,
  FileEdit,
  Gamepad2,
  Image,
  LayoutTemplate,
  Lightbulb,
  ListTodo,
  Mail,
  Music,
  PenLine,
  RefreshCw,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { INSPIRATION_PROMPTS } from "@/prompts/inspiration_prompts";
import { cn } from "@/lib/utils";

const ICON_BY_LABEL: Record<string, LucideIcon> = {
  "TODO list app": ListTodo,
  "Landing Page": LayoutTemplate,
  "Sign Up Form": FileEdit,
  "Mood Journal & Tracker": Sparkles,
  "Interactive Story Game": Gamepad2,
  "AI Writing Assistant": PenLine,
  "Habit Streak Tracker": Clock,
  "Newsletter Creator": Mail,
  "Music Discovery App": Music,
  "3D Portfolio Viewer": Box,
  "AI Image Generator": Image,
  "Pomodoro Focus Timer": Clock,
  "Virtual Avatar Builder": User,
};

function getIconForLabel(label: string): LucideIcon {
  return ICON_BY_LABEL[label] ?? Lightbulb;
}

export function pickHomeQuickActionPrompts(count: number) {
  const shuffled = [...INSPIRATION_PROMPTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function HomeQuickActions({
  prompts,
  onSelect,
  onRefresh,
}: {
  prompts: typeof INSPIRATION_PROMPTS;
  onSelect: (label: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("home");

  return (
    <div className="flex w-full max-w-full shrink-0 flex-col items-center gap-3 px-1">
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        {prompts.map((item, idx) => {
          const Icon = getIconForLabel(item.label);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => onSelect(item.label)}
              style={{ animationDelay: `${idx * 60}ms` }}
              className={cn(
                "jarvis-pill jarvis-pill-entrance inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-xs sm:px-4 sm:text-sm",
                "active:scale-[0.98]",
              )}
            >
              <Icon className="size-4 shrink-0 text-cyan-400/80" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="jarvis-subtitle inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:text-cyan-300"
      >
        <RefreshCw className="size-3.5" />
        {t("moreIdeas")}
      </button>
    </div>
  );
}
