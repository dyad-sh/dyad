import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

function buildLargeLog(): Buffer {
  const lines = Array.from(
    { length: 6_000 },
    (_, index) =>
      `line-${index.toString().padStart(4, "0")} DYAD_LARGE_ATTACHMENT_MARKER payload ${"x".repeat(80)}`,
  );
  lines.push("TAIL_SENTINEL_98765");
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

testSkipIfWindows(
  "local-agent - mustardscript reads large attachment",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.page.evaluate(async () => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        experiments: { enableSandboxScriptExecution: true },
      });
      await (window as any).electron.ipcRenderer.invoke(
        "agent-tool:set-consent",
        {
          toolName: "execute_sandbox_script",
          consent: "always",
        },
      );
    });

    await po.chatActions
      .getChatInputContainer()
      .getByTestId("auxiliary-actions-menu")
      .click();
    await po.page.getByRole("menuitem", { name: "Attach files" }).click();

    const chatContextItem = po.page.getByText("Attach file as chat context");
    await expect(chatContextItem).toBeVisible();

    const fileChooserPromise = po.page.waitForEvent("filechooser");
    await chatContextItem.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "large-log.txt",
      mimeType: "text/plain",
      buffer: buildLargeLog(),
    });

    await expect(po.page.getByText("large-log.txt")).toBeVisible();

    await po.sendPrompt("tc=local-agent/large-attachment-sandbox");

    const scriptCard = po.page.getByTestId("dyad-script-card");
    await expect(scriptCard).toBeVisible();
    await expect(scriptCard).toContainText("Summarize large-log.txt");
    await scriptCard.click();
    await expect(scriptCard).toContainText('"markerCount": 6000');
    await expect(scriptCard).toContainText('"hasTail": true');
    await expect(
      po.page.getByText("Your model did not reference the attached file"),
    ).not.toBeVisible();

    const appPath = await po.appManagement.getCurrentAppPath();
    const manifestPath = path.join(
      appPath,
      ".dyad",
      "media",
      "attachments-manifest.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalName: "large-log.txt",
          originalName: "large-log.txt",
          mimeType: "text/plain",
        }),
      ]),
    );
  },
);
