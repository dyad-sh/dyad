// Shared Relay CRM suite helpers (design/app-1-relay-crm.md, "Test fixtures &
// conventions"). Used by all three checkpoint suites.
//
// Independence contract: every test provisions the world it needs through the
// `world` fixture below and asserts only its own scenario, so no test can be
// skipped (or silently voided) by an earlier failure. Nothing mutable lives at
// module scope; the only module state is the immutable `RUN_ID`.
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { videoOpts } from "../video-context";

// Unique per process: timestamp + random token, so repeated runs against the
// same database (and sibling suites) never collide on an identity or a record
// name. Per-test uniqueness comes from `World.scope` on top of this.
export const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
export const PASSWORD = "Passw0rd!Relay1";

export type Identity = { name: string; email: string; password: string };

export const identity = (role: string, scope: string): Identity => ({
  name: `Relay ${role[0].toUpperCase()}${role.slice(1)}`,
  email: `relay-${RUN_ID}-${role}-${scope}@example.com`,
  password: PASSWORD,
});

export async function signUp(page: Page, who: Identity) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
}

export async function expectSignedIn(page: Page, email: string) {
  // Provisioning proves the session FUNCTIONALLY (pinned GET /api/me), not via
  // the header. The header's user-menu/email contract is asserted by the CUJs
  // that own it; using it as a universal precondition let one cosmetic defect
  // zero an entire app (claude-sonnet-5 renders an empty user-menu while its
  // server session works).
  await page.waitForURL("**/contacts", { timeout: 5_000 }).catch(async () => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.goto("/contacts");
  });
  await expect
    .poll(async () => (await page.request.get("/api/me")).status(), {
      timeout: 15_000,
    })
    .toBe(200);
  void email;
}

// Find a record id in a pinned list endpoint by matching any string value.
export async function findIdByValue(
  context: BrowserContext,
  listPath: string,
  needle: string,
): Promise<string | null> {
  const resp = await context.request.get(listPath);
  if (!resp.ok()) return null;
  const items = (await resp.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(items)) return null;
  const hit = items.find((it) =>
    Object.values(it).some((v) => typeof v === "string" && v.includes(needle)),
  );
  return hit && hit.id != null ? String(hit.id) : null;
}

// Pinned GET /api/me — the id-provenance anchor for a persona's own ids.
export async function getMe(context: BrowserContext): Promise<any> {
  const resp = await context.request.get("/api/me");
  expect(resp.status(), "GET /api/me for a signed-in persona").toBe(200);
  return resp.json();
}

// M2+: switch the active workspace via the pinned header switcher.
export async function switchWorkspace(page: Page, name: string) {
  await page.getByTestId("workspace-switcher").first().click();
  await page
    .getByTestId("workspace-switcher-option")
    .filter({ hasText: name })
    .first()
    .click();
  await expect(page.getByTestId("workspace-current-name")).toContainText(name, {
    timeout: 15_000,
  });
}

// M2+: accept the pending invite for a given workspace name from /invites.
export async function acceptInvite(page: Page, workspaceName: string) {
  await page.goto("/invites");
  const row = page
    .getByTestId("invite-row")
    .filter({ hasText: workspaceName })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const scoped = row.getByTestId("invite-accept-button");
  if (await scoped.count()) {
    await scoped.first().click();
  } else {
    await page.getByTestId("invite-accept-button").first().click();
  }
}

