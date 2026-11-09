import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { CLAUDE_CROSS_DIRECTORY_RESUME_VERSION } from "@/shared/claude_code_cli";

export function WorktreeIsolationSettings() {
  const { settings, updateSettings } = useSettings();
  const enabled = !!settings?.enableWorktreeIsolation;

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
        Give every chat its own Git branch and working directory, including a
        new app&apos;s first chat. Dyad merges each chat&apos;s finished work
        back into the app&apos;s branch after checking the combined code.
        Turning this on affects the next turns you send; a running agent keeps
        its current workspace. Turning it off stops new isolated workspaces but
        keeps existing ones and their unfinished work. Claude Code subscription
        chats need Claude Code {CLAUDE_CROSS_DIRECTORY_RESUME_VERSION} or later;
        with an older CLI they keep working in the app&apos;s folder.
      </p>
      {enabled && (
        <p className="text-xs text-muted-foreground">
          Worktrees are kept after their work is merged, so each chat picks up
          where it left off. Delete a chat&apos;s worktree from its chat to free
          disk space; its next message creates a new one. Each worktree installs
          its own dependencies, which pnpm shares between worktrees and npm
          copies into each one.
        </p>
      )}
    </div>
  );
}
