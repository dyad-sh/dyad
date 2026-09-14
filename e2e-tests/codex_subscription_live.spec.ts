import { expect } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { test } from "./helpers/test_helper";

// Deliberate live test: browser sign-in is human-owned, inference uses a real
// subscription, and only Dyad billing is a contract stub. No credential import.
test.use({ trace: "off" });
test("live Codex subscription through Dyad", async ({ po, electronApp }) => {
  test.skip(
    process.env.DYAD_LIVE_SUBSCRIPTION_SMOKE !== "1",
    "Requires an interactive ChatGPT subscription sign-in",
  );
  test.setTimeout(10 * 60_000);
  await po.setUpDyadPro({
    localAgent: true,
    localAgentUseAutoModel: true,
    autoApprove: true,
  });
  await po.importApp("minimal");
  const previousEngine = await electronApp.evaluate(
    () => process.env.DYAD_ENGINE_URL,
  );
  if (!previousEngine)
    throw new Error(
      "Live smoke requires DYAD_ENGINE_URL for auxiliary requests.",
    );
  const reports: Array<{
    id: string;
    modelId: string;
    modelProvider: string;
    totalTokens: number;
    cachedInputTokens: number;
    uncachedInputTokens: number;
    outputTokens: number;
  }> = [];
  const billing = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (req.url === "/track-usage") {
      const report = JSON.parse(body.toString());
      reports.push(report);
      // Contract receipt only: this is NOT a real engine charge.
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: report.id, chargedUsd: 0.001 }));
      return;
    }
    const response = await fetch(`${previousEngine}${req.url}`, {
      method: req.method,
      ...(body.length ? { body } : {}),
      headers: Object.fromEntries(
        Object.entries(req.headers)
          .filter(
            ([key, value]) =>
              value &&
              ![
                "host",
                "connection",
                "content-length",
                "transfer-encoding",
                "keep-alive",
                "upgrade",
                "proxy-authorization",
                "proxy-authenticate",
                "te",
                "trailer",
              ].includes(key),
          )
          .map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(", ") : value!,
          ]),
      ),
    });
    res.writeHead(response.status, {
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => billing.listen(0, "127.0.0.1", resolve));
  const address = billing.address();
  if (!address || typeof address === "string")
    throw new Error("Billing fixture unavailable");
  try {
    await electronApp.evaluate((_, url) => {
      process.env.DYAD_ENGINE_URL = url;
      // Billing and balance are fixtures; only subscription inference is live.
      process.env.DYAD_USER_INFO_URL = `http://localhost:${process.env.FAKE_LLM_PORT}/api/user/info`;
    }, `http://127.0.0.1:${address.port}`);
    await po.page.evaluate(async () => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        enableCodeExplorer: false,
        enableAppBlueprint: false,
      });
      await (window as any).electron.ipcRenderer.invoke(
        "codex-subscription:connect",
        { acceptCharges: true },
      );
    });
    console.log(
      "Complete the official ChatGPT browser sign-in to continue the live Dyad smoke test.",
    );
    await expect
      .poll(
        async () =>
          po.page.evaluate(async () => {
            const result = await (window as any).electron.ipcRenderer.invoke(
              "codex-subscription:status",
            );
            return (result.value ?? result).connected;
          }),
        { timeout: 5 * 60_000, intervals: [2000] },
      )
      .toBe(true);

    const chatId = Number(new URL(po.page.url()).searchParams.get("id"));
    expect(chatId).toBeGreaterThan(0);
    await po.page.evaluate(
      async ({ chatId, model }) => {
        await (window as any).electron.ipcRenderer.invoke("update-chat", {
          chatId,
          modelSelection: {
            provider: "openai",
            name: model,
            effortLevel: "low",
            connection: "subscription",
          },
        });
      },
      { chatId, model: process.env.DYAD_LIVE_SUBSCRIPTION_MODEL ?? "gpt-5.4" },
    );
    await electronApp.evaluate(async ({ app, BrowserWindow }) => {
      const path = await import("node:path");
      try {
        await BrowserWindow.getAllWindows()[0].loadFile(
          path.join(app.getAppPath(), ".vite/renderer/main_window/index.html"),
        );
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED"))
          throw error;
      }
    });
    await po.page.waitForLoadState("domcontentloaded");
    const celebration = po.page.getByRole("button", { name: "Let's build" });
    if (await celebration.isVisible()) await celebration.click();
    await po.sendPrompt(
      "Use write_file to create subscription-smoke.txt in the app root with exactly DYAD_SUBSCRIPTION_OK. Do not install packages or delegate. Then reply Done.",
      { timeout: 120_000 },
    );
    const appPath = await po.appManagement.getCurrentAppPath();
    expect(
      fs.readFileSync(path.join(appPath, "subscription-smoke.txt"), "utf8"),
    ).toContain("DYAD_SUBSCRIPTION_OK");
    await expect(
      po.page.getByText(/ChatGPT subscription \(/).last(),
    ).toBeVisible();
    await po.sendPrompt(
      "Read the file you just created and append a second line FOLLOWUP_OK using Dyad's file tools. Do not delegate.",
      { timeout: 120_000 },
    );
    expect(
      fs.readFileSync(path.join(appPath, "subscription-smoke.txt"), "utf8"),
    ).toContain("FOLLOWUP_OK");
    expect(Number(new URL(po.page.url()).searchParams.get("id"))).toBe(chatId);
    await expect.poll(() => reports.length).toBeGreaterThan(1);
    expect(
      reports.every(
        (report) =>
          report.modelId &&
          report.modelProvider === "openai" &&
          report.totalTokens ===
            report.cachedInputTokens +
              report.uncachedInputTokens +
              report.outputTokens &&
          [
            report.totalTokens,
            report.cachedInputTokens,
            report.uncachedInputTokens,
            report.outputTokens,
          ].every((value) => Number.isInteger(value) && value >= 0),
      ),
    ).toBe(true);
    expect(new Set(reports.map((r) => r.id)).size).toBe(reports.length);
    console.log(
      `Live subscription completed: ${reports.length} usage reports, ${new Set(reports.map((r) => r.id)).size} unique report IDs (stub only).`,
    );
  } finally {
    await po.page
      .evaluate(async () => {
        await (window as any).electron.ipcRenderer.invoke(
          "codex-subscription:disconnect",
        );
      })
      .catch(() => {});
    billing.close();
  }
});
