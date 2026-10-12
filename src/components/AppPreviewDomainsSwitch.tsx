import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_ENABLE_APP_PREVIEW_DOMAINS } from "@/shared/settings_defaults";

export function AppPreviewDomainsSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-app-preview-domains"
          aria-label="App-specific localhost domains"
          checked={
            settings?.enableAppPreviewDomains ??
            DEFAULT_ENABLE_APP_PREVIEW_DOMAINS
          }
          disabled={!settings}
          onCheckedChange={(checked) => {
            // The settings mutation displays its own error toast.
            void updateSettings({
              enableAppPreviewDomains: checked,
              ...(checked && { hideAppPreviewDomainsBanner: false }),
            }).catch(() => {});
          }}
        />
        <Label htmlFor="enable-app-preview-domains">
          App-specific localhost domains
        </Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Use <code>app-&lt;id&gt;.localhost</code> preview addresses to keep each
        app's cookies separate. On by default. Restart running apps to apply
        changes.
      </p>
    </div>
  );
}
