import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles, Info } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import { hasDyadProKey, type UserSettings } from "@/lib/schemas";

export function ProModeSelector() {
  const { settings, updateSettings } = useSettings();

  const toggleWebSearch = () => {
    updateSettings({
      enableProWebSearch: !settings?.enableProWebSearch,
    });
  };

  const toggleLazyEdits = () => {
    updateSettings({
      enableProLazyEditsMode: !settings?.enableProLazyEditsMode,
    });
  };

  const handleSmartContextChange = (
    newValue: "off" | "conservative" | "balanced",
  ) => {
    if (newValue === "off") {
      updateSettings({
        enableProSmartFilesContextMode: false,
        proSmartContextOption: undefined,
      });
    } else if (newValue === "conservative") {
      updateSettings({
        enableProSmartFilesContextMode: true,
        proSmartContextOption: "conservative",
      });
    } else if (newValue === "balanced") {
      updateSettings({
        enableProSmartFilesContextMode: true,
        proSmartContextOption: "balanced",
      });
    }
  };

  const toggleProEnabled = () => {
    updateSettings({
      enableDyadPro: !settings?.enableDyadPro,
    });
  };

  const hasProKey = settings ? hasDyadProKey(settings) : false;
  const proModeTogglable = hasProKey && Boolean(settings?.enableDyadPro);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="has-[>svg]:px-1.5 flex items-center gap-1.5 h-8 border-primary/50 hover:bg-primary/10 font-medium shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-primary font-medium text-xs-sm">Pro</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Configure Dyad Pro settings</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 border-primary/20">
        <div className="space-y-4">
          <div className="space-y-1">
            <h4 className="font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-primary font-medium">Dyad Pro</span>
            </h4>
            <div className="h-px bg-gradient-to-r from-primary/50 via-primary/20 to-transparent" />
          </div>
          {!hasProKey && (
            <div className="text-sm text-center text-muted-foreground">
              <a
                className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => {
                  IpcClient.getInstance().openExternalUrl(
                    "https://dyad.sh/pro#ai",
                  );
                }}
              >
                Unlock Pro modes
              </a>
            </div>
          )}
          <div className="flex flex-col gap-5">
            <SelectorRow
              id="pro-enabled"
              label="Enable Dyad Pro"
              description="Use Dyad Pro AI credits"
              tooltip="Uses Dyad Pro AI credits for the main AI model and Pro modes."
              isTogglable={hasProKey}
              settingEnabled={Boolean(settings?.enableDyadPro)}
              toggle={toggleProEnabled}
            />
            <SelectorRow
              id="web-search"
              label="Web Search"
              description="Search the web for information"
              tooltip="Uses the web to search for information"
              isTogglable={proModeTogglable}
              settingEnabled={Boolean(settings?.enableProWebSearch)}
              toggle={toggleWebSearch}
            />
            <SelectorRow
              id="lazy-edits"
              label="Turbo Edits"
              description="Makes file edits faster and cheaper"
              tooltip="Uses a faster, cheaper model to generate full file updates."
              isTogglable={proModeTogglable}
              settingEnabled={Boolean(settings?.enableProLazyEditsMode)}
              toggle={toggleLazyEdits}
            />
            <SmartContextSelector
              isTogglable={proModeTogglable}
              settings={settings}
              onValueChange={handleSmartContextChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SelectorRow({
  id,
  label,
  description,
  tooltip,
  isTogglable,
  settingEnabled,
  toggle,
}: {
  id: string;
  label: string;
  description: string;
  tooltip: string;
  isTogglable: boolean;
  settingEnabled: boolean;
  toggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Label
          htmlFor={id}
          className={!isTogglable ? "text-muted-foreground/50" : ""}
        >
          {label}
        </Label>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
              />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-72">
              {tooltip}
            </TooltipContent>
          </Tooltip>
          <p
            className={`text-xs ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"} max-w-55`}
          >
            {description}
          </p>
        </div>
      </div>
      <Switch
        id={id}
        checked={isTogglable ? settingEnabled : false}
        onCheckedChange={toggle}
        disabled={!isTogglable}
      />
    </div>
  );
}

function SmartContextSelector({
  isTogglable,
  settings,
  onValueChange,
}: {
  isTogglable: boolean;
  settings: UserSettings | null;
  onValueChange: (value: "off" | "conservative" | "balanced") => void;
}) {
  // Determine current value based on settings
  const getCurrentValue = (): "off" | "conservative" | "balanced" => {
    if (!settings?.enableProSmartFilesContextMode) {
      return "off";
    }
    if (settings?.proSmartContextOption === "balanced") {
      return "balanced";
    }
    if (settings?.proSmartContextOption === "conservative") {
      return "conservative";
    }
    // Keep in sync with getModelClient in get_model_client.ts
    // If enabled but no option set (undefined/falsey), it's balanced
    return "balanced";
  };

  const currentValue = getCurrentValue();

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className={!isTogglable ? "text-muted-foreground/50" : ""}>
          Smart Context
        </Label>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
              />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-72">
              Improve efficiency and save credits working on large codebases.
            </TooltipContent>
          </Tooltip>
          <p
            className={`text-xs ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
          >
            Optimizes your AI's code context
          </p>
        </div>
      </div>
      <div className="inline-flex rounded-md border border-input">
        <Button
          variant={currentValue === "off" ? "default" : "ghost"}
          size="sm"
          onClick={() => onValueChange("off")}
          disabled={!isTogglable}
          className="rounded-r-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
        >
          Off
        </Button>
        <Button
          variant={currentValue === "conservative" ? "default" : "ghost"}
          size="sm"
          onClick={() => onValueChange("conservative")}
          disabled={!isTogglable}
          className="rounded-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
        >
          Conservative
        </Button>
        <Button
          variant={currentValue === "balanced" ? "default" : "ghost"}
          size="sm"
          onClick={() => onValueChange("balanced")}
          disabled={!isTogglable}
          className="rounded-l-none h-8 px-3 text-xs flex-shrink-0"
        >
          Balanced
        </Button>
      </div>
    </div>
  );
}
