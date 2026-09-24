import os from "node:os";

/**
 * Repository-local Git config and hooks are untrusted in Docker mode: until
 * `.git` was hidden from the container, the guest could write them, and host
 * Git would then run whatever they name on the next ordinary command
 * (`core.fsmonitor` runs during `git status`). Hiding `.git` from the guest is
 * the primary fix; these overrides neutralize a repository that was already
 * poisoned. They are applied through `GIT_CONFIG_*`, which takes precedence
 * over repository config.
 *
 * Filter and diff drivers cannot be disabled generically (their names are
 * user-defined); they are only reachable through `.git/config`, which the
 * guest can no longer write.
 */
export function getDockerModeGitHardeningConfig(
  platform: NodeJS.Platform = process.platform,
): [key: string, value: string][] {
  return [
    ["core.fsmonitor", "false"],
    // A path with no hooks in it. `/dev/null` (NUL on Windows) is not a
    // directory, so Git finds no hook to run.
    ["core.hooksPath", platform === "win32" ? "NUL" : os.devNull],
    ["core.sshCommand", "ssh"],
    ["core.pager", "cat"],
    ["protocol.ext.allow", "never"],
  ];
}

/**
 * Appends config entries after any `GIT_CONFIG_*` entries already in `env`
 * (Dyad's per-invocation auth uses the same mechanism), so neither set
 * overwrites the other.
 */
export function appendGitConfigEnv(
  env: Record<string, string | undefined>,
  entries: [key: string, value: string][],
): Record<string, string | undefined> {
  const existing = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
  const offset = Number.isFinite(existing) && existing > 0 ? existing : 0;
  const next: Record<string, string | undefined> = { ...env };
  entries.forEach(([key, value], index) => {
    next[`GIT_CONFIG_KEY_${offset + index}`] = key;
    next[`GIT_CONFIG_VALUE_${offset + index}`] = value;
  });
  next.GIT_CONFIG_COUNT = String(offset + entries.length);
  return next;
}
