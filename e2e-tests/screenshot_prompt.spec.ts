import { expect, type ElectronApplication } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, Timeout } from "./helpers/test_helper";

// Both flows end in a filed report, with a back out on the way. Backing out on
// its own only shows the dialog returned; carrying on afterwards is what shows
// the flow still works, which is where this feature's regressions have been.
//
// The capture is stubbed at the IPC boundary, so these cover the flow's
// handling of a successful capture, not that an image reaches the clipboard.
// A real capture needs a host that grants the window OS focus, which the CI
// runner does not.

/** Makes the capture succeed without needing a focused window or a clipboard. */
async function stubScreenshotCapture(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("take-screenshot");
    ipcMain.handle("take-screenshot", () => ({
      dataUrl: "data:image/png;base64,AAAA",
    }));
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

test("file a bug report without a screenshot", async ({ po }) => {
  await po.setUp();
  await recordIssueUrls(po.electronApp);

  await po.page.getByRole("button", { name: "Help" }).click();
  await po.page.getByRole("button", { name: "Report a Bug" }).click();

  const description = po.page.getByLabel("What went wrong?");
  await expect(description).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.getByLabel("Title").fill("Preview goes blank");
  await description.fill("Switching branches blanks the preview.");

  await po.page.getByRole("button", { name: "Next: add a screenshot" }).click();
  await expect(po.page.getByText("Take a screenshot?")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Backing out returns to the form with the draft, rather than discarding
  // what the reporter already wrote.
  await po.page.keyboard.press("Escape");
  await expect(description).toHaveValue(
    "Switching branches blanks the preview.",
  );
  await expect(po.page.getByText("Take a screenshot?")).not.toBeVisible();

  // The report that follows the back out is the point: a dismissal must not
  // leave state behind that breaks the next one.
  await po.page.getByRole("button", { name: "Next: add a screenshot" }).click();
  await po.page.getByText("File bug report without screenshot").click();

  const params = await firstIssueUrl(po.electronApp);
  expect(params.get("title")).toBe("[bug] Preview goes blank");
  expect(params.get("labels")).toContain("bug");
  const body = params.get("body") ?? "";
  expect(body).toContain("Screenshot status: declined");
  expect(body).toContain("Switching branches blanks the preview.");
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
    await expect(po.page.getByLabel("Chat session")).toBeChecked();

    await po.page.getByRole("button", { name: "Create GitHub issue" }).click();
    await po.page.getByRole("button", { name: /recommended/ }).click();

    // The prompt hides itself for the capture, then confirms it succeeded.
    await expect(
      po.page.getByText(/Screenshot captured to clipboard/),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.page.getByText("Create GitHub issue").click();

    const params = await firstIssueUrl(po.electronApp);
    expect(params.get("labels")).toContain("bug");
    const body = params.get("body") ?? "";
    expect(body).toContain("Screenshot status: captured");
    expect(body).toContain("The generated page is blank.");
    // The session the reporter uploaded is the one the issue points at.
    expect(body).toContain("v2:e2e-session");
    expect(uploads).toEqual(["/signed"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
