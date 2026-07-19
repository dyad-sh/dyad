import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GaugeIcon, CheckIcon } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  THINKING_EFFORT_DEFAULT,
  THINKING_EFFORT_OPTIONS,
  getThinkingEffortOption,
  type ThinkingEffortLevel,
} from "@/lib/thinkingEffort";

export function ThinkingEffortSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");

  if (!settings) {
    return null;
  }

  const currentValue = settings.thinkingBudget ?? THINKING_EFFORT_DEFAULT;
  const currentOption = getThinkingEffortOption(currentValue);

  const handleSelect = (value: ThinkingEffortLevel) => {
    updateSettings({ thinkingBudget: value });
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-foreground/80 hover:text-foreground hover:bg-muted/60 h-7 px-2 gap-1.5 cursor-pointer"
              data-testid="thinking-effort-selector"
            />
          }
        >
          <GaugeIcon className="h-3.5 w-3.5" />
          <span className="truncate">{currentOption.label}</span>
        </TooltipTrigger>
        <TooltipContent>{t("ai.thinkingEffortTooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>{t("ai.thinkingEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THINKING_EFFORT_OPTIONS.map((option) => {
          const isSelected = option.value === currentValue;
          return (
            <DropdownMenuItem
              key={option.value}
              className={cn(
                "relative px-2 py-1.5 cursor-pointer",
                isSelected &&
                  "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
              )}
              onClick={() => handleSelect(option.value)}
            >
              <div className="flex w-full items-start justify-between gap-2">
                <div className="min-w-0 flex flex-col">
                  <span className="text-[13px] leading-tight">
                    {option.label}
                    {option.value === THINKING_EFFORT_DEFAULT && (
                      <span className="text-muted-foreground">
                        {" "}
                        {t("ai.defaultSuffix")}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </div>
                {isSelected && (
                  <CheckIcon className="mt-0.5 size-3.5 text-primary shrink-0" />
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
