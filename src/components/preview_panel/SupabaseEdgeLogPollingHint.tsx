import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS } from "@/shared/settings_defaults";
import { hasSupabaseCredentialsForOrganization } from "@/lib/schemas";
import { useAtom } from "jotai";
import { supabaseEdgeLogPollingHintDismissedAtom } from "@/atoms/supabaseAtoms";
import { X } from "lucide-react";

export function SupabaseEdgeLogPollingHint({
  organizationSlug,
}: {
  organizationSlug: string | null;
}) {
  const { settings } = useSettings();
  const [dismissed, setDismissed] = useAtom(
    supabaseEdgeLogPollingHintDismissedAtom,
  );
  const openSettings = useScrollAndNavigateTo("/settings", { highlight: true });
  if (
    !settings ||
    dismissed ||
    !hasSupabaseCredentialsForOrganization(settings, organizationSlug) ||
    (settings.autoFetchSupabaseEdgeFunctionLogs ??
      DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS)
  ) {
    return null;
  }

  return (
    <div className="flex items-start gap-2 px-4 py-2 text-sm text-muted-foreground">
      <p className="min-w-0 flex-1">
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
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label="Dismiss Supabase log polling hint"
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
