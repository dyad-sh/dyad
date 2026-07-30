// Deskhero — video tour of the checkpoint-3 app.
//
// FILE NAMING: matches `playwright.video.config.mjs`'s
// `testMatch: ["**/checkpoint-*.spec.ts"]` (see checkpoint-tour-relay-crm for
// the full rationale — the shared config is deliberately left untouched).
//
// SINGLE CONTEXT: admin, agent and requester all share ONE browser context,
// switching persona by signing out and back in, so the tour records as one
// continuous video. No second context is needed.
import { test, expect, type Page } from "@playwright/test";
import { RUN_ID, reportTour, startTour } from "./tour-kit";

test.use({ video: "off" });

const VIDEO_DIR = process.env.VIDEO_DIR || "videos-out";
const TOTAL = 12;
const PASSWORD = "Passw0rd!Desk1";

// The `admin+` local-part prefix is the M2 bootstrap rule for admin.
const ADMIN = {
  name: "Desk Admin",
  email: `admin+tour${RUN_ID}@deskhero.test`,
  password: PASSWORD,
};
const AGENT = {
  name: "Desk Agent",
  email: `agent1+tour${RUN_ID}@deskhero.test`,
  password: PASSWORD,
};
const REQUESTER = {
  name: "Desk Requester",
  email: `req1+tour${RUN_ID}@deskhero.test`,
  password: PASSWORD,
};

const TICKET = `Printer offline ${RUN_ID}`;
const NOTE = `internal-note-${RUN_ID}`;
const REPLY = `Engineer dispatched ${RUN_ID}`;

async function signUp(
  page: Page,
  who: { name: string; email: string; password: string },
) {
  await page.goto("/auth/sign-up");
  await page.getByTestId("signup-name").fill(who.name);
  await page.getByTestId("signup-email").fill(who.email);
  await page.getByTestId("signup-password").fill(who.password);
  await page.getByTestId("signup-submit").click();
  await page.waitForTimeout(1_200);
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(who.email);
  await page.getByTestId("signin-password").fill(who.password);
  await page.getByTestId("signin-submit").click();
  await page.waitForTimeout(1_200);
}

async function signOut(page: Page) {
  await page.getByTestId("sign-out").click();
  await page.waitForURL("**/auth/sign-in", { timeout: 15_000 });
}

/** Open a ticket from whichever list is on screen. */
async function openTicket(page: Page, subject: string) {
  const row = page.getByTestId("ticket-row").filter({ hasText: subject });
  await expect(row.first()).toBeVisible({ timeout: 15_000 });
  await row.first().click();
  await expect(page.getByTestId("ticket-detail-subject")).toContainText(
    subject,
    { timeout: 15_000 },
  );
}

