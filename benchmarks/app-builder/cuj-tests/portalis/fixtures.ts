// Portalis — shared suite helpers (design/app-3-portalis.md).
//
// Conventions (identical in spirit to relay-crm/fixtures.ts):
// - Serial suites: later CUJs depend on data created by earlier ones.
// - Personas own a browser context each; raw-HTTP probes go through
//   context.request so they carry exactly that persona's cookies.
// - Ids come only from pinned surfaces: GET /api/me (own id), data-user-id,
//   data-org-id, data-project-id, data-key-id, data-audit-id, and pinned API
//   `id` fields. Never guessed, never read from the database.
// - Every identity/org/project is RUN_ID-suffixed so reruns never collide.
import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

export const RUN_ID = `${Date.now()}`;
export const PASSWORD = "Passw0rd!Portalis1";

// The design pins `portalis-m1-<cujId>-<Date.now()>-<a|b>@example.test`.
// Identities are minted per (checkpoint, persona) rather than per scenario
// because the CUJ tables are explicitly stateful across scenarios (P1-04
// creates a *second* org, P1-08 reuses org 1's slug, P1-09 has B visit A's
// org). RUN_ID keeps them unique across reruns, which is what the pattern is
// for.
export const identity = (checkpoint: string, who: string) => ({
  name: `Portalis ${who.toUpperCase()}`,
  email: `portalis-${checkpoint}-${RUN_ID}-${who}@example.test`,
  password: PASSWORD,
});

// Any UUID version. The pinned requirement is "MUST be a UUID, never a
// sequential integer" (M1 hard requirements) and "the id is not an integer"
// (P1-03); requiring v4 specifically would false-fail a valid v7/v1 id.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_ID_IN_URL =
  /\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function appBaseURL(): string {
  return String(
    test.info().project.use.baseURL ?? "http://localhost:3000",
  ).replace(/\/$/, "");
}

export async function anonContext(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: appBaseURL() });
}

export async function bearerContext(key: string): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: appBaseURL(),
    extraHTTPHeaders: { Authorization: `Bearer ${key}` },
  });
}

// ---- auth -----------------------------------------------------------------

export async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
}

export async function signIn(
  page: Page,
  who: { email: string; password: string },
) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
}

// "Signed-in users land on /orgs". A redirect is given its natural moment,
// then /orgs is requested explicitly — the pinned signal is the signed-in
// header, not the speed of a client-side redirect.
export async function expectSignedIn(page: Page, email: string) {
  await page.waitForURL("**/orgs**", { timeout: 5_000 }).catch(async () => {
    await page.goto("/orgs");
  });
  await expect(page.getByTestId("user-email")).toContainText(email, {
    timeout: 15_000,
  });
}

export async function signUpAndLand(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await signUp(page, who);
  await expectSignedIn(page, who.email);
}

// Pinned GET /api/me — the id-provenance anchor for a persona's own id.
export async function getMe(context: BrowserContext): Promise<any> {
  const resp = await context.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return resp.json();
}

export function membershipRoles(me: any, orgId: string): string[] {
  return (me?.memberships ?? [])
    .filter((m: any) => String(m.orgId ?? m.org_id ?? m.id) === orgId)
    .map((m: any) => String(m.role));
}

// ---- orgs -----------------------------------------------------------------

export function orgIdFromUrl(url: string): string | null {
  const match = url.match(ORG_ID_IN_URL);
  return match ? match[1] : null;
}

export async function createOrg(
  page: Page,
  name: string,
  slug: string,
): Promise<string> {
  await page.goto("/orgs");
  const link = page.getByTestId("create-org-link");
  // The pinned empty-state link only has to exist when the user has no orgs;
  // /orgs/new is the pinned route either way.
  if (await link.count()) {
    await link.first().click();
  } else {
    await page.goto("/orgs/new");
  }
  await page.getByTestId("org-name-input").fill(name);
  await page.getByTestId("org-slug-input").fill(slug);
  await page.getByTestId("create-org-submit").click();
  await page.waitForURL(ORG_ID_IN_URL, { timeout: 20_000 });
  const orgId = orgIdFromUrl(page.url());
  expect(
    orgId,
    `org id in URL after creating "${name}" (${page.url()})`,
  ).toBeTruthy();
  return orgId!;
}

export async function switchOrg(page: Page, orgId: string, name: string) {
  const switcher = page.getByTestId("org-switcher").first();
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await switcher.selectOption(orgId);
  } else {
    await switcher.click();
    await page
      .locator(`[data-testid="org-switcher-option"][data-org-id="${orgId}"]`)
      .first()
      .click();
  }
  await page.waitForURL(new RegExp(`/orgs/${orgId}`), { timeout: 20_000 });
  await expect(page.getByTestId("org-header-name")).toContainText(name, {
    timeout: 15_000,
  });
}

