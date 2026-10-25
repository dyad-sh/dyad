import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MAX_REUSABLE_TEST_SANDBOXES } from "@/shared/settings_defaults";

export function ParallelTestRunSettings() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch
          id="parallel-test-runs"
          aria-label="Allow parallel E2E test runs"
          checked={!!settings?.enableParallelTestRuns}
          disabled={!settings}
          onCheckedChange={(checked) => {
            void updateSettings({ enableParallelTestRuns: checked }).catch(
              () => {},
            );
          }}
        />
        <Label htmlFor="parallel-test-runs">Allow parallel E2E test runs</Label>
      </div>
      <p className="text-sm text-muted-foreground">
        Starts with one run. After each run finishes, concurrency increases when
        all slots were in use and peak system CPU and memory stayed below 90%.
        If either exceeded 90%, queued runs wait for the active batch to finish.
        Concurrency then decreases by one for the whole batch. Running tests
        continue, each in its own browser.
      </p>
      <div className="flex items-center gap-3">
        <Label htmlFor="max-reusable-test-sandboxes">
          Reusable sandboxes to keep
        </Label>
        <Input
          id="max-reusable-test-sandboxes"
          className="w-24"
          type="number"
          min={0}
          max={128}
          disabled={!settings}
          key={`sandboxes-${settings?.maxReusableTestSandboxes}`}
          defaultValue={
            settings?.maxReusableTestSandboxes ??
            DEFAULT_MAX_REUSABLE_TEST_SANDBOXES
          }
          onBlur={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 0 && value <= 128)
              void updateSettings({ maxReusableTestSandboxes: value }).catch(
                () => {},
              );
            else
              event.target.value = String(
                settings?.maxReusableTestSandboxes ??
                  DEFAULT_MAX_REUSABLE_TEST_SANDBOXES,
              );
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        When the reusable pool is busy or full, eligible runs use temporary
        sandboxes that are removed afterward. Idle sandboxes keep their Git
        worktree and reusable dependencies; run files and credentials are
        removed.
      </p>
    </div>
  );
}
