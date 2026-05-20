import { expect, type Page } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

async function terminalText(page: Page) {
  return page.evaluate(() => {
    const terminal = (window as any).__DYAD_TERMINAL__;
    if (!terminal) return "";
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index++) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  });
}

test("in-chat terminal runs commands, reopens previous session, and exits with chord", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  const toggle = po.page.getByTestId("toggle-terminal-button");
  await expect(toggle).toBeVisible({ timeout: Timeout.MEDIUM });
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox).not.toBeNull();
  await toggle.click();

  await expect(po.page.getByText("Terminal", { exact: true })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  const drawer = po.page.getByTestId("terminal-drawer");
  await expect(drawer).toBeVisible();
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(drawerBox!.y).toBeLessThanOrEqual(toggleBox!.y + 1);
  await expect(po.page.getByTestId("terminal-xterm")).toBeVisible();

  await po.page.keyboard.type("echo hello dyad");
  await po.page.keyboard.press("Enter");

  await expect
    .poll(() => terminalText(po.page), { timeout: Timeout.MEDIUM })
    .toContain("hello dyad");

  await po.page.keyboard.press("Escape");
  await expect(po.page.getByText("Terminal", { exact: true })).toBeVisible();

  const closeChord = process.platform === "darwin" ? "Meta+K" : "Control+K";
  await po.page.keyboard.press(closeChord);
  await expect(po.page.getByTestId("messages-list")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  await toggle.click();
  await expect
    .poll(() => terminalText(po.page), { timeout: Timeout.MEDIUM })
    .toContain("hello dyad");
});
