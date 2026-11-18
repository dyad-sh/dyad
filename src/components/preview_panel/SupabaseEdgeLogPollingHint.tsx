import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS } from "@/shared/settings_defaults";

export function SupabaseEdgeLogPollingHint() {
  const { settings } = useSettings();
  const openSettings = useScrollAndNavigateTo("/settings", { highlight: true });
  if (
    !settings ||
    (settings.autoFetchSupabaseEdgeFunctionLogs ??
      DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS)
  ) {
    return null;
  }

  return (
    <p className="px-4 py-2 text-sm text-muted-foreground">
      Automatic Supabase Edge Function logs are off. The agent can still fetch
      them while debugging.{" "}
      <Button
        variant="link"
        className="h-auto p-0 text-sm"
        onClick={() =>
          void openSettings(
            SETTING_IDS.autoFetchSupabaseEdgeFunctionLogs,
            SECTION_IDS.integrations,
          )
        }
      >
        Open log settings
      </Button>
    </p>
  );
}