test("deskhero tour", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const tour = startTour(page, TOTAL);

  try {
    await tour.step("Sign up the helpdesk admin", async () => {
      await signUp(page, ADMIN);
      await expect
        .poll(async () => (await page.request.get("/api/me")).status(), {
          timeout: 15_000,
        })
        .toBe(200);
      await page.goto("/admin");
      await expect(page.getByTestId("admin-dashboard")).toBeVisible({
        timeout: 15_000,
      });
    });

    await tour.step(
      "Sign up a second user (defaults to requester)",
      async () => {
        await signOut(page);
        await signUp(page, AGENT);
        await expect
          .poll(async () => (await page.request.get("/api/me")).status(), {
            timeout: 15_000,
          })
          .toBe(200);
        await expect(page.getByTestId("role-badge")).toContainText(
          /requester/i,
          {
            timeout: 15_000,
          },
        );
      },
    );

    await tour.step("Admin promotes that user to agent", async () => {
      await signOut(page);
      await signIn(page, ADMIN);
      await page.goto("/admin/users");
      const row = page
        .getByTestId("user-row")
        .filter({ hasText: AGENT.email })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByTestId("user-role-select").selectOption("agent");
      await page.waitForTimeout(800);
    });

    await tour.step(
      "A requester signs up and lands on their tickets",
      async () => {
        await signOut(page);
        await signUp(page, REQUESTER);
        await page.goto("/tickets");
        await expect
          .poll(async () => (await page.request.get("/api/me")).status(), {
            timeout: 15_000,
          })
          .toBe(200);
      },
    );

    await tour.step("Requester files a high-priority ticket", async () => {
      await page.goto("/tickets");
      await page.getByTestId("new-ticket-link").click();
      await page.getByTestId("ticket-subject").fill(TICKET);
      await page
        .getByTestId("ticket-body")
        .fill("The floor-3 printer will not come online.");
      await page.getByTestId("ticket-priority").selectOption("high");
      await page.getByTestId("ticket-submit").click();
      await page.waitForTimeout(1_000);
    });

    await tour.step(
      "The ticket carries a priority-derived SLA due time",
      async () => {
        await page.goto("/tickets");
        await openTicket(page, TICKET);
        await expect(page.getByTestId("ticket-detail-priority")).toContainText(
          /high/i,
        );
        await expect(page.getByTestId("sla-due")).toBeVisible({
          timeout: 15_000,
        });
      },
    );

    await tour.step("Agent opens the queue and takes the ticket", async () => {
      await signOut(page);
      await signIn(page, AGENT);
      await page.goto("/agent");
      await expect(page.getByTestId("agent-dashboard")).toBeVisible({
        timeout: 15_000,
      });
      await openTicket(page, TICKET);
      const assignToMe = page.getByTestId("assign-to-me");
      if (await assignToMe.count()) {
        await assignToMe.first().click();
      } else {
        await page
          .getByTestId("assignee-select")
          .first()
          .selectOption({ label: AGENT.name });
      }
      await page.waitForTimeout(800);
      await expect(page.getByTestId("ticket-assignee")).toContainText(
        new RegExp(AGENT.name.split(" ")[1] ?? AGENT.name, "i"),
        { timeout: 15_000 },
      );
    });

    await tour.step("Agent starts work: open → in_progress", async () => {
      await page.getByTestId("transition-in_progress").click();
      await expect(page.getByTestId("ticket-detail-status")).toContainText(
        /in.?progress/i,
        { timeout: 15_000 },
      );
    });

    await tour.step("Agent adds an internal note (agents only)", async () => {
      await page.getByTestId("note-input").fill(NOTE);
      await page.getByTestId("note-submit").click();
      await expect(
        page.getByTestId("note-item").filter({ hasText: NOTE }).first(),
      ).toBeVisible({ timeout: 15_000 });
    });

    await tour.step("Agent replies to the requester and resolves", async () => {
      await page.getByTestId("reply-input").fill(REPLY);
      await page.getByTestId("reply-submit").click();
      await expect(
        page.getByTestId("reply-item").filter({ hasText: REPLY }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("transition-resolved").click();
      await expect(page.getByTestId("ticket-detail-status")).toContainText(
        /resolved/i,
        { timeout: 15_000 },
      );
    });

    await tour.step(
      "Security: the requester sees the reply but never the internal note",
      async () => {
        await signOut(page);
        await signIn(page, REQUESTER);
        await page.goto("/tickets");
        await openTicket(page, TICKET);
        await expect(
          page.getByTestId("reply-item").filter({ hasText: REPLY }).first(),
        ).toBeVisible({ timeout: 15_000 });
        expect(await page.content()).not.toContain(NOTE);
        await page.getByTestId("transition-closed").click();
        await expect(page.getByTestId("ticket-detail-status")).toContainText(
          /closed/i,
          { timeout: 15_000 },
        );
      },
    );

    await tour.step(
      "Admin audit log records the role change and transitions",
      async () => {
        await signOut(page);
        await signIn(page, ADMIN);
        await page.goto("/admin/audit");
        await expect(
          page
            .getByTestId("audit-row")
            .filter({ hasText: "role_change" })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          page
            .getByTestId("audit-row")
            .filter({ hasText: /resolved/i })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      },
    );
  } finally {
    reportTour("deskhero", tour, TOTAL);
    await context.close();
  }
});
