import { expect, type Page } from "@playwright/test";

// Test IDs remain mandatory. A menu's contents need not exist until it opens.
export async function clickMenuItem(
  page: Page,
  triggerId: string,
  itemId: string,
) {
  const item = page.getByTestId(itemId);
  if (!(await item.isVisible())) await page.getByTestId(triggerId).click();
  await item.click();
}

export async function openOptions(
  page: Page,
  triggerId: string,
  optionId?: string,
) {
  const trigger = page.getByTestId(triggerId);
  await expect(trigger).toBeVisible();
  if ((await trigger.evaluate((el) => el.tagName)) === "SELECT") return;
  if (
    optionId &&
    (await page.getByTestId(optionId).filter({ visible: true }).count())
  )
    return;
  // A second click closes an already-open dropdown (e.g. after counting options).
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
}

// M1 specifies a delete action, not a confirmation test ID or dialog strategy.
// Accept inline, native (handled by the fixture), and accessible modal confirms.
// Never leave the page before the actual DELETE response finishes.
export async function deleteThroughUI(
  page: Page,
  triggerId: string,
  confirmId: string,
  apiPath: string,
) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === apiPath &&
      r.request().method() === "DELETE",
  );
  // Keep a failed click from leaving an unhandled response wait on teardown.
  // Awaiting the original promise below still propagates request failures.
  void response.catch(() => {});
  const confirmation = page
    .getByTestId(confirmId)
    .or(
      page
        .getByRole("alertdialog")
        .or(page.getByRole("dialog"))
        .getByRole("button", { name: /^(delete|confirm)(\s|$)/i }),
    )
    .filter({ visible: true })
    .first();
  await page.getByTestId(triggerId).click();
  const next = await Promise.any([
    response.then(() => "deleted"),
    confirmation.waitFor({ state: "visible" }).then(() => "confirm"),
  ]);
  if (next === "confirm") await confirmation.click();
  const result = await response;
  expect(result.status(), "DELETE must succeed").toBeGreaterThanOrEqual(200);
  expect(result.status(), "DELETE must succeed").toBeLessThan(300);
  // A 204 has no body; Playwright can leave response.finished() pending for it.
  // Successful response headers arrive after the server commits the deletion.
}
