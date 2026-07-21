import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

async function writeAppFile(
  appPath: string,
  relativePath: string,
  contents: string,
) {
  const filePath = path.join(appPath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

test("local-agent deploys affected Supabase functions using packaged dependency analysis", async ({
  po,
}) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.appManagement.ensurePnpmInstall();

  const appPath = await po.appManagement.getCurrentAppPath();
  await writeAppFile(
    appPath,
    "supabase/functions/_shared/message.ts",
    'export const message = "initial";\n',
  );
  await writeAppFile(
    appPath,
    "supabase/functions/_shared/config.json",
    '{"version":1}\n',
  );
  await writeAppFile(
    appPath,
    "supabase/functions/alpha/index.ts",
    `import { message } from "../_shared/message.ts";

Deno.serve(() => new Response(message));
`,
  );
  await writeAppFile(
    appPath,
    "supabase/functions/beta/index.ts",
    'Deno.serve(() => new Response("beta"));\n',
  );
  await po.appManagement.configureGitUser();
  execFileSync("git", ["add", "--", "supabase/functions"], { cwd: appPath });
  execFileSync(
    "git",
    ["commit", "-m", "Add Supabase dependency analysis fixtures"],
    { cwd: appPath },
  );

  await po.appManagement.startDatabaseIntegrationSetup("supabase");
  await po.appManagement.clickConnectSupabaseButton();
  await expect(po.page.getByText("Fake Supabase Project")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await po.navigation.clickBackButton();
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/supabase-dependency-fine-grained", {
    skipWaitForCompletion: true,
  });
  await po.chatActions.waitForChatCompletion();
  await expect(
    po.page.getByText("Supabase functions deployed: 1/1 complete").last(),
  ).toBeVisible({ timeout: Timeout.LONG });

  await po.sendPrompt("tc=local-agent/supabase-dependency-all", {
    skipWaitForCompletion: true,
  });
  await po.chatActions.waitForChatCompletion();
  await expect(
    po.page.getByText("Supabase functions deployed: 2/2 complete").last(),
  ).toBeVisible({ timeout: Timeout.LONG });
});
