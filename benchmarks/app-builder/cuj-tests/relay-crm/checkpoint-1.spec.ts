// Relay CRM — checkpoint 1 CUJ suite (design/app-1-relay-crm.md, "CUJ suite
// (checkpoint 1)" + "Security probes (checkpoint 1)").
//
// Conventions (design "Test fixtures & conventions"):
// - Independent: every test provisions the personas and records its own
//   scenario needs through the `world` fixture, so one failure can never skip
//   (and silently void) another test. No `.serial`, no shared mutable state.
// - Personas own a browser context each; raw-HTTP probes go through
//   context.request so they carry exactly that persona's cookies.
// - Ids come only from pinned surfaces (GET /api/me, list endpoints' id
//   fields) — never scraped from the DOM.
// - Every identity/record is RUN_ID- and test-suffixed so reruns, sibling
//   tests and model-created data never collide.
import { request as pwRequest } from "@playwright/test";
import {
  test,
  expect,
  RUN_ID,
  signUp,
  expectSignedIn,
  findIdByValue,
  createCompany,
  createContact,
  createContactWithId,
  settleAfterSubmit,
} from "./fixtures";

const ADA = `Ada ${RUN_ID}`;
const ZOE = `Zoe ${RUN_ID}`;
const TEMP = `Temp ${RUN_ID}`;
const ACME = `Acme ${RUN_ID}`;
const ADA_PHONE = "555-0100";
const ADA_TITLE = `Engineer ${RUN_ID}`;
const ADA_TITLE_2 = `VP ${RUN_ID}`;

