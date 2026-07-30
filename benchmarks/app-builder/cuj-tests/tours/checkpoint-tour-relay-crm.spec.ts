// Relay CRM — video tour of the checkpoint-3 app.
//
// FILE NAMING: this must match `playwright.video.config.mjs`'s
// `testMatch: ["**/checkpoint-*.spec.ts"]`, which is why the file is called
// `checkpoint-tour-*.spec.ts` rather than `relay-crm.tour.spec.ts`. Playwright
// does not collect files outside testMatch even when the path is passed
// explicitly on the command line, and the config is shared with scoring, so it
// is left untouched. Scoring always passes an explicit `<app>/checkpoint-N`
// path, so these tours never join a scoring run.
//
// SINGLE CONTEXT: the whole tour — owner and viewer — runs in ONE browser
// context, switching persona by signing out and signing back in, so the
// recording is one continuous video file. No second context is needed.
import { test, expect, type Page } from "@playwright/test";
import { RUN_ID, reportTour, startTour } from "./tour-kit";

// We record explicitly on our own context; the fixture context is unused.
test.use({ video: "off" });

const VIDEO_DIR = process.env.VIDEO_DIR || "videos-out";
const TOTAL = 12;
const PASSWORD = "Passw0rd!Relay1";

const OWNER = {
  name: "Relay Owner",
  email: `tour-relay-${RUN_ID}-owner@example.com`,
  password: PASSWORD,
};
const VIEWER = {
  name: "Relay Viewer",
  email: `tour-relay-${RUN_ID}-viewer@example.com`,
  password: PASSWORD,
};

const ADA = `Ada ${RUN_ID}`;
const ACME = `Acme ${RUN_ID}`;
const DEAL = `Renewal ${RUN_ID}`;
const NOTE = `Called about renewal ${RUN_ID}`;

async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL("**/contacts", { timeout: 5_000 }).catch(async () => {
    await page.goto("/contacts");
  });
}

async function signIn(
  page: Page,
  who: { email: string; password: string },
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
  await page.waitForURL("**/contacts", { timeout: 5_000 }).catch(async () => {
    await page.goto("/contacts");
  });
}

async function signOut(page: Page): Promise<void> {
  await page.getByTestId("sign-out-button").click();
  await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
}

