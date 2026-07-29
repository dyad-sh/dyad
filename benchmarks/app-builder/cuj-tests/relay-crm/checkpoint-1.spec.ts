// Relay CRM — checkpoint 1 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 1)" + "Security probes (checkpoint 1)").
//
// Conventions (design "Test fixtures & conventions"):
// - Serial: later CUJs depend on data created by earlier ones; a failure skips
//   the rest, and skipped tests score as failures.
// - Personas own a browser context each; raw-HTTP probes go through
//   context.request so they carry exactly that persona's cookies.
// - Ids come only from pinned surfaces (GET /api/me, list endpoints' id
//   fields) — never scraped from the DOM.
// - Every identity/record is RUN_ID-suffixed so reruns and model-created data
//   never collide.
import {
  test,
  expect,
  request as pwRequest,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const RUN_ID = `${Date.now()}`;
const PASSWORD = "Passw0rd!Relay1";
const identity = (role: string) => ({
  name: `Relay ${role[0].toUpperCase()}${role.slice(1)}`,
  email: `relay-${RUN_ID}-${role}@example.com`,
  password: PASSWORD,
});
const OWNER = identity("owner");
const OUTSIDER = identity("outsider");

const ADA = `Ada ${RUN_ID}`;
const ZOE = `Zoe ${RUN_ID}`;
const TEMP = `Temp ${RUN_ID}`;
const ACME = `Acme ${RUN_ID}`;
const ACME_DOMAIN = `acme-${RUN_ID}.test`;
const ADA_EMAIL = `ada-${RUN_ID}@example.com`;
const ADA_PHONE = "555-0100";
const ADA_TITLE = `Engineer ${RUN_ID}`;
const ADA_TITLE_2 = `VP ${RUN_ID}`;

async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
}

async function expectSignedIn(page: Page, email: string) {
  // "Ends on /contacts (or redirects there within 15s)"
  await page.waitForURL("**/contacts", { timeout: 15_000 });
  await expect(page.getByTestId("user-menu")).toContainText(email, {
    timeout: 15_000,
  });
}

