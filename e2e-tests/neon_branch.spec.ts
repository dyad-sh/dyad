import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

function readCookieSecret(envContents: string): string | undefined {
  return envContents.match(/^NEON_AUTH_COOKIE_SECRET=(.+)$/m)?.[1]?.trim();
}

testSkipIfWindows("neon branch selection updates env vars", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToHubAndSelectTemplate("Next.js Template");
  await po.chatActions.selectChatMode("build");
  await po.sendPrompt("tc=basic", { timeout: Timeout.EXTRA_LONG });
  await po.sendPrompt("tc=add-neon");

  await po.appManagement.startDatabaseIntegrationSetup("neon");
  await po.appManagement.clickConnectNeonButton();
  await po.appManagement.selectNeonProject("Test Project");

  const appPath = await po.appManagement.getCurrentAppPath();
  const envFilePath = path.join(appPath, ".env.local");

  let envBeforeSwitch = "";
  await expect(async () => {
    envBeforeSwitch = fs.readFileSync(envFilePath, "utf8");
    expect(envBeforeSwitch).toContain(
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envBeforeSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);
  }).toPass({ timeout: Timeout.MEDIUM });

  const cookieSecretBeforeSwitch = readCookieSecret(envBeforeSwitch);
  expect(cookieSecretBeforeSwitch).toBeTruthy();

  await po.appManagement.selectNeonBranch("main");

  let envAfterSwitch = "";
  await expect(async () => {
    envAfterSwitch = fs.readFileSync(envFilePath, "utf8");
    expect(envAfterSwitch).toContain(
      "DATABASE_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-main.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envAfterSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);
  }).toPass({ timeout: Timeout.MEDIUM });

  const cookieSecretAfterSwitch = readCookieSecret(envAfterSwitch);
  expect(cookieSecretAfterSwitch).toBeTruthy();
  // Each branch has its own persisted secret in the DB — switching to a
  // different branch surfaces a different secret.
  expect(cookieSecretAfterSwitch).not.toBe(cookieSecretBeforeSwitch);

  // Switching back to the original branch must return the SAME secret
  // (per-branch persistence — no rotation on switch).
  await po.appManagement.selectNeonBranch("development");

  let envAfterReturn = "";
  await expect(async () => {
    envAfterReturn = fs.readFileSync(envFilePath, "utf8");
    expect(envAfterReturn).toContain(
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);
  }).toPass({ timeout: Timeout.MEDIUM });

  const cookieSecretAfterReturn = readCookieSecret(envAfterReturn);
  expect(cookieSecretAfterReturn).toBe(cookieSecretBeforeSwitch);
});
