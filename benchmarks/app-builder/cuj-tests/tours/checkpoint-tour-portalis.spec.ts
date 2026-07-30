// Portalis — video tour of the checkpoint-3 app.
//
// FILE NAMING: matches `playwright.video.config.mjs`'s
// `testMatch: ["**/checkpoint-*.spec.ts"]` (see checkpoint-tour-relay-crm for
// the full rationale — the shared config is deliberately left untouched).
//
// SINGLE CONTEXT: the org admin and the invited member share ONE browser
// context, switching persona by signing out and back in, so the tour records
// as one continuous video. No second context is needed.
import { test, expect, type Page } from "@playwright/test";
import { RUN_ID, reportTour, startTour } from "./tour-kit";

test.use({ video: "off" });

const VIDEO_DIR = process.env.VIDEO_DIR || "videos-out";
const TOTAL = 13;
const PASSWORD = "Passw0rd!Portalis1";

const ADMIN = {
  name: "Portalis Admin",
  email: `portalis-tour-${RUN_ID}-a@example.test`,
  password: PASSWORD,
};
const MEMBER = {
  name: "Portalis Member",
  email: `portalis-tour-${RUN_ID}-b@example.test`,
  password: PASSWORD,
};

const ORG = `Northwind ${RUN_ID}`;
const SLUG = `northwind-${RUN_ID}`;
const PROJECT_A = `Alpha ${RUN_ID}`;
const PROJECT_B = `Beta ${RUN_ID}`;
const KEY_NAME = `ci-key-${RUN_ID}`;
const ORG_ID_IN_URL =
  /\/orgs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/orgs**", { timeout: 5_000 }).catch(async () => {
    await page.goto("/orgs");
  });
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
  await page.waitForURL("**/orgs**", { timeout: 5_000 }).catch(async () => {
    await page.goto("/orgs");
  });
}

async function signOut(page: Page) {
  await page.goto("/orgs");
  await page.getByTestId("sign-out-button").click();
  await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
}

async function createProject(page: Page, orgId: string, name: string) {
  await page.goto(`/orgs/${orgId}/projects/new`);
  await page.getByTestId("project-name-input").fill(name);
  const desc = page.getByTestId("project-description-input");
  if (await desc.count()) await desc.first().fill(`Tour project ${RUN_ID}`);
  await page.getByTestId("project-create-submit").click();
  await page.goto(`/orgs/${orgId}/projects`);
  await expect(
    page.getByTestId("project-row").filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

test("portalis tour", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const tour = startTour(page, TOTAL);
  let org = "";
  let inviteLink = "";

  try {
    await tour.step("Sign up the portal administrator", async () => {
      await signUp(page, ADMIN);
      await expect
        .poll(async () => (await page.request.get("/api/me")).status(), {
          timeout: 15_000,
        })
        .toBe(200);
    });

    await tour.step("Create an organization", async () => {
      await page.goto("/orgs");
      const link = page.getByTestId("create-org-link");
      if (await link.count()) await link.first().click();
      else await page.goto("/orgs/new");
      await page.getByTestId("org-name-input").fill(ORG);
      await page.getByTestId("org-slug-input").fill(SLUG);
      await page.getByTestId("create-org-submit").click();
      await page.waitForURL(ORG_ID_IN_URL, { timeout: 20_000 });
      org = page.url().match(ORG_ID_IN_URL)?.[1] ?? "";
      expect(org, "org id in URL").toBeTruthy();
      await expect(page.getByTestId("org-header-name")).toContainText(ORG, {
        timeout: 15_000,
      });
    });

    await tour.step("Create the first project", async () => {
      await createProject(page, org, PROJECT_A);
    });

    await tour.step("Create a second project", async () => {
      await createProject(page, org, PROJECT_B);
    });

    await tour.step("Invite a teammate as org_member", async () => {
      await page.goto(`/orgs/${org}/members`);
      await page.getByTestId("invite-email-input").fill(MEMBER.email);
      const role = page.getByTestId("invite-role-select");
      if (await role.count()) await role.first().selectOption("org_member");
      await page.getByTestId("invite-submit").click();
      await expect(
        page
          .getByTestId("invite-row")
          .filter({ hasText: MEMBER.email })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Copy the invite link", async () => {
      await page.goto(`/orgs/${org}/members`);
      const row = page
        .getByTestId("invite-row")
        .filter({ hasText: MEMBER.email })
        .first();
      const link = row.getByTestId("invite-link").first();
      await expect(link).toBeVisible({ timeout: 15_000 });
      inviteLink = ((await link.textContent()) ?? "").trim();
      expect(inviteLink.length, "invite link text").toBeGreaterThan(0);
    });

    await tour.step(
      "The teammate signs up and accepts the invite",
      async () => {
        await signOut(page);
        await signUp(page, MEMBER);
        expect(inviteLink, "invite link captured earlier").toBeTruthy();
        await page.goto(inviteLink);
        await page.getByTestId("accept-invite-submit").click();
        await page.waitForTimeout(1_200);
      },
    );

    await tour.step("The member can see the org's projects", async () => {
      await page.goto(`/orgs/${org}/projects`);
      await expect(
        page.getByTestId("project-row").filter({ hasText: PROJECT_A }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByTestId("project-row").filter({ hasText: PROJECT_B }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step(
      "Security: the audit log is hidden from ordinary members",
      async () => {
        await page.goto(`/orgs/${org}`);
        await expect(page.getByTestId("nav-audit")).toHaveCount(0);
        await page.goto(`/orgs/${org}/audit`);
        await page.waitForTimeout(900);
        await expect(page.getByTestId("audit-row")).toHaveCount(0);
      },
    );

    await tour.step("Back as admin: mint an API key (shown once)", async () => {
      await signOut(page);
      await signIn(page, ADMIN);
      await page.goto(`/orgs/${org}/api-keys`);
      await page.getByTestId("apikey-name-input").fill(KEY_NAME);
      await page.getByTestId("apikey-create-submit").click();
      await expect(page.getByTestId("apikey-plaintext").first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await tour.step("Reload — the secret is never shown again", async () => {
      await page.reload();
      await expect(page.getByTestId("apikey-plaintext")).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(
        page.getByTestId("apikey-row").filter({ hasText: KEY_NAME }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("The audit log records every admin action", async () => {
      await page.goto(`/orgs/${org}/audit`);
      await expect(page.getByTestId("audit-table")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("audit-row").first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await tour.step("The usage dashboard summarises the org", async () => {
      await page.goto(`/orgs/${org}`);
      await expect(
        page.getByTestId("usage-projects-count").first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("usage-members-count").first()).toBeVisible(
        { timeout: 15_000 },
      );
    });
  } finally {
    reportTour("portalis", tour, TOTAL);
    await context.close();
  }
});
