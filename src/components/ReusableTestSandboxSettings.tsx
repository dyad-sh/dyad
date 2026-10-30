import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DEFAULT_MAX_REUSABLE_TEST_SANDBOXES } from "@/shared/settings_defaults";

export function ReusableTestSandboxSettings() {
  const { settings, updateSettings } = useSettings();
  const savedValue =
    settings?.maxReusableTestSandboxes ?? DEFAULT_MAX_REUSABLE_TEST_SANDBOXES;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="max-reusable-test-sandboxes">
          Reusable sandboxes to keep
        </Label>
        <Input
          id="max-reusable-test-sandboxes"
          aria-describedby="reusable-test-sandboxes-description"
          className="w-24"
          type="number"
          min={0}
          max={128}
          step={1}
          disabled={!settings}
          key={savedValue}
          defaultValue={savedValue}
          onBlur={(event) => {
            if (!settings) return;
            const input = event.currentTarget;
            const value = input.valueAsNumber;
            if (Number.isInteger(value) && value >= 0 && value <= 128) {
              if (value !== savedValue)
                void updateSettings({ maxReusableTestSandboxes: value }).catch(
                  () => {
                    input.value = String(savedValue);
                  },
                );
            } else input.value = String(savedValue);
          }}
        />
      </div>
      <p
        id="reusable-test-sandboxes-description"
        className="text-sm text-muted-foreground"
      >
        Reuse sandboxes and installed dependencies to speed up later test runs.
        Run files and credentials are removed after each run. Set to 0 to remove
        every sandbox after use.
      </p>
    </div>
  );
}
