import { expect, type ElectronApplication } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, Timeout } from "./helpers/test_helper";

// The capture is stubbed at the IPC boundary, so these cover the form's
// handling of a successful capture, not that an image reaches the clipboard.
// A real capture needs a host that grants the window OS focus, which the CI
// runner does not.

/** Makes the capture succeed without needing a focused window or a clipboard. */
async function stubScreenshotCapture(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("take-screenshot");
    // A real 1x1 PNG, so the preview actually decodes and the visibility
    // assertion means something.
    ipcMain.handle("take-screenshot", () => ({
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      captureId: "e2e-capture",
    }));
    // Without this the report takes the evicted-capture branch instead, and
    // the status the test asserts on is not the one the app really produces.
    ipcMain.removeHandler("recopy-screenshot");
    ipcMain.handle("recopy-screenshot", () => ({ copied: true }));
  });
}

/** Test builds never open external URLs, so record what would have opened. */
async function recordIssueUrls(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    const opened: string[] = [];
    (globalThis as Record<string, unknown>).__openedUrls = opened;
    ipcMain.removeHandler("open-external-url");
    ipcMain.handle("open-external-url", (_event, url: string) => {
      opened.push(url);
    });
  });
}

/** The query of the first issue URL the app tried to open. */
async function firstIssueUrl(electronApp: ElectronApplication) {
  const read = () =>
    electronApp.evaluate(
      () => (globalThis as Record<string, unknown>).__openedUrls as string[],
    );
  await expect
    .poll(async () => (await read()).length, { timeout: Timeout.MEDIUM })
    .toBeGreaterThan(0);
  return new URL((await read())[0]).searchParams;
}

test("file a bug report with nothing attached", async ({ po }) => {
  await po.setUp();
  await recordIssueUrls(po.electronApp);

  await po.page.getByRole("button", { name: "Help" }).click();
  await po.page.getByRole("button", { name: "Report a Bug" }).click();

  const description = po.page.getByLabel("What happened?");
  await expect(description).toBeVisible({ timeout: Timeout.MEDIUM });
  await description.fill("Switching branches blanks the preview.");

  // Nothing leaves the machine on this path. With no chat open there is no
  // session to offer, so that box is already off and cannot be turned on.
  await po.page
    .getByRole("checkbox", { name: "Basic system information and logs" })
    .uncheck();
  const session = po.page.getByRole("checkbox", { name: "Chat session" });
  await expect(session).not.toBeChecked();
  await expect(session).toBeDisabled();

  await po.page.getByRole("button", { name: "Create GitHub issue" }).click();

  const params = await firstIssueUrl(po.electronApp);
  expect(params.get("labels")).toContain("bug");
  const body = params.get("body") ?? "";
  expect(body).toContain("Switching branches blanks the preview.");
  expect(body).toContain("Screenshot status: declined");
  expect(body).toContain("Not included by the reporter.");
  expect(body).not.toContain("Session ID");
});

test("report a bug with a chat session and a screenshot", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");
  await recordIssueUrls(po.electronApp);
  await stubScreenshotCapture(po.electronApp);

  // Stand in for the upload service on loopback, which test builds accept, so
  // the IPC handler and its upload run for real against a local endpoint.
  const uploads: string[] = [];
  const server = http.createServer((req, res) => {
    uploads.push(req.url ?? "");
    req.resume();
    req.on("end", () => {
      res.writeHead(200);
      res.end();
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  try {
    await po.page.route("**/generate-upload-url", async (route) => {
      await route.fulfill({
        json: {
          uploadUrl: `http://127.0.0.1:${port}/signed`,
          filename: "e2e-session.json",
        },
      });
    });

    await po.page.getByRole("button", { name: "Help" }).click();
    await po.page.getByRole("button", { name: "Report a Bug" }).click();

    const description = po.page.getByLabel("What happened?");
    await expect(description).toBeVisible({ timeout: Timeout.MEDIUM });
    await description.fill("The generated page is blank.");
    await expect(
      po.page.getByRole("checkbox", { name: "Chat session" }),
    ).toBeChecked();

    // The dialog steps aside and leaves a bar in its place, so the reporter
    // can go to wherever the bug is before capturing.
    await po.page.getByRole("button", { name: /Add a screenshot/ }).click();
    const bar = po.page.getByTestId("screenshot-capture-bar");
    await expect(bar).toBeVisible();
    await expect(description).not.toBeVisible();
    // Only once the dialog is fully gone, so its own focus handling has
    // already run and cannot take focus back afterwards.
    await expect(po.page.getByRole("dialog")).toHaveCount(0);
    // Keyboard users land on the way forward, not on the page body.
    await expect(
      bar.getByRole("button", { name: "Capture screenshot" }),
    ).toBeFocused();

    // The bar survives the reporter moving around the app.
    await po.navigation.goToSettingsTab();
    await expect(bar).toBeVisible();

    // Capturing brings the form back with the screenshot on it.
    await bar.getByRole("button", { name: "Capture screenshot" }).click();
    await expect(
      po.page.getByAltText("Screenshot of the Dyad window"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(bar).not.toBeVisible();
    // The image travels on the clipboard, so the reporter has to be told.
    await expect(
      po.page.getByText(/in the GitHub issue to attach it/),
    ).toBeVisible();
    // The draft survives the dialog hiding and reopening.
    await expect(description).toHaveValue("The generated page is blank.");

    await po.page.getByRole("button", { name: "Create GitHub issue" }).click();

    const params = await firstIssueUrl(po.electronApp);
    expect(params.get("labels")).toContain("bug");
    const body = params.get("body") ?? "";
    expect(body).toContain("Screenshot status: captured");
    // The reporter is reminded to paste in both places they might look: in
    // the issue itself, and back in Dyad once the browser has opened.
    expect(body).toContain("Paste your screenshot here");
    await expect(
      po.page.getByText("Did you paste your screenshot?"),
    ).toBeVisible();
    await po.page.getByRole("button", { name: "Done" }).click();
    await expect(po.page.getByRole("dialog")).toHaveCount(0);
    expect(body).toContain("The generated page is blank.");
    // The session the reporter uploaded is the one the issue points at.
    expect(body).toContain("v2:e2e-session");
    expect(uploads).toEqual(["/signed"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
