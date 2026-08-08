// Base port for fake LLM servers - each worker gets its own port
// Worker 0 -> 3500, Worker 1 -> 3501, etc.
// Shared between playwright.config.ts and test helpers to avoid
// importing the Playwright config from test code.
export const FAKE_LLM_BASE_PORT = 3500;
