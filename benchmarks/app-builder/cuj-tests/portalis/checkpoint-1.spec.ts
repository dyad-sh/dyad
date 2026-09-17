// Portalis — checkpoint 1 CUJ suite (design/app-3-portalis.md, "CUJ suite
// (checkpoint 1)" + "Security probes (checkpoint 1)").
// 10 CUJs (all new) + 2 probes.
//
// Every test is independent: it provisions its own personas/orgs through the
// `world` fixture and can be run alone with
//   npx playwright test portalis/checkpoint-1.spec.ts -g "P1-08"
// Nothing mutable lives at module scope, so one failure can never skip another
// test.
import {
  RUN_ID,
  UUID_RE,
  expect,
  expectDeniedPage,
  expectNoLeak,
  getMe,
  memberRow,
  numericText,
  provisionOrg,
  scopedName,
  signIn,
  test,
} from "./fixtures";

test.describe("portalis checkpoint 1", () => {
  test("P1-01 sign-up lands signed in with an empty org list", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-01", "a");

    await expect(a.page.getByTestId("user-email")).toContainText(a.email);
    await a.page.goto("/orgs");
    await expect(a.page.getByTestId("orgs-empty-state")).toBeVisible({
      timeout: 15_000,
    });

    // `/` is redirect-only for a signed-in visitor.
    await a.page.goto("/");
    await a.page.waitForURL("**/orgs", { timeout: 15_000 });

    const me = await getMe(a.ctx);
    expect(me.email).toBe(a.email);
    expect(String(me.id ?? ""), "A's id from GET /api/me").not.toHaveLength(0);
  });

  test("P1-02 sign-out and sign-in round-trips the session", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-02", "a");

    await a.page.goto("/orgs");
    await a.page.getByTestId("sign-out-button").click();
    // signOut() is a background fetch; navigating before it settles cancels
    // it and the cached session cookie keeps the server answering signed-in.
    await a.page.waitForLoadState("networkidle").catch(() => {});
    await a.page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
    await signIn(a.page, a);
    await a.page.waitForURL("**/orgs**", { timeout: 15_000 });
    await expect(a.page.getByTestId("user-email")).toContainText(a.email, {
      timeout: 15_000,
    });
  });

  test("P1-03 create org from the empty state", async ({ world }) => {
    // A brand-new user has no orgs, so createOrg goes through the pinned
    // `create-org-link` on the empty state.
    const a = await world.signUp("m1-p1-03", "a");

    const org = await provisionOrg(a, "m1-p1-03", "Acme");
    expect(org.id, "org id must be a UUID").toMatch(UUID_RE);
    expect(
      /^\d+$/.test(org.id),
      "org id must not be a sequential integer",
    ).toBeFalsy();
    await expect(a.page.getByTestId("org-header-name")).toContainText(org.name);
  });

  test("P1-04 second org appears alongside the first", async ({ world }) => {
    const a = await world.signUp("m1-p1-04", "a");
    const org1 = await provisionOrg(a, "m1-p1-04", "Acme");

    const org2 = await provisionOrg(a, "m1-p1-04", "Beta");
    expect(org2.id).toMatch(UUID_RE);
    expect(org2.id).not.toBe(org1.id);

    await a.page.goto("/orgs");
    const cards = a.page.getByTestId("org-card");
    await expect(cards).toHaveCount(2, { timeout: 15_000 });
    const ids = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-org-id") ?? ""),
    );
    expect(new Set(ids.filter(Boolean)).size, "distinct data-org-id").toBe(2);
    const html = await a.page.content();
    expect(html).toContain(org1.name);
    expect(html).toContain(org2.name);
  });

  test("P1-05 org settings persist and propagate to the org list", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-05", "a");
    const org = await provisionOrg(a, "m1-p1-05", "Acme");
    const renamed = scopedName("m1-p1-05", "Acme Renamed");
    const description = `Description m1-p1-05 ${RUN_ID}`;

    await a.page.goto(`/orgs/${org.id}/settings`);
    await a.page.getByTestId("settings-name-input").fill(renamed);
    await a.page.getByTestId("settings-description-input").fill(description);
    await a.page.getByTestId("settings-save").click();
    await expect(a.page.getByTestId("settings-saved")).toBeVisible({
      timeout: 15_000,
    });

    await a.page.reload();
    await expect(a.page.getByTestId("settings-name-input")).toHaveValue(
      renamed,
      { timeout: 15_000 },
    );
    await expect(a.page.getByTestId("settings-description-input")).toHaveValue(
      description,
    );

    await a.page.goto("/orgs");
    await expect(
      a.page.getByTestId("org-card-name").filter({ hasText: renamed }),
    ).toHaveCount(1, { timeout: 15_000 });
  });

  test("P1-06 member list shows the creator as org_admin", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-06", "a");
    const org = await provisionOrg(a, "m1-p1-06", "Acme");

    await a.page.goto(`/orgs/${org.id}/members`);
    await expect(a.page.getByTestId("members-table")).toBeVisible({
      timeout: 15_000,
    });
    expect(await numericText(a.page.getByTestId("member-count").first())).toBe(
      1,
    );

    const row = memberRow(a.page, a.email);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("member-email")).toContainText(a.email);
    await expect(row.getByTestId("member-role")).toContainText("org_admin");
    expect(
      await row.getAttribute("data-user-id"),
      "member row's data-user-id must equal GET /api/me id",
    ).toBe(a.id);
  });

  test("P1-07 signed-out visitors are redirected and see no org data", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-07", "a");
    const org = await provisionOrg(a, "m1-p1-07", "Acme");

    const fresh = await world.context();
    const page = await fresh.newPage();
    for (const route of ["/", "/orgs", `/orgs/${org.id}/members`]) {
      await page.goto(route);
      await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
      expectNoLeak(await page.content(), [org.name, a.email], route);
    }
  });

  test("P1-08 duplicate slug is rejected", async ({ world }) => {
    const a = await world.signUp("m1-p1-08", "a");
    const org1 = await provisionOrg(a, "m1-p1-08", "Acme");
    await provisionOrg(a, "m1-p1-08", "Beta");

    await a.page.goto("/orgs/new");
    await a.page
      .getByTestId("org-name-input")
      .fill(scopedName("m1-p1-08", "Gamma"));
    await a.page.getByTestId("org-slug-input").fill(org1.slug);
    await a.page.getByTestId("create-org-submit").click();
    await expect(a.page.getByTestId("create-org-error")).toBeVisible({
      timeout: 15_000,
    });

    await a.page.goto("/orgs");
    await expect(a.page.getByTestId("org-card")).toHaveCount(2, {
      timeout: 15_000,
    });
  });

  test("P1-09 a non-member cannot reach another user's org", async ({
    world,
  }) => {
    const a = await world.signUp("m1-p1-09", "a");
    const org = await provisionOrg(a, "m1-p1-09", "Acme");

    const b = await world.signUp("m1-p1-09", "b");
    for (const route of [`/orgs/${org.id}`, `/orgs/${org.id}/members`]) {
      await expectDeniedPage(b.page, route, [org.name, a.email]);
    }
  });

  test("P1-10 wrong password does not create a session", async ({ world }) => {
    const a = await world.signUp("m1-p1-10", "a");

    // Fresh context: A's own session must stay intact.
    const fresh = await world.context();
    const page = await fresh.newPage();
    await signIn(page, { email: a.email, password: "WrongPassword!1" });
    await expect(page.getByTestId("signin-error")).toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).toContain("/auth/sign-in");

    await page.goto("/orgs");
    await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
  });

  test("S1-01 cross-user raw requests leak no org data", async ({ world }) => {
    const a = await world.signUp("m1-s1-01", "a");
    const org = await provisionOrg(a, "m1-s1-01", "Acme");
    const b = await world.signUp("m1-s1-01", "b");

    for (const route of [`/orgs/${org.id}`, `/orgs/${org.id}/members`]) {
      const resp = await b.ctx.request.get(route, { maxRedirects: 0 });
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
      expectNoLeak(body, [org.name, a.email], `${route} (B's cookie)`);
    }
  });

  test("S1-02 unauthenticated requests are rejected", async ({ world }) => {
    const a = await world.signUp("m1-s1-02", "a");
    const org = await provisionOrg(a, "m1-s1-02", "Acme");

    const anon = await world.anon();
    for (const route of [`/orgs/${org.id}`, `/orgs/${org.id}/members`]) {
      const resp = await anon.get(route, { maxRedirects: 0 });
      expect(
        [301, 302, 303, 307, 308, 401, 403, 404],
        `${route} anonymous (got ${resp.status()})`,
      ).toContain(resp.status());
      expectNoLeak(
        await resp.text(),
        [org.name, a.email],
        `${route} (anonymous)`,
      );
    }

    // /api/me pins 401 for a missing session (M1 prompt + S1-02).
    const me = await anon.get("/api/me", { maxRedirects: 0 });
    expect([401, 403], `GET /api/me anonymous (got ${me.status()})`).toContain(
      me.status(),
    );
    expectNoLeak(await me.text(), [a.email, a.id], "/api/me (anonymous)");
  });
});
