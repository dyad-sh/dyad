import { expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test, Timeout } from "./helpers/test_helper";

test("bug report: backing out of the prompt returns to help", async ({
  po,
}) => {
  await po.setUp();

  await po.page.getByRole("button", { name: "Help" }).click();
  await po.page.getByRole("button", { name: "Report a Bug" }).click();
  await expect(po.page.getByText("Take a screenshot?")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  await po.page.keyboard.press("Escape");
  await expect(po.page.getByText("Need help with Dyad?")).toBeVisible();
  await expect(po.page.getByText("Take a screenshot?")).not.toBeVisible();
});

test("session report: backing out of the prompt keeps the uploaded session", async ({
  po,
}) => {
  await po.setUp();
  await po.sendPrompt("tc=write-index");

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
    await po.page.getByRole("button", { name: "Upload Chat Session" }).click();
    await po.page.getByRole("button", { name: "Upload", exact: true }).click();

    await expect(po.page.getByText("Upload Complete")).toBeVisible({
      timeout: Timeout.LONG,
    });
    // The id shown comes from the real upload round trip.
    await expect(po.page.getByText("v2:e2e-session")).toBeVisible();
    expect(uploads).toEqual(["/signed"]);

    await po.page.getByRole("button", { name: "Create GitHub Issue" }).click();
    await expect(po.page.getByText("Take a screenshot?")).toBeVisible();

    // Backing out must not orphan an upload that already reached the server.
    await po.page.keyboard.press("Escape");
    await expect(po.page.getByText("Upload Complete")).toBeVisible();
    await expect(po.page.getByText("v2:e2e-session")).toBeVisible();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
