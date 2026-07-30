// Portalis — checkpoint 1 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 1)" + "Security probes (checkpoint 1)").
// 10 CUJs (all new) + 2 probes. Serial: later CUJs use earlier orgs.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  RUN_ID,
  UUID_RE,
  anonContext,
  createOrg,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  identity,
  memberRow,
  numericText,
  signIn,
  signUpAndLand,
} from "./fixtures";

const A = identity("m1", "a");
const B = identity("m1", "b");

const ORG1 = `Acme ${RUN_ID}`;
const ORG1_SLUG = `acme-${RUN_ID}`;
const ORG2 = `Beta ${RUN_ID}`;
const ORG2_SLUG = `beta-${RUN_ID}`;
const ORG3 = `Gamma ${RUN_ID}`;
const ORG1_RENAMED = `Acme Renamed ${RUN_ID}`;
const ORG1_DESCRIPTION = `Description ${RUN_ID}`;

test.describe.serial("portalis checkpoint 1", () => {
  let a: BrowserContext;
  let aPage: Page;
  let b: BrowserContext;
  let aId = "";
  let org1 = "";
  let org2 = "";

  test.beforeAll(async ({ browser }) => {
    a = await browser.newContext();
    aPage = await a.newPage();
  });

  test.afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  test("P1-01 sign-up lands signed in with an empty org list", async () => {
    await signUpAndLand(aPage, A);
    await expect(aPage.getByTestId("user-email")).toContainText(A.email);
    await aPage.goto("/orgs");
    await expect(aPage.getByTestId("orgs-empty-state")).toBeVisible({
      timeout: 15_000,
    });

    // `/` is redirect-only for a signed-in visitor.
    await aPage.goto("/");
    await aPage.waitForURL("**/orgs", { timeout: 15_000 });

    const me = await getMe(a);
    expect(me.email).toBe(A.email);
    aId = String(me.id ?? "");
    expect(aId, "A's id from GET /api/me").not.toHaveLength(0);
  });

  test("P1-02 sign-out and sign-in round-trips the session", async () => {
    await aPage.goto("/orgs");
    await aPage.getByTestId("sign-out-button").click();
    await aPage.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await signIn(aPage, A);
    await aPage.waitForURL("**/orgs**", { timeout: 15_000 });
    await expect(aPage.getByTestId("user-email")).toContainText(A.email, {
      timeout: 15_000,
    });
  });

  test("P1-03 create org from the empty state", async () => {
    org1 = await createOrg(aPage, ORG1, ORG1_SLUG);
    expect(org1, "org id must be a UUID").toMatch(UUID_RE);
    expect(
      /^\d+$/.test(org1),
      "org id must not be a sequential integer",
    ).toBeFalsy();
    await expect(aPage.getByTestId("org-header-name")).toContainText(ORG1);
  });

  test("P1-04 second org appears alongside the first", async () => {
    org2 = await createOrg(aPage, ORG2, ORG2_SLUG);
    expect(org2).toMatch(UUID_RE);
    expect(org2).not.toBe(org1);

    await aPage.goto("/orgs");
    const cards = aPage.getByTestId("org-card");
    await expect(cards).toHaveCount(2, { timeout: 15_000 });
    const ids = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-org-id") ?? ""),
    );
    expect(new Set(ids.filter(Boolean)).size, "distinct data-org-id").toBe(2);
    const html = await aPage.content();
    expect(html).toContain(ORG1);
    expect(html).toContain(ORG2);
  });

  test("P1-05 org settings persist and propagate to the org list", async () => {
    await aPage.goto(`/orgs/${org1}/settings`);
    await aPage.getByTestId("settings-name-input").fill(ORG1_RENAMED);
    await aPage
      .getByTestId("settings-description-input")
      .fill(ORG1_DESCRIPTION);
    await aPage.getByTestId("settings-save").click();
    await expect(aPage.getByTestId("settings-saved")).toBeVisible({
      timeout: 15_000,
    });

    await aPage.reload();
    await expect(aPage.getByTestId("settings-name-input")).toHaveValue(
      ORG1_RENAMED,
      { timeout: 15_000 },
    );
    await expect(aPage.getByTestId("settings-description-input")).toHaveValue(
      ORG1_DESCRIPTION,
    );

    await aPage.goto("/orgs");
    await expect(
      aPage.getByTestId("org-card-name").filter({ hasText: ORG1_RENAMED }),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test("P1-06 member list shows the creator as org_admin", async () => {
    await aPage.goto(`/orgs/${org1}/members`);
    await expect(aPage.getByTestId("members-table")).toBeVisible({
      timeout: 15_000,
    });
    expect(await numericText(aPage.getByTestId("member-count").first())).toBe(
      1,
    );

    const row = memberRow(aPage, A.email);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("member-email")).toContainText(A.email);
    await expect(row.getByTestId("member-role")).toContainText("org_admin");
    expect(
      await row.getAttribute("data-user-id"),
      "member row's data-user-id must equal GET /api/me id",
    ).toBe(aId);
  });

  test("P1-07 signed-out visitors are redirected and see no org data", async ({
    browser,
  }) => {
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    for (const route of ["/", "/orgs", `/orgs/${org1}/members`]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      expectNoLeak(await page.content(), [ORG1_RENAMED, A.email], route);
    }
    await fresh.close();
  });

  test("P1-08 duplicate slug is rejected", async () => {
    await aPage.goto("/orgs/new");
    await aPage.getByTestId("org-name-input").fill(ORG3);
    await aPage.getByTestId("org-slug-input").fill(ORG1_SLUG);
    await aPage.getByTestId("create-org-submit").click();
    await expect(aPage.getByTestId("create-org-error")).toBeVisible({
      timeout: 15_000,
    });

    await aPage.goto("/orgs");
    await expect(aPage.getByTestId("org-card")).toHaveCount(2, {
      timeout: 15_000,
    });
  });

  test("P1-09 a non-member cannot reach another user's org", async ({
    browser,
  }) => {
    b = await browser.newContext();
    const page = await b.newPage();
    await signUpAndLand(page, B);
    for (const route of [`/orgs/${org1}`, `/orgs/${org1}/members`]) {
      await expectDeniedPage(page, route, [ORG1_RENAMED, A.email]);
    }
  });

  test("P1-10 wrong password does not create a session", async ({
    browser,
  }) => {
    // Fresh context: A's own session stays intact for the probes below.
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    await signIn(page, { email: A.email, password: "WrongPassword!1" });
    await expect(page.getByTestId("signin-error")).toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).toContain("/auth/sign-in");

    await page.goto("/orgs");
    await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await fresh.close();
  });

  test("S1-01 cross-user raw requests leak no org data", async () => {
    for (const route of [`/orgs/${org1}`, `/orgs/${org1}/members`]) {
      const resp = await b.request.get(route, { maxRedirects: 0 });
      const status = resp.status();
      const body = await resp.text();
      // 404/403/redirect, or a rendered not-authorized page — P1-09 accepts
      // the same set for these routes. The invariant asserted unconditionally
      // is that nothing about A's org comes back.
      expect(
        [301, 302, 303, 307, 308, 401, 403, 404].includes(status) ||
          body.includes("not-authorized"),
        `${route} with B's cookie must deny (got ${status})`,
      ).toBeTruthy();
      expectNoLeak(body, [ORG1_RENAMED, A.email], `${route} (B's cookie)`);
    }
  });

  test("S1-02 unauthenticated requests are rejected", async () => {
    const anon = await anonContext();
    for (const route of [`/orgs/${org1}`, `/orgs/${org1}/members`]) {
      const resp = await anon.get(route, { maxRedirects: 0 });
      expect(
        [301, 302, 303, 307, 308, 401, 403, 404],
        `${route} anonymous (got ${resp.status()})`,
      ).toContain(resp.status());
      expectNoLeak(
        await resp.text(),
        [ORG1_RENAMED, A.email],
        `${route} (anonymous)`,
      );
    }

    // /api/me pins 401 for a missing session (M1 prompt + S1-02).
    const me = await anon.get("/api/me", { maxRedirects: 0 });
    expect([401, 403], `GET /api/me anonymous (got ${me.status()})`).toContain(
      me.status(),
    );
    expectNoLeak(await me.text(), [A.email, aId], "/api/me (anonymous)");
    await anon.dispose();
  });
});