// ---- rows (attribute-pinned, with a text fallback) -------------------------

export function memberRow(page: Page, email: string): Locator {
  return page
    .locator(`[data-testid="member-row"][data-member-email="${email}"]`)
    .or(page.getByTestId("member-row").filter({ hasText: email }))
    .first();
}

export function inviteRow(page: Page, email: string): Locator {
  return page
    .locator(`[data-testid="invite-row"][data-invite-email="${email}"]`)
    .or(page.getByTestId("invite-row").filter({ hasText: email }))
    .first();
}

// ---- invites --------------------------------------------------------------

export async function inviteMember(
  page: Page,
  orgId: string,
  email: string,
  role: "org_admin" | "org_member",
) {
  await page.goto(`/orgs/${orgId}/members`);
  await page.getByTestId("invite-email-input").fill(email);
  const roleSelect = page.getByTestId("invite-role-select");
  if (await roleSelect.count()) {
    await roleSelect.first().selectOption(role);
  }
  await page.getByTestId("invite-submit").click();
  await expect(inviteRow(page, email)).toBeVisible({ timeout: 15_000 });
}

// The full absolute accept URL is pinned as the TEXT of `invite-link`.
export async function inviteLinkFor(
  page: Page,
  orgId: string,
  email: string,
): Promise<string> {
  await page.goto(`/orgs/${orgId}/members`);
  const row = inviteRow(page, email);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const link = row.getByTestId("invite-link").first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  return ((await link.textContent()) ?? "").trim();
}

export function tokenFromInviteLink(link: string): string {
  const after = link.split("/invite/")[1] ?? "";
  return after.split(/[?#/]/)[0];
}

export async function acceptInviteAt(page: Page, link: string) {
  await page.goto(link);
  await page.getByTestId("accept-invite-submit").click();
}

// ---- projects -------------------------------------------------------------

export async function createProject(
  page: Page,
  orgId: string,
  name: string,
  description = `desc ${RUN_ID}`,
): Promise<string> {
  await page.goto(`/orgs/${orgId}/projects/new`);
  await page.getByTestId("project-name-input").fill(name);
  const desc = page.getByTestId("project-description-input");
  if (await desc.count()) {
    await desc.first().fill(description);
  }
  await page.getByTestId("project-create-submit").click();
  await page.goto(`/orgs/${orgId}/projects`);
  const row = page.getByTestId("project-row").filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const id = await row.getAttribute("data-project-id");
  expect(id, `data-project-id for project "${name}"`).toBeTruthy();
  return String(id);
}

export async function projectIdSet(
  page: Page,
  orgId: string,
): Promise<Set<string>> {
  await page.goto(`/orgs/${orgId}/projects`);
  const ids = await page
    .getByTestId("project-row")
    .evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-project-id") ?? ""),
    );
  return new Set(ids.filter(Boolean));
}

// ---- api keys -------------------------------------------------------------

export async function createApiKey(
  page: Page,
  orgId: string,
  name: string,
): Promise<string> {
  await page.goto(`/orgs/${orgId}/api-keys`);
  await page.getByTestId("apikey-name-input").fill(name);
  await page.getByTestId("apikey-create-submit").click();
  const plaintext = page.getByTestId("apikey-plaintext").first();
  await expect(plaintext).toBeVisible({ timeout: 15_000 });
  const secret = ((await plaintext.textContent()) ?? "").trim();
  expect(secret.length, "api key plaintext length").toBeGreaterThan(0);
  return secret;
}

export function apiKeyRow(page: Page, name: string): Locator {
  return page.getByTestId("apikey-row").filter({ hasText: name }).first();
}

// ---- assertions -----------------------------------------------------------

// A denied *page*: 404, the pinned `not-authorized` view, or a redirect to
// sign-in — and never any of the forbidden strings in the HTML.
export async function expectDeniedPage(
  page: Page,
  url: string,
  forbidden: string[],
) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = resp?.status() ?? 0;
  const html = await page.content();
  const denied = await page.getByTestId("not-authorized").count();
  const onSignIn = /\/auth\/sign-in/.test(page.url());
  expect(
    status === 404 || status === 403 || denied > 0 || onSignIn,
    `${url} must deny access (status ${status}, landed on ${page.url()})`,
  ).toBeTruthy();
  expectNoLeak(html, forbidden, url);
}

export function expectNoLeak(body: string, forbidden: string[], label: string) {
  for (const needle of forbidden) {
    if (!needle) continue;
    expect(body, `${label} must not leak "${needle}"`).not.toContain(needle);
  }
}

// Formatting-insensitive numeric read (e.g. "2 members" -> 2).
export async function numericText(locator: {
  textContent(): Promise<string | null>;
}): Promise<number> {
  const text = (await locator.textContent()) ?? "";
  const match = text.replace(/[,\s]/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}