test("relay-crm tour", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const tour = startTour(page, TOTAL);
  let workspace = "";

  try {
    await tour.step("Sign up — a new CRM account", async () => {
      await signUp(page, OWNER);
      await expect
        .poll(async () => (await page.request.get("/api/me")).status(), {
          timeout: 15_000,
        })
        .toBe(200);
      workspace = (
        (await page
          .getByTestId("workspace-current-name")
          .first()
          .textContent()
          .catch(() => "")) ?? ""
      ).trim();
    });

    await tour.step("Create a contact", async () => {
      await page.goto("/contacts");
      await page.getByTestId("contact-new-button").click();
      await page.getByTestId("contact-form-name").fill(ADA);
      await page
        .getByTestId("contact-form-email")
        .fill(`ada-${RUN_ID}@example.com`);
      await page
        .getByTestId("contact-form-title")
        .fill("Head of Ops")
        .catch(() => undefined);
      await page.getByTestId("contact-form-submit").click();
      await page.goto("/contacts");
      await expect(
        page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Create a company", async () => {
      await page.goto("/companies");
      await page.getByTestId("company-new-button").click();
      await page.getByTestId("company-form-name").fill(ACME);
      await page
        .getByTestId("company-form-domain")
        .fill(`acme-${RUN_ID}.example`);
      await page.getByTestId("company-form-submit").click();
      await page.goto("/companies");
      await expect(
        page.getByTestId("company-row-name").filter({ hasText: ACME }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Search the contact list", async () => {
      await page.goto("/contacts");
      await page.getByTestId("contacts-search").fill(ADA.split(" ")[0]);
      await page.waitForTimeout(900);
      await expect(
        page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Create a deal on the pipeline", async () => {
      await page.goto("/deals");
      await page.getByTestId("deal-new-button").click();
      await page.getByTestId("deal-form-title").fill(DEAL);
      await page.getByTestId("deal-form-amount").fill("7500");
      await page.getByTestId("deal-form-stage").selectOption("lead");
      await page
        .getByTestId("deal-form-contact")
        .selectOption({ label: ADA })
        .catch(() => undefined);
      await page.getByTestId("deal-form-submit").click();
      await page.goto("/deals");
      await expect(
        page
          .getByTestId("kanban-column-lead")
          .getByTestId("deal-card")
          .filter({ hasText: DEAL })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Move the deal lead → qualified", async () => {
      await page
        .getByTestId("kanban-column-lead")
        .getByTestId("deal-card")
        .filter({ hasText: DEAL })
        .first()
        .getByTestId("deal-card-stage-select")
        .selectOption("qualified");
      await page.reload();
      await expect(
        page
          .getByTestId("kanban-column-qualified")
          .getByTestId("deal-card")
          .filter({ hasText: DEAL })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Log an activity note on the contact", async () => {
      await page.goto("/contacts");
      await page
        .getByTestId("contact-row")
        .filter({ hasText: ADA })
        .first()
        .getByTestId("contact-row-link")
        .click();
      await page.getByTestId("activity-note-input").fill(NOTE);
      await page.getByTestId("activity-note-submit").click();
      await expect(
        page
          .getByTestId("activity-item")
          .first()
          .getByTestId("activity-item-body"),
      ).toContainText(NOTE, { timeout: 15_000 });
    });

    await tour.step("CSV export is offered on the contacts list", async () => {
      await page.goto("/contacts");
      await expect(
        page.getByTestId("export-contacts-button").first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Invite a teammate as a read-only viewer", async () => {
      await page.goto("/settings/members");
      await page.getByTestId("invite-email-input").fill(VIEWER.email);
      const role = page.getByTestId("invite-role-select");
      if (await role.count()) await role.first().selectOption("viewer");
      await page.getByTestId("invite-submit").click();
      await expect(
        page
          .getByTestId("pending-invite-row")
          .filter({ hasText: VIEWER.email })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step(
      "Switch persona: sign up as the viewer and accept the invite",
      async () => {
        await signOut(page);
        await signUp(page, VIEWER);
        await page.goto("/invites");
        const row = page
          .getByTestId("invite-row")
          .filter({ hasText: workspace || "" })
          .first();
        const scoped = row.getByTestId("invite-accept-button");
        if (await scoped.count()) await scoped.first().click();
        else await page.getByTestId("invite-accept-button").first().click();
        await page.getByTestId("workspace-switcher").first().click();
        await page
          .getByTestId("workspace-switcher-option")
          .filter({ hasText: workspace || "" })
          .first()
          .click();
        await expect(page.getByTestId("workspace-current-name")).toContainText(
          workspace || "",
          { timeout: 15_000 },
        );
      },
    );

    await tour.step(
      "Security: the viewer can read but cannot create or manage",
      async () => {
        await page.goto("/contacts");
        await expect(
          page.getByTestId("contact-row").filter({ hasText: ADA }).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId("contact-new-button")).not.toBeVisible();
        await expect(page.getByTestId("nav-members")).not.toBeVisible();
        await page.goto("/contacts/new");
        await page.waitForTimeout(800);
        const stillOnNew = page.url().includes("/contacts/new");
        if (stillOnNew) {
          await expect(page.getByTestId("forbidden-message")).toBeVisible({
            timeout: 10_000,
          });
        }
      },
    );

    await tour.step("Back as the owner: the members list", async () => {
      await signOut(page);
      await signIn(page, OWNER);
      await page.goto("/settings/members");
      await expect(
        page
          .getByTestId("member-row")
          .filter({ hasText: VIEWER.email })
          .first()
          .getByTestId("member-row-role"),
      ).toContainText(/viewer/i, { timeout: 15_000 });
    });
  } finally {
    reportTour("relay-crm", tour, TOTAL);
    await context.close(); // flushes the video file
  }
});
