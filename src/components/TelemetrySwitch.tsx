import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TelemetrySwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="telemetry-switch"
        checked={settings?.telemetryConsent === "opted_in"}
        onCheckedChange={() => {
          updateSettings({
            telemetryConsent:
              settings?.telemetryConsent === "opted_in"
                ? "opted_out"
                : "opted_in",
          });
        }}
      />
      <Label htmlFor="telemetry-switch">Telemetry</Label>
    </div>
  );
}
