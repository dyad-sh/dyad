// Portalis — shared suite helpers (design/app-3-portalis.md).
//
// Conventions:
// - INDEPENDENT tests. Every test provisions the exact world it needs through
//   the `world` fixture below and asserts only its own scenario; no test may
//   depend on another having signed someone up, created a record, promoted a
//   role, or left a page open. Nothing mutable lives at module scope.
// - Personas own a browser context each; raw-HTTP probes go through
//   `persona.ctx.request` so they carry exactly that persona's cookies.
// - Ids come only from pinned surfaces: GET /api/me (own id), data-user-id,
//   data-org-id, data-project-id, data-key-id, data-audit-id, and pinned API
//   `id` fields. Never guessed, never read from the database.
// - Every identity/org/project/key is scoped by (checkpoint, cuj id) and
//   RUN_ID-suffixed, so two tests never collide and reruns never collide.
// - Every browser context is created through `world` (which always passes
//   `videoOpts()`), and the fixture closes them on teardown — including when
//   the test fails — so videos flush and Postgres connections do not leak.
import { videoOpts } from "../video-context";
import {
  expect,
  request as pwRequest,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// Date.now() keeps the design's pinned identity shape; the random tail makes
// two runs started in the same millisecond (or two workers) safe as well.
export const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const PASSWORD = "Passw0rd!Portalis1";

// The design pins `portalis-m1-<cujId>-<Date.now()>-<a|b>@example.test`.
// `scope` is "<checkpoint>-<cuj id>" (e.g. "m2-p2-09"), so every test owns a
// private set of identities and can run alone or in any order.
export const identity = (scope: string, who: string) => ({
  name: `Portalis ${who.toUpperCase()}`,
  email: `portalis-${scope}-${RUN_ID}-${who}@example.test`,
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
    base.info().project.use.baseURL ?? "http://localhost:3000",
  ).replace(/\/$/, "");
}

// Wait for a create/update form to actually finish submitting before navigating
// away. Clicking submit fires a client-side request and then routes; a
// `page.goto` issued immediately aborts that request in flight, so the record
// is never written (this silently broke every provisioning helper once tests
// stopped inheriting state from each other).
export async function settleAfterSubmit(page: Page, formPath = "/new") {
  await page
    .waitForURL((u) => !u.pathname.endsWith(formPath), { timeout: 15_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
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
  // See relay-crm/fixtures.ts: provisioning proves the session functionally so
  // a header defect cannot zero every test; the header contract is asserted by
  // the CUJs that pin it.
  await page.waitForURL("**/orgs**", { timeout: 5_000 }).catch(async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.goto("/orgs");
  });
  await expect
    .poll(async () => (await page.request.get("/api/me")).status(), {
      timeout: 15_000,
    })
    .toBe(200);
  void email;
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
  role: OrgRole,
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

// The pinned removal flow: locate the member row by `data-member-email`, click
// that row's `member-remove`, then confirm (scoped confirm, else page-level).
export async function removeMemberVia(
  page: Page,
  orgId: string,
  email: string,
) {
  await page.goto(`/orgs/${orgId}/members`);
  const row = memberRow(page, email);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByTestId("member-remove").first().click();
  const scoped = row.getByTestId("member-remove-confirm");
  if (await scoped.count()) {
    await scoped.first().click();
  } else {
    await page.getByTestId("member-remove-confirm").first().click();
  }
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

// The pinned revoke flow: `apikey-revoke` on that key's row, then the row
// stays present with `apikey-status` = revoked.
export async function revokeApiKey(page: Page, orgId: string, name: string) {
  await page.goto(`/orgs/${orgId}/api-keys`);
  await apiKeyRow(page, name).getByTestId("apikey-revoke").first().click();
  await expect(apiKeyRow(page, name)).toBeVisible({ timeout: 15_000 });
  await expect(
    apiKeyRow(page, name).getByTestId("apikey-status"),
  ).toContainText("revoked", { timeout: 15_000 });
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

// ---- provisioning ---------------------------------------------------------
//
// Everything below exists so a single test can build exactly the world its
// scenario names in the design table, alone, in ~one round of UI flows.

export type OrgRole = "org_admin" | "org_member";

export type Persona = {
  ctx: BrowserContext;
  page: Page;
  name: string;
  email: string;
  password: string;
  /** From the pinned GET /api/me. */
  id: string;
  me: any;
};

export type OrgRef = { id: string; name: string; slug: string };
export type ProjectRef = { id: string; name: string };
export type ApiKeyRef = { id: string; name: string; secret: string };
export type InviteRef = { email: string; link: string; token: string };

/** Unique-per-(test, label) display name; also the pinned list-filter text. */
export function scopedName(scope: string, label: string): string {
  return `${label} ${scope} ${RUN_ID}`;
}

export function orgSpec(
  scope: string,
  label: string,
): { name: string; slug: string } {
  return {
    name: scopedName(scope, label),
    slug: `${label}-${scope}-${RUN_ID}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  };
}

/**
 * Owns every context a test creates. The `world` fixture disposes it on
 * teardown (pass or fail), so videos flush and no connection leaks.
 */
export class World {
  private readonly contexts: BrowserContext[] = [];
  private readonly apis: APIRequestContext[] = [];

  constructor(private readonly browser: Browser) {}

  /** A cookie-less browser context — always with videoOpts(). */
  async context(): Promise<BrowserContext> {
    const ctx = await this.browser.newContext(videoOpts());
    this.contexts.push(ctx);
    return ctx;
  }

  /** A brand-new signed-up persona with its own context, page and /api/me id. */
  async signUp(scope: string, who: string): Promise<Persona> {
    const ident = identity(scope, who);
    const ctx = await this.context();
    const page = await ctx.newPage();
    await signUpAndLand(page, ident);
    const me = await getMe(ctx);
    const id = String(me.id ?? "");
    expect(id, `${ident.email} id from GET /api/me`).not.toHaveLength(0);
    return { ctx, page, id, me, ...ident };
  }

  async anon(): Promise<APIRequestContext> {
    const api = await anonContext();
    this.apis.push(api);
    return api;
  }

  async bearer(key: string): Promise<APIRequestContext> {
    const api = await bearerContext(key);
    this.apis.push(api);
    return api;
  }

  async close(): Promise<void> {
    for (const api of this.apis.splice(0)) {
      await api.dispose().catch(() => undefined);
    }
    for (const ctx of this.contexts.splice(0)) {
      await ctx.close().catch(() => undefined);
    }
  }
}

export const test = base.extend<{ world: World }>({
  world: async ({ browser }, use) => {
    const world = new World(browser);
    try {
      await use(world);
    } finally {
      await world.close();
    }
  },
});

export { expect };

export async function provisionOrg(
  owner: Persona,
  scope: string,
  label: string,
): Promise<OrgRef> {
  const spec = orgSpec(scope, label);
  const id = await createOrg(owner.page, spec.name, spec.slug);
  return { id, ...spec };
}

export async function provisionProject(
  actor: Persona,
  org: OrgRef,
  scope: string,
  label: string,
): Promise<ProjectRef> {
  const name = scopedName(scope, label);
  const id = await createProject(actor.page, org.id, name);
  return { id, name };
}

/** A pending invite: nobody has signed up for it yet. */
export async function provisionInvite(
  admin: Persona,
  org: OrgRef,
  scope: string,
  who: string,
  role: OrgRole = "org_member",
): Promise<InviteRef> {
  const ident = identity(scope, who);
  await inviteMember(admin.page, org.id, ident.email, role);
  const link = await inviteLinkFor(admin.page, org.id, ident.email);
  return { email: ident.email, link, token: tokenFromInviteLink(link) };
}

/** Invite + sign up + accept, confirmed through the invitee's own /api/me. */
export async function provisionMember(
  world: World,
  admin: Persona,
  org: OrgRef,
  scope: string,
  who: string,
  role: OrgRole = "org_member",
): Promise<Persona> {
  const invite = await provisionInvite(admin, org, scope, who, role);
  const persona = await world.signUp(scope, who);
  await acceptInviteAt(persona.page, invite.link);
  await expect
    .poll(
      async () => membershipRoles(await getMe(persona.ctx), org.id).join(","),
      { timeout: 20_000 },
    )
    .toContain(role);
  return persona;
}

/** Create a key through the pinned UI and read back its `data-key-id`. */
export async function provisionApiKey(
  admin: Persona,
  org: OrgRef,
  scope: string,
  label = "ci-key",
): Promise<ApiKeyRef> {
  const name = `${label}-${scope}-${RUN_ID}`;
  const secret = await createApiKey(admin.page, org.id, name);
  await admin.page.reload();
  const row = apiKeyRow(admin.page, name);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const id = String((await row.getAttribute("data-key-id")) ?? "");
  return { id, name, secret };
}

export type Workspace = {
  admin: Persona;
  org: OrgRef;
  member?: Persona;
  projects: ProjectRef[];
};

export type WorkspaceOptions = {
  /** Persona suffix for the admin (default "a"). */
  adminWho?: string;
  /** Org display label (default "Acme"). */
  orgLabel?: string;
  /** Invite + accept one member of this role. */
  member?: boolean;
  memberWho?: string;
  memberRole?: OrgRole;
  /** Projects created by the admin; labels default to Alpha/Beta/Gamma/Delta. */
  projects?: number;
  projectLabels?: string[];
};

const DEFAULT_PROJECT_LABELS = ["Alpha", "Beta", "Gamma", "Delta"];

/** Admin + org (+ optional member, + optional projects). */
export async function provisionWorkspace(
  world: World,
  scope: string,
  opts: WorkspaceOptions = {},
): Promise<Workspace> {
  const admin = await world.signUp(scope, opts.adminWho ?? "a");
  const org = await provisionOrg(admin, scope, opts.orgLabel ?? "Acme");
  const member = opts.member
    ? await provisionMember(
        world,
        admin,
        org,
        scope,
        opts.memberWho ?? "b",
        opts.memberRole ?? "org_member",
      )
    : undefined;
  const labels =
    opts.projectLabels ?? DEFAULT_PROJECT_LABELS.slice(0, opts.projects ?? 0);
  const projects: ProjectRef[] = [];
  for (const label of labels) {
    projects.push(await provisionProject(admin, org, scope, label));
  }
  return { admin, org, member, projects };
}

/**
 * The design's `setupOrgWithMember()`: A admin, B `org_member`, 2 projects.
 * Pass `{ projects: n }` when a scenario needs a different project count.
 */
export async function setupOrgWithMember(
  world: World,
  scope: string,
  opts: WorkspaceOptions = {},
): Promise<Workspace & { member: Persona }> {
  const ws = await provisionWorkspace(world, scope, {
    projects: 2,
    ...opts,
    member: true,
  });
  return { ...ws, member: ws.member! };
}
