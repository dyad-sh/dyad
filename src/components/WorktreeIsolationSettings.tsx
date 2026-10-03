import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import {
  DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS,
  DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP,
} from "@/shared/settings_defaults";

const CAPACITY_OPTIONS = [2, 4, 8, 12];
const IDLE_HOUR_OPTIONS = [
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 720, label: "30 days" },
];

export function WorktreeIsolationSettings() {
  const { settings, updateSettings } = useSettings();
  const enabled = !!settings?.enableWorktreeIsolation;
  const capacity =
    settings?.worktreeIsolationMaxWorkspacesPerApp ??
    DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP;
  const idleHours =
    settings?.worktreeIsolationIdleHours ??
    DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS;
  const capacityOptions = CAPACITY_OPTIONS.includes(capacity)
    ? CAPACITY_OPTIONS
    : [...CAPACITY_OPTIONS, capacity].sort((a, b) => a - b);
  const idleOptions = IDLE_HOUR_OPTIONS.some(({ hours }) => hours === idleHours)
    ? IDLE_HOUR_OPTIONS
    : [...IDLE_HOUR_OPTIONS, { hours: idleHours, label: `${idleHours} hours` }];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Switch
          id="enable-worktree-isolation"
          aria-label="Worktree isolation"
          checked={enabled}
          // Until settings load the switch reads `false` whatever the stored
          // value is, so a click here would send the opposite of what the
          // user sees once the query resolves.
          disabled={!settings}
          onCheckedChange={(checked) => {
            void updateSettings({ enableWorktreeIsolation: checked }).catch(
              () => {},
            );
          }}
        />
        <Label htmlFor="enable-worktree-isolation">Worktree isolation</Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        When another chat is already changing the same app, give the new chat
        its own Git branch and working directory. Dyad merges each chat&apos;s
        finished work back into the app&apos;s branch after checking the
        combined code. Turning this on affects the next turns you send; a
        running agent keeps its current workspace. Turning it off stops new
        isolated workspaces but keeps existing ones and their unfinished work.
      </p>
      {enabled && (
        <div className="flex flex-wrap gap-4 pt-1">
          <div className="space-y-1">
            <Label htmlFor="worktree-isolation-capacity" className="text-xs">
              Isolated workspaces per app
            </Label>
            <Select
              value={String(capacity)}
              onValueChange={(value) => {
                if (!value) return;
                const parsed = Number.parseInt(value, 10);
                void updateSettings({
                  worktreeIsolationMaxWorkspacesPerApp:
                    parsed === DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP
                      ? undefined
                      : parsed,
                }).catch(() => {});
              }}
            >
              <SelectTrigger
                id="worktree-isolation-capacity"
                className="w-[160px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {capacityOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                    {value === DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP
                      ? " (default)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="worktree-isolation-idle" className="text-xs">
              Clean up idle workspaces after
            </Label>
            <Select
              value={String(idleHours)}
              onValueChange={(value) => {
                if (!value) return;
                const parsed = Number.parseInt(value, 10);
                void updateSettings({
                  worktreeIsolationIdleHours:
                    parsed === DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS
                      ? undefined
                      : parsed,
                }).catch(() => {});
              }}
            >
              <SelectTrigger id="worktree-isolation-idle" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {idleOptions.map(({ hours, label }) => (
                  <SelectItem key={hours} value={String(hours)}>
                    {label}
                    {hours === DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS
                      ? " (default)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="basis-full text-xs text-muted-foreground">
            Only workspaces whose work is fully merged, with no running agent,
            preview, or pending merge, are removed. Chat history is kept, and a
            chat gets a workspace again when it needs one.
          </p>
        </div>
      )}
    </div>
  );
}
