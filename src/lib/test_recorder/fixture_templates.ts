/**
 * Templates for the generated `e2e-tests/fixtures/test-user.ts` sign-in helper.
 *
 * Recorded (and AI-written) auth-gated specs call `await signIn(page)` instead
 * of driving the login UI or hand-rolling credentials. The helper is generated
 * once per app from a per-auth-mode template — a plain, reviewable file — and
 * reads the isolated-session credentials Dyad injects into the Playwright run.
 */

export type RecorderAuthMode =
  | "none"
  | "neon-better-auth"
  | "supabase-password";

// Written as arrays of plain double-quoted lines so the emitted source can
// contain backticks and ${...} verbatim without escaping.
const NEON_BETTER_AUTH_FIXTURE: string[] = [
  `import { expect, type Page } from "@playwright/test";`,
  ``,
  `/**`,
  ` * Sign in the Dyad-provisioned test user by driving the app's own Better Auth`,
  ` * endpoint. The request shares the browser context's cookie jar, so the`,
  ` * session cookie rides along on subsequent navigations.`,
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
  `  const response = await page.request.post("/api/auth/sign-in/email", {`,
  `    data: { email, password },`,
  `  });`,
  `  expect(`,
  `    response.ok(),`,
  "    `Better Auth sign-in failed (${response.status()})`,",
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
  switch (mode) {
    case "neon-better-auth":
      return NEON_BETTER_AUTH_FIXTURE.join("\n");
    case "supabase-password":
      return SUPABASE_PASSWORD_FIXTURE.join("\n");
  }
}
