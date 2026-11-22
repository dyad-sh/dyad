import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function SupabaseSelfHostedExperimentSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-supabase-self-hosted"
          aria-label="Allow self-hosted Supabase"
          checked={!!settings?.enableSupabaseSelfHosted}
          onCheckedChange={(checked) => {
            void updateSettings({ enableSupabaseSelfHosted: checked });
          }}
        />
        <Label htmlFor="enable-supabase-self-hosted">
          Allow self-hosted Supabase
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Connect apps to a Supabase instance you run yourself, such as one
        deployed with Docker Compose or Coolify. Edge functions are not deployed
        to self-hosted instances yet.
      </p>
    </div>
  );
}