// Formatting-insensitive numeric read of an element's text (e.g. "$7,500.00").
export async function numericText(locator: {
  textContent(): Promise<string | null>;
}): Promise<number> {
  const text = (await locator.textContent()) ?? "";
  const match = text.replace(/[,\s]/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

// ---------------------------------------------------------------------------
// Provisioning helpers — all drive the pinned UI surfaces, exactly as the CUJs
// that own those scenarios do, so provisioning never depends on an unpinned
// route and a provisioning failure points at a real broken flow.
// ---------------------------------------------------------------------------

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

export async function createCompany(
  page: Page,
  company: { name: string; domain?: string },
) {
  await page.goto("/companies");
  await page.getByTestId("company-new-button").click();
  await page.getByTestId("company-form-name").fill(company.name);
  if (company.domain !== undefined) {
    await page.getByTestId("company-form-domain").fill(company.domain);
  }
  await page.getByTestId("company-form-submit").click();
  await settleAfterSubmit(page);
  await page.goto("/companies");
  await expect(
    page
      .getByTestId("company-row-name")
      .filter({ hasText: company.name })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

export type ContactFields = {
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
};

export async function createContact(page: Page, fields: ContactFields) {
  await page.goto("/contacts");
  await page.getByTestId("contact-new-button").click();
  await page.getByTestId("contact-form-name").fill(fields.name);
  if (fields.email !== undefined) {
    await page.getByTestId("contact-form-email").fill(fields.email);
  }
  if (fields.phone !== undefined) {
    await page.getByTestId("contact-form-phone").fill(fields.phone);
  }
  if (fields.title !== undefined) {
    await page.getByTestId("contact-form-title").fill(fields.title);
  }
  if (fields.company !== undefined) {
    await page
      .getByTestId("contact-form-company")
      .selectOption({ label: fields.company });
  }
  await page.getByTestId("contact-form-submit").click();
  await settleAfterSubmit(page);
  await page.goto("/contacts");
  await expect(
    page.getByTestId("contact-row").filter({ hasText: fields.name }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

// Create a contact and return its id from the pinned GET /api/contacts.
export async function createContactWithId(
  context: BrowserContext,
  page: Page,
  fields: ContactFields,
): Promise<string> {
  await createContact(page, fields);
  const id = await findIdByValue(context, "/api/contacts", fields.name);
  expect(id, `${fields.name} id from pinned GET /api/contacts`).toBeTruthy();
  return String(id);
}

export type DealFields = {
  title: string;
  amount: number | string;
  stage: string;
  contact?: string;
};

export async function createDeal(page: Page, deal: DealFields) {
  await page.goto("/deals");
  await page.getByTestId("deal-new-button").click();
  await page.getByTestId("deal-form-title").fill(deal.title);
  await page.getByTestId("deal-form-amount").fill(String(deal.amount));
  await page.getByTestId("deal-form-stage").selectOption(deal.stage);
  if (deal.contact !== undefined) {
    await page
      .getByTestId("deal-form-contact")
      .selectOption({ label: deal.contact });
  }
  await page.getByTestId("deal-form-submit").click();
  await settleAfterSubmit(page);
  await page.goto("/deals");
  await expect(
    page
      .getByTestId(`kanban-column-${deal.stage}`)
      .getByTestId("deal-card")
      .filter({ hasText: deal.title })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

// Create a deal and return its id from the pinned GET /api/deals.
export async function createDealWithId(
  context: BrowserContext,
  page: Page,
  deal: DealFields,
): Promise<string> {
  await createDeal(page, deal);
  const id = await findIdByValue(context, "/api/deals", deal.title);
  expect(id, `${deal.title} id from pinned GET /api/deals`).toBeTruthy();
  return String(id);
}

// M2+: create an additional workspace from /workspaces.
export async function createWorkspace(page: Page, name: string) {
  await page.goto("/workspaces");
  await page.getByTestId("workspace-create-button").click();
  await page.getByTestId("workspace-form-name").fill(name);
  await page.getByTestId("workspace-form-submit").click();
  await settleAfterSubmit(page);
}

// M2+: invite an email from /settings/members. `role` is only selected when the
// M3 `invite-role-select` exists, so the same helper serves both milestones.
export async function inviteMember(
  ownerPage: Page,
  email: string,
  role?: "member" | "viewer",
) {
  await ownerPage.goto("/settings/members");
  await ownerPage.getByTestId("invite-email-input").fill(email);
  if (role) {
    const roleSelect = ownerPage.getByTestId("invite-role-select");
    if (await roleSelect.count()) {
      await roleSelect.first().selectOption(role);
    }
  }
  await ownerPage.getByTestId("invite-submit").click();
  await expect(
    ownerPage
      .getByTestId("pending-invite-row")
      .filter({ hasText: email })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

// M3: add a manual note to a contact's timeline and return its rendered type,
// which the timeline CUJs compare system entries against.
export async function addNote(
  page: Page,
  contactId: string,
  body: string,
): Promise<string> {
  await page.goto(`/contacts/${contactId}`);
  await page.getByTestId("activity-note-input").fill(body);
  await page.getByTestId("activity-note-submit").click();
  const newest = page.getByTestId("activity-item").first();
  await expect(newest.getByTestId("activity-item-body")).toContainText(body, {
    timeout: 15_000,
  });
  return (
    (await newest.getByTestId("activity-item-type").textContent()) ?? ""
  ).trim();
}

// ---------------------------------------------------------------------------
// The `world` fixture: per-test personas and disposable browser contexts.
// ---------------------------------------------------------------------------

export type Persona = Identity & {
  role: string;
  context: BrowserContext;
  page: Page;
  /** Filled by `signUpOwner`/`joinWorkspace` from the persona's own /api/me. */
  id: string;
  workspaceId: string;
  workspaceName: string;
};

// M2+: resolve the persona's own workspace from the pinned GET /api/me. A
// freshly signed-up user has exactly one membership (the auto-created
// workspace); when an app reports an active workspace id we honour it.
export async function resolveWorkspace(persona: Persona): Promise<Persona> {
  const me = await getMe(persona.context);
  const memberships = (me.memberships ?? []) as Array<Record<string, unknown>>;
  expect(
    memberships.length,
    `${persona.role} has an auto-created workspace in /api/me memberships`,
  ).toBeGreaterThan(0);
  const activeId = String(
    me.activeWorkspaceId ?? me.activeWorkspace ?? me.workspaceId ?? "",
  );
  const active =
    memberships.find((m) => String(m.workspaceId) === activeId) ??
    memberships[0];
  persona.id = String(me.id ?? "");
  persona.workspaceId = String(active.workspaceId ?? "");
  // The name comes from the switcher UI, which is the surface these CUJs
  // actually score; /api/me's workspaceName is only a fallback. Hard-asserting
  // the API field here would fail provisioning for apps that render the name
  // but omit it from /api/me — a stricter bar than the recorded runs used.
  const switcherName = await persona.page
    .getByTestId("workspace-current-name")
    .first()
    .textContent()
    .catch(() => null);
  persona.workspaceName = (switcherName ?? "").trim()
    ? (switcherName ?? "").trim()
    : String(active.workspaceName ?? "");
  return persona;
}

export class World {
  private readonly contexts: BrowserContext[] = [];

  constructor(
    private readonly browser: Browser,
    /** Unique per test (file + test id), e.g. `c1-crm-m1-05`. */
    readonly scope: string,
  ) {}

  /** A token unique to this test run and this test, e.g. `acme-<RUN_ID>-c1-…`. */
  token(prefix: string): string {
    return `${prefix}-${RUN_ID}-${this.scope}`;
  }

  /** An address unique to this test, for records (not personas). */
  email(local: string): string {
    return `${this.token(local)}@example.com`;
  }

  identity(role: string): Identity {
    return identity(role, this.scope);
  }

  /** A tracked browser context; always recorded when CUJ_VIDEO_DIR is set. */
  async newContext(): Promise<BrowserContext> {
    const context = await this.browser.newContext(videoOpts());
    this.contexts.push(context);
    return context;
  }

  /** A brand-new signed-up user in their own context (M1-safe: no /api/me). */
  async signUp(role: string): Promise<Persona> {
    const who = this.identity(role);
    const context = await this.newContext();
    const page = await context.newPage();
    await signUp(page, who);
    await expectSignedIn(page, who.email);
    return {
      ...who,
      role,
      context,
      page,
      id: "",
      workspaceId: "",
      workspaceName: "",
    };
  }

  /** M2+: a brand-new user plus their auto-created workspace's id and name. */
  async signUpOwner(role = "owner"): Promise<Persona> {
    return resolveWorkspace(await this.signUp(role));
  }

  /**
   * M2+: invite `as` into `owner`'s workspace with `role`, sign the invitee up
   * in a fresh context, accept the invite and leave that workspace active.
   */
  async joinWorkspace(
    owner: Persona,
    opts: { as: string; role?: "member" | "viewer" },
  ): Promise<Persona> {
    const who = this.identity(opts.as);
    await inviteMember(owner.page, who.email, opts.role);
    const persona = await this.signUp(opts.as);
    await acceptInvite(persona.page, owner.workspaceName);
    // Wait on the switcher option — the surface the joining CUJs score — not on
    // /api/me. Several of these tests are pure-UI and never required the API to
    // list the joined workspace by name.
    await expect(
      persona.page
        .getByTestId("workspace-switcher-option")
        .filter({ hasText: owner.workspaceName })
        .first(),
    ).toBeAttached({ timeout: 20_000 });
    await switchWorkspace(persona.page, owner.workspaceName);
    const me = await getMe(persona.context);
    persona.id = String(me.id ?? "");
    persona.workspaceId = owner.workspaceId;
    persona.workspaceName = owner.workspaceName;
    return persona;
  }

  async dispose() {
    for (const context of this.contexts) {
      await context.close().catch(() => {});
    }
  }
}

function scopeFor(testInfo: TestInfo): string {
  const file = (testInfo.file.split(/[\\/]/).pop() ?? "spec")
    .replace(/\.spec\.ts$/, "")
    .replace(/^checkpoint-/, "c");
  const id = (testInfo.title.split(/\s+/)[0] ?? "test")
    .replace(/^crm-/, "")
    .replace(/[^a-zA-Z0-9-]/g, "");
  return `${file}-${id}`;
}

// Contexts created through `world` are closed in fixture teardown, so videos
// flush and Postgres connections are released even when a test fails.
export const test = base.extend<{ world: World }>({
  world: async ({ browser }, use, testInfo) => {
    const world = new World(browser, scopeFor(testInfo));
    await use(world);
    await world.dispose();
  },
});

export { expect };
