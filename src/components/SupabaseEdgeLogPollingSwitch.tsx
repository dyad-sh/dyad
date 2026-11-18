import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS } from "@/shared/settings_defaults";

export function SupabaseEdgeLogPollingSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled =
    settings?.autoFetchSupabaseEdgeFunctionLogs ??
    DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="auto-fetch-supabase-edge-function-logs"
          aria-label="Automatically fetch Supabase Edge Function logs"
          // Wait for saved settings so the switch never flashes the default.
          disabled={!settings}
          checked={isEnabled}
          onCheckedChange={(checked) => {
            // The settings mutation displays its own error toast.
            void updateSettings({
              autoFetchSupabaseEdgeFunctionLogs: checked,
            }).catch(() => {});
          }}
        />
        <Label htmlFor="auto-fetch-supabase-edge-function-logs">
          Automatically fetch Supabase Edge Function logs
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Poll Supabase every few seconds while a connected app&apos;s preview is
        open and show Edge Function logs in the console. When this is off, the
        agent can still fetch Edge Function logs on demand while debugging.
      </p>
    </div>
  );
}
