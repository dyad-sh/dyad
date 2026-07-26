import { ImageIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";
import { isFreeProModel } from "@/lib/freeProModel";
import { cn } from "@/lib/utils";

/**
 * Design-mode toggle for generated imagery.
 *
 * On, the agent gets the `generate_image` tool and is told to put real images
 * in the mockups instead of neutral placeholder rects. Off by default because
 * each image is a paid engine call — the user opts in when they want the
 * higher-fidelity pass.
 *
 * Image generation is Pro-only and goes through a separate engine endpoint the
 * free Pro model can't reach, so the toggle disables itself (with the reason)
 * rather than promising a tool the turn wouldn't actually have.
 */
export function DesignImagesToggle() {
  const { settings, updateSettings } = useSettings();

  const isPro = settings ? isDyadProEnabled(settings) : false;
  const isFreeModel = isFreeProModel(settings?.selectedModel);
  const enabled = settings?.enableDesignModeImages === true;

  const unavailableReason = !isPro
    ? "Generating images requires Dyad Pro"
    : isFreeModel
      ? "Generating images isn't available with Dyad Free — pick another model"
      : null;
  const isAvailable = unavailableReason === null;
  const isOn = isAvailable && enabled;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // aria-disabled rather than disabled: a disabled button swallows
          // hover events in some browsers, which would hide the very tooltip
          // that explains why it can't be used.
          <button
            type="button"
            data-testid="design-images-toggle"
            aria-pressed={isOn}
            aria-disabled={!isAvailable}
            aria-label="Generate images for mockups"
            onClick={() => {
              if (!isAvailable) return;
              updateSettings({ enableDesignModeImages: !enabled });
            }}
            className={cn(
              "flex h-6 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors",
              isAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-50",
              isOn
                ? "bg-pink-500/10 text-pink-600 hover:bg-pink-500/15 dark:bg-pink-500/15 dark:text-pink-400 dark:hover:bg-pink-500/20"
                : isAvailable
                  ? "text-foreground/60 hover:bg-muted/60 hover:text-foreground"
                  : "text-foreground/60",
            )}
          />
        }
      >
        <ImageIcon size={14} />
        Images
      </TooltipTrigger>
      <TooltipContent>
        {unavailableReason ??
          (isOn
            ? "Generating images for mockups — click to turn off"
            : "Generate images and use them in the mockups")}
      </TooltipContent>
    </Tooltip>
  );
}
