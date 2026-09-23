import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Escape hatch for the sandboxed E2E runtime. Stored inverted
 * (`disableSandboxedE2eTests`) so the sandbox stays the default for everyone
 * who never opens this, and only an explicit opt-out falls back to running
 * against the normal preview.
 */
export function SandboxedE2eTestsSwitch() {
  const { settings, updateSettings } = useSettings();
  const enabled = !settings?.disableSandboxedE2eTests;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-sandboxed-e2e-tests"
        aria-label="Run E2E Tests in an Isolated Sandbox"
        checked={enabled}
        // The stored value is inverted, so an unloaded (or failed) settings
        // query reads as "on" — flipping it then would write an opt-out derived
        // from a state nobody has read yet.
        disabled={!settings}
        onCheckedChange={(checked) => {
          updateSettings({ disableSandboxedE2eTests: !checked });
        }}
      />
      <Label htmlFor="enable-sandboxed-e2e-tests">
        Run E2E Tests in an Isolated Sandbox
      </Label>
    </div>
  );
}
