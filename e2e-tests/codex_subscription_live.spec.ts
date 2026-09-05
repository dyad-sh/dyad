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
    () => process.env.DYAD_ENGINE_URL!,
  );
  const reports: Array<{
    id: string;
    model: string;
    tokens: Record<string, number>;
  }> = [];
  const receipts = new Map<string, number>();
  const billing = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (req.url === "/track-usage") {
      const report = JSON.parse(body.toString());
      reports.push(report);
      // Contract receipt only: this is NOT a real engine charge.
      receipts.set(report.id, receipts.get(report.id) ?? 0.001);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ id: report.id, chargedUsd: receipts.get(report.id) }),
      );
      return;
    }
    const response = await fetch(`${previousEngine}${req.url}`, {
      method: req.method,
      ...(body.length ? { body } : {}),
      headers: { "Content-Type": "application/json" },
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
    await po.page.reload();
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
          report.model &&
          Object.values(report.tokens).every(
            (value) => Number.isInteger(value) && value >= 0,
          ),
      ),
    ).toBe(true);
    console.log(
      `Live subscription completed: ${reports.length} usage reports, ${receipts.size} unique billing receipts (stub only).`,
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
