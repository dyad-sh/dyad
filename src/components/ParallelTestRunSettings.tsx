import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_MAX_CONCURRENT_TEST_RUNS } from "@/shared/settings_defaults";

export function ParallelTestRunSettings() {
  const { settings, updateSettings } = useSettings();
  const savedLimit =
    settings?.maxConcurrentTestRuns ?? DEFAULT_MAX_CONCURRENT_TEST_RUNS;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch
          id="parallel-test-runs"
          aria-label="Allow parallel E2E test runs"
          aria-describedby="concurrent-test-runs-description"
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
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="max-concurrent-test-runs">Concurrent tests</Label>
        <Input
          id="max-concurrent-test-runs"
          aria-describedby="concurrent-test-runs-description"
          className="w-24"
          type="number"
          min={1}
          max={128}
          step={1}
          disabled={!settings?.enableParallelTestRuns}
          key={savedLimit}
          defaultValue={savedLimit}
          onBlur={(event) => {
            if (!settings?.enableParallelTestRuns) return;
            const input = event.currentTarget;
            const value = input.valueAsNumber;
            if (Number.isInteger(value) && value >= 1 && value <= 128) {
              if (value !== savedLimit)
                void updateSettings({ maxConcurrentTestRuns: value }).catch(
                  () => {
                    input.value = String(savedLimit);
                  },
                );
            } else input.value = String(savedLimit);
          }}
        />
      </div>
      <p
        id="concurrent-test-runs-description"
        className="text-sm text-muted-foreground"
      >
        Maximum number of test runs at the same time across all apps. Each run
        uses its own browser. While enabled, tests run one at a time within each
        run, even when only one run is active. Show the browser opens a separate
        window instead of using the preview panel. Other runs wait for a slot or
        compatible database and workspace. Lowering this limit lets running
        tests finish.
      </p>
    </div>
  );
}
