// This module is safe to import in both the main and renderer processes.
// Keep renderer-consumed defaults here free of runtime side effects.
export const DEFAULT_ENABLE_TESTING_FOR_NEW_APPS = false;
export const DEFAULT_ENABLE_PREVIEW_COOKIE_ISOLATION = true;
export const DEFAULT_ENABLE_NEON_BRANCH_PROTECTION = true;
// Off until enabled. Kept out of DEFAULT_SETTINGS so a later default flip
// reaches users who never changed it.
export const DEFAULT_ENABLE_SUGGESTED_PROMPTS = false;

export const DEFAULT_SHOW_SYSTEM_RESOURCE_USAGE = true;

export const DEFAULT_MAX_CONCURRENT_TEST_RUNS = 2;

// Background Supabase Edge Function log polling. Off by default, including for
// users who never saved a preference: the agent fetches logs on demand.
export const DEFAULT_AUTO_FETCH_SUPABASE_EDGE_FUNCTION_LOGS = false;
