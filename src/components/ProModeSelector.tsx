import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sparkles, Info } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { hasDyadProKey } from "@/lib/schemas";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

export function ProModeSelector() {
  const { settings, updateSettings } = useSettings();
  const subscription = useSubscriptionAccount();
  const claudeStatus = useQuery({
    queryKey: queryKeys.system.claudeCodeStatus,
    queryFn: () => ipc.chat.claudeCodeStatus({}),
    enabled: !!settings?.enableClaudeCodeSubscription,
    staleTime: 10_000,
  });
  const claudeConnected =
    !!settings?.enableClaudeCodeSubscription &&
    !!claudeStatus.data?.connected &&
    !!claudeStatus.data?.compatible;
  const subscriptionConnected = subscription.data?.connected || claudeConnected;

  const toggleProEnabled = () => {
    updateSettings({
      enableDyadPro: !settings?.enableDyadPro,
    });
  };

  const hasProKey = settings ? hasDyadProKey(settings) : false;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-primary/95 hover:text-primary hover:bg-primary/10 h-7 px-2 gap-1 cursor-pointer" />
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-medium">Pro</span>
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
                className="inline-flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary shadow-sm transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                onClick={() => {
                  ipc.system.openExternalUrl("https://dyad.sh/pro#ai");
                }}
                title="Visit dyad.sh/pro to unlock Pro features"
              >
                Unlock Pro modes
              </a>
            </div>
          )}
          {hasProKey && (
            <div className="space-y-2">
              <Label>Model usage</Label>
              <ToggleGroup
                aria-label="Model usage"
                variant="outline"
                size="sm"
                orientation="vertical"
                className="w-full flex-col items-stretch gap-1 [&>button]:rounded-md [&>button]:border [&>button]:flex-none"
                value={[
                  settings?.proModelUsage === "api-key"
                    ? "api-key"
                    : subscriptionConnected && settings?.proModelUsage !== "pro"
                      ? "subscription"
                      : "pro",
                ]}
                onValueChange={(value) => {
                  if (
                    value[0] === "pro" ||
                    value[0] === "api-key" ||
                    (value[0] === "subscription" && subscriptionConnected)
                  )
                    void updateSettings({
                      proModelUsage: value[0] as
                        | "pro"
                        | "subscription"
                        | "api-key",
                    });
                }}
              >
                <ToggleGroupItem
                  value="subscription"
                  disabled={!subscriptionConnected}
                  className="text-xs"
                >
                  {settings?.enableClaudeCodeSubscription
                    ? "Subscriptions"
                    : "ChatGPT Subscription"}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="pro"
                  className="text-xs"
                  onClick={() => {
                    // Disconnected accounts display Pro even when the saved
                    // preference still requires subscription credentials.
                    // Clicking that selected toggle emits an empty value.
                    if (
                      !subscriptionConnected &&
                      settings?.proModelUsage !== "api-key" &&
                      settings?.proModelUsage !== "pro"
                    )
                      void updateSettings({ proModelUsage: "pro" });
                  }}
                >
                  Pro credits
                </ToggleGroupItem>
                <ToggleGroupItem value="api-key" className="text-xs">
                  Your API keys & local
                </ToggleGroupItem>
              </ToggleGroup>
              {settings?.proModelUsage === "api-key" && (
                <p className="text-xs text-muted-foreground">
                  Provider charges apply separately. Pro features also use Dyad
                  credits. Local models use the lower Dyad rate.
                </p>
              )}
            </div>
          )}
          <SelectorRow
            id="pro-enabled"
            label="Enable Dyad Pro"
            tooltip="Uses your selected model usage source and Dyad Pro credits for Pro features."
            isTogglable={hasProKey}
            settingEnabled={Boolean(settings?.enableDyadPro)}
            toggle={toggleProEnabled}
          />
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
        <span title={tooltip}>
          <Info
            className={`h-4 w-4 cursor-help ${!isTogglable ? "text-muted-foreground/50" : "text-muted-foreground"}`}
          />
        </span>
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={isTogglable ? settingEnabled : false}
        onCheckedChange={toggle}
        disabled={!isTogglable}
      />
    </div>
  );
}
