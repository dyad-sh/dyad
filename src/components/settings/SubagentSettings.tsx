import { isDyadProEnabled } from "@/lib/schemas";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";
import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SettingRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  experimental?: boolean;
}

function SettingRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  experimental,
}: SettingRowProps) {
  return (
    <div id={id} className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-switch`}
          aria-label={label}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />
        <Label htmlFor={`${id}-switch`}>{label}</Label>
        {experimental && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            Experimental
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function AutoFixReviewIssuesSwitch({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { settings, updateSettings } = useSettings();
  if (!settings || !isDyadProEnabled(settings)) return null;

  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-1"}>
      <Switch
        id={compact ? "findings-auto-fix-review" : "auto-fix-review-issues"}
        aria-label="Automatically fix review findings"
        checked={!!settings.autoFixReviewIssues}
        onCheckedChange={(checked) =>
          updateSettings({ autoFixReviewIssues: checked })
        }
      />
      <Label
        htmlFor={
          compact ? "findings-auto-fix-review" : "auto-fix-review-issues"
        }
        className={compact ? "text-xs" : undefined}
      >
        Automatically fix review findings
      </Label>
    </div>
  );
}

export function SubagentSettings() {
  const { settings, updateSettings } = useSettings();
  if (!settings || !isDyadProEnabled(settings)) return null;

  return (
    <div className="mt-6 space-y-4 border-t pt-5">
      <div>
        <h3 className="font-medium">Sub-agents</h3>
        <p className="text-sm text-muted-foreground">
          Delegate research, review, and scoped implementation to visible Pro
          agents.
        </p>
      </div>
      <SettingRow
        id={SETTING_IDS.enableExplorerSubagent}
        label="Use Explorer sub-agent"
        description="Let Agent automatically delegate read-only codebase research."
        checked={!!settings.enableExplorerSubagent}
        onCheckedChange={(checked) =>
          updateSettings({ enableExplorerSubagent: checked })
        }
      />
      <SettingRow
        id={SETTING_IDS.enableAutoReview}
        label="Automatically review changes"
        description="After completed turns that change code, run the read-only Reviewer."
        checked={!!settings.enableAutoReview}
        onCheckedChange={(checked) =>
          updateSettings({ enableAutoReview: checked })
        }
      />
      <SettingRow
        id={SETTING_IDS.enableImplementerSubagent}
        label="Allow Implementer sub-agent"
        description="Allow one delegated writer to edit files within an explicit scope. Existing approvals still apply."
        checked={!!settings.enableImplementerSubagent}
        onCheckedChange={(checked) =>
          updateSettings({ enableImplementerSubagent: checked })
        }
        experimental
      />
      <div id={SETTING_IDS.autoFixReviewIssues} className="space-y-1">
        <AutoFixReviewIssuesSwitch />
        <p className="text-sm text-muted-foreground">
          Existing approvals still apply. Reviews that run before a queued
          message use a skippable 10-second fix countdown regardless of this
          setting.
        </p>
      </div>
    </div>
  );
}
