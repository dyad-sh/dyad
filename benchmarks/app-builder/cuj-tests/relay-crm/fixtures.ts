// Shared Relay CRM suite helpers (design/app-1-relay-crm.md, "Test fixtures &
// conventions"). Used by all three checkpoint suites; keep behavior-neutral —
// checkpoint-1's 12 tests must not change semantics.
import { expect, type BrowserContext, type Page } from "@playwright/test";

export const RUN_ID = `${Date.now()}`;
export const PASSWORD = "Passw0rd!Relay1";

export const identity = (role: string) => ({
  name: `Relay ${role[0].toUpperCase()}${role.slice(1)}`,
  email: `relay-${RUN_ID}-${role}@example.com`,
  password: PASSWORD,
});

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

export async function expectSignedIn(page: Page, email: string) {
  // The pinned M1 contract is "signs the user in immediately" plus the
  // header's user-menu showing the email. A post-sign-up auto-redirect
  // target is NOT pinned, so give a redirecting app its natural flow briefly,
  // then navigate to /contacts explicitly and assert the signed-in header.
  await page.waitForURL("**/contacts", { timeout: 5_000 }).catch(async () => {
    await page.goto("/contacts");
  });
  await expect(page.getByTestId("user-menu")).toContainText(email, {
    timeout: 15_000,
  });
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