// Find a record id in a pinned list endpoint by matching any string value.
async function findIdByValue(
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

test.describe.serial("relay-crm checkpoint 1", () => {
  let owner: BrowserContext;
  let ownerPage: Page;
  let outsider: BrowserContext;
  let adaContactId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    ownerPage = await owner.newPage();
  });

  test.afterAll(async () => {
    await owner?.close();
    await outsider?.close();
  });

  test("crm-m1-01 sign-up creates session", async () => {
    await signUp(ownerPage, OWNER);
    await expectSignedIn(ownerPage, OWNER.email);
    const me = await owner.request.get("/api/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.email).toBe(OWNER.email);
    expect(String(body.id ?? "")).not.toHaveLength(0);
  });

  test("crm-m1-02 sign-out and sign-in", async () => {
    await ownerPage.getByTestId("sign-out-button").click();
    await ownerPage.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await ownerPage.getByTestId("signin-email").fill(OWNER.email);
    await ownerPage.getByTestId("signin-password").fill(OWNER.password);
    await ownerPage.getByTestId("signin-submit").click();
    await expectSignedIn(ownerPage, OWNER.email);
  });

  test("crm-m1-03 signed-out routes redirect to sign-in", async ({
    browser,
  }) => {
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    for (const route of ["/", "/contacts", "/contacts/new"]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      const html = await page.content();
      expect(html).not.toContain(ADA);
    }
    await fresh.close();
  });

  test("crm-m1-04 create company", async () => {
    await ownerPage.goto("/companies");
    await ownerPage.getByTestId("company-new-button").click();
    await ownerPage.getByTestId("company-form-name").fill(ACME);
    await ownerPage.getByTestId("company-form-domain").fill(ACME_DOMAIN);
    await ownerPage.getByTestId("company-form-submit").click();
    await ownerPage.goto("/companies");
    await expect(
      ownerPage
        .getByTestId("company-row-name")
        .filter({ hasText: ACME })
        .first(),
    ).toBeVisible();
  });

  test("crm-m1-05 create contact linked to company", async () => {
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(ADA);
    await ownerPage.getByTestId("contact-form-email").fill(ADA_EMAIL);
    await ownerPage.getByTestId("contact-form-phone").fill(ADA_PHONE);
    await ownerPage.getByTestId("contact-form-title").fill(ADA_TITLE);
    await ownerPage
      .getByTestId("contact-form-company")
      .selectOption({ label: ACME });
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    const row = ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("contact-row-email")).toContainText(ADA_EMAIL);
    await expect(row.getByTestId("contact-row-company")).toContainText(ACME);
    adaContactId = await findIdByValue(owner, "/api/contacts", ADA);
    expect(adaContactId, "Ada's id from pinned GET /api/contacts").toBeTruthy();
  });

  test("crm-m1-06 contact detail shows all fields", async () => {
    await ownerPage.goto("/contacts");
    await ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await expect(ownerPage.getByTestId("contact-detail-name")).toContainText(
      ADA,
    );
    await expect(ownerPage.getByTestId("contact-detail-email")).toContainText(
      ADA_EMAIL,
    );
    await expect(ownerPage.getByTestId("contact-detail-phone")).toContainText(
      ADA_PHONE,
    );
    await expect(ownerPage.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE,
    );
    await expect(ownerPage.getByTestId("contact-detail-company")).toContainText(
      ACME,
    );
  });

  test("crm-m1-07 edit contact title", async () => {
    await ownerPage.getByTestId("contact-edit-button").click();
    await ownerPage.getByTestId("contact-form-title").fill(ADA_TITLE_2);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto(`/contacts/${adaContactId}`);
    await expect(ownerPage.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE_2,
    );
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m1-08 delete contact", async () => {
    // Create the throwaway through the UI, then delete it from its detail page.
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(TEMP);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`temp-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    const tempId = await findIdByValue(owner, "/api/contacts", TEMP);
    expect(tempId, "Temp's id from pinned GET /api/contacts").toBeTruthy();
    await ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: TEMP })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await ownerPage.getByTestId("contact-delete-button").click();
    await ownerPage.getByTestId("contact-delete-confirm").click();
    await ownerPage.goto("/contacts");
    await expect(
      ownerPage.getByTestId("contact-row").filter({ hasText: TEMP }),
    ).toHaveCount(0);
    // Direct GET of the detail URL: 404/redirect (or at minimum no old data).
    const resp = await owner.request.get(`/contacts/${tempId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(TEMP);
    } else {
      expect([301, 302, 303, 307, 308, 404, 410]).toContain(resp.status());
    }
  });

  test("crm-m1-09 search filters contacts", async () => {
    // Create Zoe so there are two RUN_ID contacts, then filter for Ada.
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contact-new-button").click();
    await ownerPage.getByTestId("contact-form-name").fill(ZOE);
    await ownerPage
      .getByTestId("contact-form-email")
      .fill(`zoe-${RUN_ID}@example.com`);
    await ownerPage.getByTestId("contact-form-submit").click();
    await ownerPage.goto("/contacts");
    await ownerPage.getByTestId("contacts-search").fill(`Ada ${RUN_ID}`);
    const adaRow = ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: ADA });
    const zoeRow = ownerPage
      .getByTestId("contact-row")
      .filter({ hasText: ZOE });
    await expect(adaRow.first()).toBeVisible();
    await expect(zoeRow).toHaveCount(0);
    await ownerPage.getByTestId("contacts-search").fill("");
    await expect(adaRow.first()).toBeVisible();
    await expect(zoeRow.first()).toBeVisible();
  });

  test("crm-m1-10 second user sees empty CRM", async ({ browser }) => {
    outsider = await browser.newContext();
    const page = await outsider.newPage();
    await signUp(page, OUTSIDER);
    await expectSignedIn(page, OUTSIDER.email);
    await page.goto("/contacts");
    const rows = await page.getByTestId("contact-row").count();
    if (rows > 0) {
      // Rows may exist only if the model pre-seeded demo data; the owner's
      // records must never appear.
      expect(rows).toBe(0);
    } else {
      await expect(
        page
          .getByTestId("contacts-empty")
          .or(page.getByTestId("contacts-list")),
      ).toBeVisible();
    }
    expect(await page.content()).not.toContain(ADA);
    const me = await outsider.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(OUTSIDER.email);
  });

  test("crm-m1-s01 unauthenticated API access denied", async () => {
    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    for (const p of [
      "/api/me",
      "/api/contacts",
      `/api/contacts/${adaContactId}`,
    ]) {
      const resp = await anon.get(p, { maxRedirects: 0 });
      expect(
        [401, 403, 301, 302, 303, 307, 308],
        `${p} must deny anonymous access (got ${resp.status()})`,
      ).toContain(resp.status());
      const text = await resp.text();
      expect(text).not.toContain(ADA);
      expect(text).not.toContain(OWNER.email);
    }
    await anon.dispose();
  });

  test("crm-m1-s02 cross-user API access denied", async () => {
    expect(adaContactId, "needs Ada's id from crm-m1-05").toBeTruthy();
    const read = await outsider.request.get(`/api/contacts/${adaContactId}`, {
      maxRedirects: 0,
    });
    expect([401, 403, 404]).toContain(read.status());
    expect(await read.text()).not.toContain(ADA);
    const write = await outsider.request.patch(
      `/api/contacts/${adaContactId}`,
      { data: { name: "pwned" }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(write.status());
    // Owner re-read: name unchanged.
    const recheck = await owner.request.get("/api/contacts");
    expect(await recheck.text()).toContain(ADA);
    expect(await recheck.text()).not.toContain("pwned");
  });
});
