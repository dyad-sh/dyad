// This module is safe to import in both the main and renderer processes.
// Keep renderer-consumed defaults here free of runtime side effects.
export const DEFAULT_ENABLE_TESTING_FOR_NEW_APPS = false;

// Worktree isolation is opt-in, so its toggle stays out of DEFAULT_SETTINGS.
// These limits apply once it is enabled.
export const DEFAULT_WORKTREE_ISOLATION_MAX_WORKSPACES_PER_APP = 4;
export const DEFAULT_WORKTREE_ISOLATION_IDLE_HOURS = 72;
