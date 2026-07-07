import fs from "node:fs";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import { cleanup, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

type TestApp = {
  appId: number;
  name: string;
  appDir: string;
};

function readCookieSecret(envContents: string): string | undefined {
  return envContents.match(/^NEON_AUTH_COOKIE_SECRET=(.+)$/m)?.[1]?.trim();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("Neon branch actions (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;
  let appsRoot: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      testBuild: true,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
  }, 60_000);

  afterEach(() => {
    cleanup();
    writeSettings({ neon: undefined });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createNextApp(baseName: string): Promise<TestApp> {
    appCounter += 1;
    const name = `${baseName}-${appCounter}`;
    const appDir = path.join(appsRoot, slug(name));
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify(
        {
          name,
          private: true,
          scripts: { dev: "next dev" },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0",
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(appDir, "next.config.ts"),
      "export default {};\n",
    );

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: appRow.id });
    return { appId: appRow.id, name, appDir };
  }

  async function mountNeonDetails(app: TestApp) {
    harness.mountSurface({
      route: "/app-details",
      appId: app.appId,
      search: { provider: "neon" },
      withTitleBar: true,
    });
    await screen.findByTestId("app-details-page");
    await screen.findByRole("heading", { name: app.name });
  }

  function connectNeonAccount() {
    writeSettings({
      isTestMode: true,
      neon: {
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
        expiresIn: 3600,
        tokenTimestamp: Math.floor(Date.now() / 1000),
      },
    });
  }

  async function connectNeonProject() {
    await screen.findByTestId("neon-project-select", {}, { timeout: 10_000 });
    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-project-select"),
      /^Test Project\b/i,
    );
    await screen.findByTestId("neon-branch-select", {}, { timeout: 15_000 });
    await screen.findByText("development", undefined, { timeout: 15_000 });
  }

  async function appRow(appId: number) {
    return harness.db.query.apps.findFirst({ where: eq(apps.id, appId) });
  }

  async function waitForEnv(appDir: string, expected: string): Promise<string> {
    let contents = "";
    await waitFor(
      () => {
        contents = fs.readFileSync(path.join(appDir, ".env.local"), "utf8");
        expect(contents).toContain(expected);
      },
      { timeout: 15_000 },
    );
    return contents;
  }

  it("updates Neon env vars and preserves per-branch auth secrets when switching branches", async () => {
    const app = await createNextApp("neon-branch");
    connectNeonAccount();
    await mountNeonDetails(app);

    await connectNeonProject();

    const envBeforeSwitch = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envBeforeSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envBeforeSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);

    const cookieSecretBeforeSwitch = readCookieSecret(envBeforeSwitch);
    expect(cookieSecretBeforeSwitch).toBeTruthy();

    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-branch-select"),
      /^main\b/i,
    );

    const envAfterSwitch = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "POSTGRES_URL=postgresql://test:test@test-main.neon.tech/test",
    );
    expect(envAfterSwitch).toContain(
      "NEON_AUTH_BASE_URL=https://test-main.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(envAfterSwitch).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);

    const cookieSecretAfterSwitch = readCookieSecret(envAfterSwitch);
    expect(cookieSecretAfterSwitch).toBeTruthy();
    expect(cookieSecretAfterSwitch).not.toBe(cookieSecretBeforeSwitch);

    let row = await appRow(app.appId);
    expect(row?.neonProjectId).toBe("test-project-id");
    expect(row?.neonDevelopmentBranchId).toBe("test-development-branch-id");
    expect(row?.neonActiveBranchId).toBe("test-main-branch-id");

    await harness.selectFromBaseUiSelect(
      await screen.findByTestId("neon-branch-select"),
      /^development\b/i,
    );

    const envAfterReturn = await waitForEnv(
      app.appDir,
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toContain(
      "POSTGRES_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toContain(
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
    );
    expect(readCookieSecret(envAfterReturn)).toBe(cookieSecretBeforeSwitch);

    row = await appRow(app.appId);
    expect(row?.neonActiveBranchId).toBe("test-development-branch-id");
  }, 90_000);
});
