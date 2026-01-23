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

  const handleTurboEditsChange = (newValue: "off" | "v1" | "v2") => {
    updateSettings({
      enableProLazyEditsMode: newValue !== "off",
      proLazyEditsMode: newValue,
    });
  };

  const handleSmartContextChange = (newValue: "off" | "deep" | "balanced") => {
    if (newValue === "off") {
      updateSettings({
        enableProSmartFilesContextMode: false,
        proSmartContextOption: undefined,
      });
    } else if (newValue === "deep") {
      updateSettings({
        enableProSmartFilesContextMode: true,
        proSmartContextOption: "deep",
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                    onClick={() => {
                      IpcClient.getInstance().openExternalUrl(
                        "https://dyad.sh/pro#ai",
                      );
                    }}
                  >
                    Unlock Pro modes
                  </a>
                </TooltipTrigger>
                <TooltipContent>
                  Visit dyad.sh/pro to unlock Pro features
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          <div className="flex flex-col gap-5">
            <SelectorRow
              id="pro-enabled"
              label="Enable Dyad Pro"
              tooltip="Uses Dyad Pro AI credits for the main AI model and Pro modes."
              isTogglable={hasProKey}
              settingEnabled={Boolean(settings?.enableDyadPro)}
              toggle={toggleProEnabled}
            />
            <SelectorRow
              id="web-search"
              label="Web Access"
              tooltip="Allows Dyad to access the web (e.g. search for information)"
              isTogglable={proModeTogglable}
              settingEnabled={Boolean(settings?.enableProWebSearch)}
              toggle={toggleWebSearch}
            />

            <TurboEditsSelector
              isTogglable={proModeTogglable}
              settings={settings}
              onValueChange={handleTurboEditsChange}
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
  tooltip,
  isTogglable,
  settingEnabled,
  toggle,
}: {
  id: string;
  label: string;
  tooltip: string;
  isTogglable: boolean;
  settingEnabled: boolean;
  toggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={id}
          className={!isTogglable ? "text-muted-foreground/50" : ""}
        >
          {label}
        </Label>
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

function TurboEditsSelector({
  isTogglable,
  settings,
  onValueChange,
}: {
  isTogglable: boolean;
  settings: UserSettings | null;
  onValueChange: (value: "off" | "v1" | "v2") => void;
}) {
  // Determine current value based on settings
  const getCurrentValue = (): "off" | "v1" | "v2" => {
    if (!settings?.enableProLazyEditsMode) {
      return "off";
    }
    if (settings?.proLazyEditsMode === "v1") {
      return "v1";
    }
    if (settings?.proLazyEditsMode === "v2") {
      return "v2";
    }
    // Keep in sync with getModelClient in get_model_client.ts
    // If enabled but no option set (undefined/falsey), it's v1
    return "v1";
  };

  const currentValue = getCurrentValue();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label className={!isTogglable ? "text-muted-foreground/50" : ""}>
          Turbo Edits
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info
              className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
            />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-72">
            Edits files efficiently without full rewrites.
            <br />
            <ul className="list-disc ml-4">
              <li>
                <b>Classic:</b> Uses a smaller model to complete edits.
              </li>
              <li>
                <b>Search & replace:</b> Find and replaces specific text blocks.
              </li>
            </ul>
          </TooltipContent>
        </Tooltip>
      </div>
      <div
        className="inline-flex rounded-md border border-input"
        data-testid="turbo-edits-selector"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "off" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("off")}
              disabled={!isTogglable}
              className="rounded-r-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
            >
              Off
            </Button>
          </TooltipTrigger>
          <TooltipContent>Disable Turbo Edits</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "v1" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("v1")}
              disabled={!isTogglable}
              className="rounded-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
            >
              Classic
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Uses a smaller model to complete edits
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "v2" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("v2")}
              disabled={!isTogglable}
              className="rounded-l-none h-8 px-3 text-xs flex-shrink-0"
            >
              Search & replace
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Find and replaces specific text blocks
          </TooltipContent>
        </Tooltip>
      </div>
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
  onValueChange: (value: "off" | "balanced" | "deep") => void;
}) {
  // Determine current value based on settings
  const getCurrentValue = (): "off" | "conservative" | "balanced" | "deep" => {
    if (!settings?.enableProSmartFilesContextMode) {
      return "off";
    }
    if (settings?.proSmartContextOption === "deep") {
      return "deep";
    }
    if (settings?.proSmartContextOption === "balanced") {
      return "balanced";
    }
    // Keep logic in sync with isDeepContextEnabled in chat_stream_handlers.ts
    return "deep";
  };

  const currentValue = getCurrentValue();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label className={!isTogglable ? "text-muted-foreground/50" : ""}>
          Smart Context
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info
              className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
            />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-72">
            Selects the most relevant files as context to save credits working
            on large codebases.
          </TooltipContent>
        </Tooltip>
      </div>
      <div
        className="inline-flex rounded-md border border-input"
        data-testid="smart-context-selector"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "off" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("off")}
              disabled={!isTogglable}
              className="rounded-r-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
            >
              Off
            </Button>
          </TooltipTrigger>
          <TooltipContent>Disable Smart Context</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "balanced" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("balanced")}
              disabled={!isTogglable}
              className="rounded-none border-r border-input h-8 px-3 text-xs flex-shrink-0"
            >
              Balanced
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Selects most relevant files with balanced context size
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={currentValue === "deep" ? "default" : "ghost"}
              size="sm"
              onClick={() => onValueChange("deep")}
              disabled={!isTogglable}
              className="rounded-l-none h-8 px-3 text-xs flex-shrink-0"
            >
              Deep
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <b>Experimental:</b> Keeps full conversation history for maximum
            context and cache-optimized to control costs
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
