/**
 * Templates for the generated `e2e-tests/fixtures/test-user.ts` sign-in helper.
 * Auth-gated specs call `await signIn(page)` instead of driving the login UI;
 * the helper reads the isolated-session credentials Dyad injects into the run.
 */

export type RecorderAuthMode =
  | "none"
  | "neon-better-auth"
  | "supabase-password";

/**
 * Marker stamped into a generated fixture, naming its auth mode. How the writer
 * tells "mine, for this backend" from "mine, for the other one" from "the
 * user's own" — an app that moved between Neon and Supabase needs a new file.
 */
export function fixtureMarker(mode: Exclude<RecorderAuthMode, "none">): string {
  return `// dyad-generated-fixture: ${mode}`;
}

/** The auth mode a fixture declares, or null when it isn't Dyad-generated. */
export function readFixtureMode(
  source: string,
): Exclude<RecorderAuthMode, "none"> | null {
  for (const mode of ["neon-better-auth", "supabase-password"] as const) {
    if (source.includes(fixtureMarker(mode))) return mode;
  }
  return null;
}

// Written as arrays of plain double-quoted lines so the emitted source can
// contain backticks and ${...} verbatim without escaping.
const NEON_BETTER_AUTH_FIXTURE: string[] = [
  `import { expect, type Page } from "@playwright/test";`,
  ``,
  `/**`,
  ` * Sign in the Dyad-provisioned test user by driving the app's own Better Auth`,
  ` * endpoint from the page itself, so Chromium accepts the HttpOnly session`,
  ` * cookie exactly as it does for an interactive sign-in.`,
  ` *`,
  ` * Dyad provisions an isolated user per test run and injects its credentials`,
  ` * via DYAD_TEST_USER_EMAIL / DYAD_TEST_USER_PASSWORD.`,
  ` */`,
  `export async function signIn(page: Page): Promise<void> {`,
  `  const email = process.env.DYAD_TEST_USER_EMAIL;`,
  `  const password = process.env.DYAD_TEST_USER_PASSWORD;`,
  `  if (!email || !password) {`,
  `    throw new Error(`,
  `      "DYAD_TEST_USER_EMAIL / DYAD_TEST_USER_PASSWORD are not set. Run this test from Dyad's Tests panel so an isolated user is provisioned.",`,
  `    );`,
  `  }`,
  `  const origin = new URL(`,
  `    process.env.DYAD_TEST_BASE_URL || "http://localhost:32100",`,
  `  ).origin;`,
  `  if (page.url() === "about:blank" || new URL(page.url()).origin !== origin) {`,
  `    await page.goto(origin);`,
  `  }`,
  `  const result = await page.evaluate(`,
  `    async ({ email, password }) => {`,
  `      const response = await fetch("/api/auth/sign-in/email", {`,
  `        method: "POST",`,
  `        headers: { "Content-Type": "application/json" },`,
  `        credentials: "include",`,
  `        body: JSON.stringify({ email, password }),`,
  `      });`,
  `      return { ok: response.ok, status: response.status };`,
  `    },`,
  `    { email, password },`,
  `  );`,
  `  expect(`,
  `    result.ok,`,
  "    `Better Auth sign-in failed (${result.status})`,",
  `  ).toBeTruthy();`,
  `}`,
  ``,
];

const SUPABASE_PASSWORD_FIXTURE: string[] = [
  `import { expect, type Page } from "@playwright/test";`,
  ``,
  `/**`,
  ` * Sign in the Dyad-provisioned Supabase test user via the password grant,`,
  ` * then seed supabase-js's session into localStorage before the app loads so`,
  ` * it boots authenticated. Dyad injects the project URL, anon key, and the`,
  ` * isolated user's credentials.`,
  ` */`,
  `export async function signIn(page: Page): Promise<void> {`,
  `  const url = process.env.DYAD_TEST_SUPABASE_URL;`,
  `  const anonKey = process.env.DYAD_TEST_SUPABASE_ANON_KEY;`,
  `  const email = process.env.DYAD_TEST_USER_EMAIL;`,
  `  const password = process.env.DYAD_TEST_USER_PASSWORD;`,
  `  if (!url || !anonKey || !email || !password) {`,
  `    throw new Error(`,
  `      "Supabase test credentials are not set. Run this test from Dyad's Tests panel so an isolated user is provisioned.",`,
  `    );`,
  `  }`,
  `  const response = await page.request.post(`,
  "    `${url}/auth/v1/token?grant_type=password`,",
  `    {`,
  `      headers: { apikey: anonKey, "Content-Type": "application/json" },`,
  `      data: { email, password },`,
  `    },`,
  `  );`,
  `  expect(`,
  `    response.ok(),`,
  "    `Supabase sign-in failed (${response.status()})`,",
  `  ).toBeTruthy();`,
  `  const session = await response.json();`,
  `  const projectRef = new URL(url).host.split(".")[0];`,
  "  const storageKey = `sb-${projectRef}-auth-token`;",
  `  await page.context().addInitScript(`,
  `    ([key, value]) => {`,
  `      window.localStorage.setItem(key, value);`,
  `    },`,
  `    [storageKey, JSON.stringify(session)],`,
  `  );`,
  `}`,
  ``,
];

/** Generate the `e2e-tests/fixtures/test-user.ts` source for the given auth mode. */
export function generateTestUserFixtureSource(
  mode: Exclude<RecorderAuthMode, "none">,
): string {
  const body =
    mode === "neon-better-auth"
      ? NEON_BETTER_AUTH_FIXTURE
      : SUPABASE_PASSWORD_FIXTURE;
  return [fixtureMarker(mode), ...body].join("\n");
}