test.describe("relay-crm checkpoint 1", () => {
  test("crm-m1-01 sign-up creates session", async ({ world }) => {
    const who = world.identity("owner");
    const context = await world.newContext();
    const page = await context.newPage();
    await signUp(page, who);
    await expectSignedIn(page, who.email);
    // The header contract is scored HERE (the CUJ that pins it), not in the
    // shared provisioning helper.
    await expect(page.getByTestId("user-menu")).toContainText(who.email, {
      timeout: 15_000,
    });
    const me = await context.request.get("/api/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.email).toBe(who.email);
    expect(String(body.id ?? "")).not.toHaveLength(0);
  });

  test("crm-m1-02 sign-out and sign-in", async ({ world }) => {
    const owner = await world.signUp("owner");
    await owner.page.getByTestId("sign-out-button").click();
    // signOut() is a background fetch; navigating before it settles cancels
    // it and the cached session cookie keeps the server answering signed-in.
    await owner.page.waitForLoadState("networkidle").catch(() => {});
    await owner.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await owner.page.getByTestId("signin-email").fill(owner.email);
    await owner.page.getByTestId("signin-password").fill(owner.password);
    await owner.page.getByTestId("signin-submit").click();
    await expectSignedIn(owner.page, owner.email);
  });

  test("crm-m1-03 signed-out routes redirect to sign-in", async ({ world }) => {
    const fresh = await world.newContext();
    const page = await fresh.newPage();
    for (const route of ["/", "/contacts", "/contacts/new"]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      const html = await page.content();
      expect(html).not.toContain(ADA);
    }
  });

  test("crm-m1-04 create company", async ({ world }) => {
    const owner = await world.signUp("owner");
    await owner.page.goto("/companies");
    await owner.page.getByTestId("company-new-button").click();
    await owner.page.getByTestId("company-form-name").fill(ACME);
    await owner.page
      .getByTestId("company-form-domain")
      .fill(`${world.token("acme")}.test`);
    await owner.page.getByTestId("company-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/companies");
    await expect(
      owner.page
        .getByTestId("company-row-name")
        .filter({ hasText: ACME })
        .first(),
    ).toBeVisible();
  });

  test("crm-m1-05 create contact linked to company", async ({ world }) => {
    const owner = await world.signUp("owner");
    await createCompany(owner.page, {
      name: ACME,
      domain: `${world.token("acme")}.test`,
    });
    const adaEmail = world.email("ada");

    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(ADA);
    await owner.page.getByTestId("contact-form-email").fill(adaEmail);
    await owner.page.getByTestId("contact-form-phone").fill(ADA_PHONE);
    await owner.page.getByTestId("contact-form-title").fill(ADA_TITLE);
    await owner.page
      .getByTestId("contact-form-company")
      .selectOption({ label: ACME });
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    const row = owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("contact-row-email")).toContainText(adaEmail);
    await expect(row.getByTestId("contact-row-company")).toContainText(ACME);
    const adaContactId = await findIdByValue(
      owner.context,
      "/api/contacts",
      ADA,
    );
    expect(adaContactId, "Ada's id from pinned GET /api/contacts").toBeTruthy();
  });

  test("crm-m1-06 contact detail shows all fields", async ({ world }) => {
    const owner = await world.signUp("owner");
    const adaEmail = world.email("ada");
    await createCompany(owner.page, {
      name: ACME,
      domain: `${world.token("acme")}.test`,
    });
    await createContact(owner.page, {
      name: ADA,
      email: adaEmail,
      phone: ADA_PHONE,
      title: ADA_TITLE,
      company: ACME,
    });

    await owner.page.goto("/contacts");
    await owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await expect(owner.page.getByTestId("contact-detail-name")).toContainText(
      ADA,
    );
    await expect(owner.page.getByTestId("contact-detail-email")).toContainText(
      adaEmail,
    );
    await expect(owner.page.getByTestId("contact-detail-phone")).toContainText(
      ADA_PHONE,
    );
    await expect(owner.page.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE,
    );
    await expect(
      owner.page.getByTestId("contact-detail-company"),
    ).toContainText(ACME);
  });

  test("crm-m1-07 edit contact title", async ({ world }) => {
    const owner = await world.signUp("owner");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada"),
      phone: ADA_PHONE,
      title: ADA_TITLE,
    });

    await owner.page.goto("/contacts");
    await owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await owner.page.getByTestId("contact-edit-button").click();
    await owner.page.getByTestId("contact-form-title").fill(ADA_TITLE_2);
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto(`/contacts/${adaContactId}`);
    await expect(owner.page.getByTestId("contact-detail-title")).toContainText(
      ADA_TITLE_2,
    );
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
    ).toBeVisible();
  });

  test("crm-m1-08 delete contact", async ({ world }) => {
    const owner = await world.signUp("owner");
    // Create the throwaway through the UI, then delete it from its detail page.
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(TEMP);
    await owner.page
      .getByTestId("contact-form-email")
      .fill(world.email("temp"));
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    const tempId = await findIdByValue(owner.context, "/api/contacts", TEMP);
    expect(tempId, "Temp's id from pinned GET /api/contacts").toBeTruthy();
    await owner.page
      .getByTestId("contact-row")
      .filter({ hasText: TEMP })
      .first()
      .getByTestId("contact-row-link")
      .click();
    await owner.page.getByTestId("contact-delete-button").click();
    await owner.page.getByTestId("contact-delete-confirm").click();
    await owner.page.goto("/contacts");
    await expect(
      owner.page.getByTestId("contact-row").filter({ hasText: TEMP }),
    ).toHaveCount(0);
    // Direct GET of the detail URL: 404/redirect (or at minimum no old data).
    const resp = await owner.context.request.get(`/contacts/${tempId}`, {
      maxRedirects: 0,
    });
    if (resp.status() === 200) {
      expect(await resp.text()).not.toContain(TEMP);
    } else {
      expect([301, 302, 303, 307, 308, 404, 410]).toContain(resp.status());
    }
  });

  test("crm-m1-09 search filters contacts", async ({ world }) => {
    const owner = await world.signUp("owner");
    await createContact(owner.page, { name: ADA, email: world.email("ada") });

    // Create Zoe so there are two RUN_ID contacts, then filter for Ada.
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contact-new-button").click();
    await owner.page.getByTestId("contact-form-name").fill(ZOE);
    await owner.page.getByTestId("contact-form-email").fill(world.email("zoe"));
    await owner.page.getByTestId("contact-form-submit").click();
    await settleAfterSubmit(owner.page);
    await owner.page.goto("/contacts");
    await owner.page.getByTestId("contacts-search").fill(ADA);
    const adaRow = owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ADA });
    const zoeRow = owner.page
      .getByTestId("contact-row")
      .filter({ hasText: ZOE });
    await expect(adaRow.first()).toBeVisible();
    await expect(zoeRow).toHaveCount(0);
    await owner.page.getByTestId("contacts-search").fill("");
    await expect(adaRow.first()).toBeVisible();
    await expect(zoeRow.first()).toBeVisible();
  });

  test("crm-m1-10 second user sees empty CRM", async ({ world }) => {
    const owner = await world.signUp("owner");
    await createContact(owner.page, { name: ADA, email: world.email("ada") });

    const outsider = await world.signUp("outsider");
    await outsider.page.goto("/contacts");
    const rows = await outsider.page.getByTestId("contact-row").count();
    if (rows > 0) {
      // Rows may exist only if the model pre-seeded demo data; the owner's
      // records must never appear.
      expect(rows).toBe(0);
    } else {
      await expect(
        outsider.page
          .getByTestId("contacts-empty")
          .or(outsider.page.getByTestId("contacts-list")),
      ).toBeVisible();
    }
    expect(await outsider.page.content()).not.toContain(ADA);
    const me = await outsider.context.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(outsider.email);
  });

  test("crm-m1-s01 unauthenticated API access denied", async ({ world }) => {
    const owner = await world.signUp("owner");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada"),
    });

    const anon = await pwRequest.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    try {
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
        expect(text).not.toContain(owner.email);
      }
    } finally {
      await anon.dispose();
    }
  });

  test("crm-m1-s02 cross-user API access denied", async ({ world }) => {
    const owner = await world.signUp("owner");
    const adaContactId = await createContactWithId(owner.context, owner.page, {
      name: ADA,
      email: world.email("ada"),
    });
    const outsider = await world.signUp("outsider");

    const read = await outsider.context.request.get(
      `/api/contacts/${adaContactId}`,
      { maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(read.status());
    expect(await read.text()).not.toContain(ADA);
    const write = await outsider.context.request.patch(
      `/api/contacts/${adaContactId}`,
      { data: { name: "pwned" }, maxRedirects: 0 },
    );
    expect([401, 403, 404]).toContain(write.status());
    // Owner re-read: name unchanged.
    const recheck = await owner.context.request.get("/api/contacts");
    expect(await recheck.text()).toContain(ADA);
    expect(await recheck.text()).not.toContain("pwned");
  });
});
