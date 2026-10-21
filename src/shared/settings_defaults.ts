// This module is safe to import in both the main and renderer processes.
// Keep renderer-consumed defaults here free of runtime side effects.
export const DEFAULT_ENABLE_TESTING_FOR_NEW_APPS = false;
export const DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION = true;
// Off until enabled. Kept out of DEFAULT_SETTINGS so a later default flip
// reaches users who never changed it.
export const DEFAULT_ENABLE_SUGGESTED_PROMPTS = false;
