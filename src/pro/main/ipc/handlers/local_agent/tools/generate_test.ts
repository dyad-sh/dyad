import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import log from "electron-log";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { safeJoin } from "@/ipc/utils/path_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import { withLock, getFileWriteKey } from "@/ipc/utils/lock_utils";
import { normalizeTestPath } from "@/ipc/utils/normalize_test_path";

const logger = log.scope("generate_test");

const generateTestSchema = z.object({
  path: z
    .string()
    .describe(
      "The spec file path, under the app's tests/ folder, e.g. 'tests/signup.spec.ts'",
    ),
  content: z.string().describe("The full Playwright test file content"),
  description: z
    .string()
    .optional()
    .describe("Brief description of what the test covers"),
});

export const generateTestTool: ToolDefinition<
  z.infer<typeof generateTestSchema>
> = {
  name: "generate_test",
  description: `Generate a Playwright end-to-end test for a user flow and write it to the app's tests/ folder. The test shows up in Dyad's Tests panel where the user can run it.

Guidance for the test you write:
- Write the spec file under tests/, named after the flow (e.g. tests/signup.spec.ts).
- Import from "@playwright/test": import { test, expect } from "@playwright/test".
- Navigate with await page.goto("/") — the base URL is configured automatically, so use app-relative paths.
- Prefer role/text-based locators (getByRole, getByText, getByLabel, getByPlaceholder) over CSS/XPath — they are far more robust.
- Rely on await expect(locator)... auto-waiting; do NOT add manual sleeps or waitForTimeout.
- If an element is hard to target, add a data-testid to the component (editing the app is fine) and use getByTestId.
- Keep each test focused on one happy-path flow that the app is expected to PASS.`,
  inputSchema: generateTestSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    `Generate test ${normalizeTestPath(args.path ?? "")}`,

  buildXml: (args, isComplete) => {
    if (!args.path) return undefined;
    const testPath = normalizeTestPath(args.path);
    let xml = `<dyad-generate-test path="${escapeXmlAttr(testPath)}" description="${escapeXmlAttr(args.description ?? "")}">\n${args.content ?? ""}`;
    if (isComplete) {
      xml += "\n</dyad-generate-test>";
    }
    return xml;
  },

  execute: async (args, ctx: AgentContext) => {
    const testPath = normalizeTestPath(args.path);
    const fullFilePath = safeJoin(ctx.appPath, testPath);

    await withLock(getFileWriteKey(fullFilePath), async () => {
      const dirPath = path.dirname(fullFilePath);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(fullFilePath, args.content);
      logger.log(`Successfully wrote test file: ${fullFilePath}`);
      queueCloudSandboxSnapshotSync({
        appId: ctx.appId,
        changedPaths: [testPath],
      });
    });

    return `Successfully generated test ${testPath}. The user can run it from the Tests panel.`;
  },
};
