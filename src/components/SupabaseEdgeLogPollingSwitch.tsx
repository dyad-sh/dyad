import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS } from "@/shared/settings_defaults";

export function SupabaseEdgeLogPollingSwitch() {
  const { settings, settingsLoading, refreshSettings, updateSettings } =
    useSettings();
  const isEnabled =
    settings?.autoFetchSupabaseEdgeFunctionLogs ??
    DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS;

  return (
    <div className="flex items-center gap-3">
      <div className="flex w-9 shrink-0">
        {settings && (
          <Switch
            id="auto-fetch-supabase-edge-function-logs"
            aria-labelledby="supabase-edge-logs-label"
            aria-describedby="supabase-edge-logs-description"
            checked={isEnabled}
            onCheckedChange={(checked) => {
              // The settings mutation displays its own error toast.
              void updateSettings({
                autoFetchSupabaseEdgeFunctionLogs: checked,
              }).catch(() => {});
            }}
          />
        )}
      </div>
      <div className="space-y-1">
        <Label
          id="supabase-edge-logs-label"
          htmlFor="auto-fetch-supabase-edge-function-logs"
          className="text-sm font-medium"
        >
          Automatically fetch Supabase Edge Function logs
        </Label>
        <p
          id="supabase-edge-logs-description"
          className="text-xs text-gray-500 dark:text-gray-400"
        >
          Poll Supabase every few seconds while a connected app&apos;s Preview
          tab is visible and show Edge Function logs in the console. When this
          is off, the agent can still fetch Edge Function logs on demand while
          debugging.
        </p>
        {!settings && (
          <div className="space-y-2">
            <p role="status" className="text-sm text-muted-foreground">
              {settingsLoading
                ? "Loading settings…"
                : "Unable to load settings."}
            </p>
            {!settingsLoading && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshSettings().catch(() => {})}
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
