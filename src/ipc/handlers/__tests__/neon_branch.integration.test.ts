// @vitest-environment node
//
// Migrated from e2e-tests/neon_branch.spec.ts ("neon branch selection updates
// env vars").
//
// The e2e drove the NeonConnector UI (connect button, project select, branch
// select). Those controls funnel into the neon:* IPC handlers, which are
// invoked directly here (with E2E_TEST_BUILD=true so the mock Neon management
// client — the same one the Playwright suite exercised — serves projects,
// branches, connection URIs and auth base URLs).
//
// Ported behaviors:
//  - connecting a Neon project injects DATABASE_URL / POSTGRES_URL /
//    NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET into .env.local for the
//    development branch;
//  - switching the active branch to main rewrites the env vars for the main
//    branch and surfaces a DIFFERENT persisted per-branch cookie secret;
//  - switching back to development restores the SAME original secret
//    (per-branch persistence — no rotation on switch).
//
// The e2e used the Next.js template app (cookie secrets are only written for
// Next.js apps); here the minimal fixture is marked as Next.js by dropping a
// next.config.js into the checkout before connecting.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // neon_management_client / neon_context read IS_TEST_BUILD (E2E_TEST_BUILD)
  // at module load to swap in the mock Neon API client the e2e suite used.
  process.env.E2E_TEST_BUILD = "true";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerNeonHandlers } from "@/ipc/handlers/neon_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { readSettings } from "@/main/settings";

interface SentEvent {
  channel: string;
  payload: any;
}

function makeEvent(sink: SentEvent[] = []) {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) =>
        sink.push({ channel, payload }),
    },
  };
}

async function invoke(
  channel: string,
  params?: unknown,
  sink?: SentEvent[],
): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(sink), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

function readCookieSecret(envContents: string): string | undefined {
  return envContents.match(/^NEON_AUTH_COOKIE_SECRET=(.+)$/m)?.[1]?.trim();
}

describe("neon branch selection (integration)", () => {
  let harness: ChatFlowHarness;
  let envFilePath: string;

  const readEnv = () => fs.readFileSync(envFilePath, "utf8");

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    // The e2e used the Next.js template; NEON_AUTH_COOKIE_SECRET is only
    // written for Next.js apps. Mark the fixture app as Next.js.
    fs.writeFileSync(
      path.join(harness.appDir, "next.config.js"),
      "module.exports = {};\n",
    );
    registerNeonHandlers();
    envFilePath = path.join(harness.appDir, ".env.local");
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("streams the add-neon fixture through the real chat flow", async () => {
    const { result } = await harness.streamChat("tc=add-neon");
    expect(result).toBe(harness.chatId);
  }, 30_000);

  it("neon branch selection updates env vars", async () => {
    // Connect Neon (the connect button's test path) and link "Test Project".
    const deepLinkEvents: SentEvent[] = [];
    await invoke("neon:fake-connect", undefined, deepLinkEvents);
    expect(readSettings().neon?.accessToken?.value).toBe(
      "fake-neon-access-token",
    );
    expect(
      deepLinkEvents.some(
        (e) =>
          e.channel === "deep-link-received" &&
          e.payload?.type === "neon-oauth-return",
      ),
    ).toBe(true);

    const { projects } = await invoke("neon:list-projects");
    expect(projects).toEqual([
      expect.objectContaining({ id: "test-project-id", name: "Test Project" }),
    ]);

    const setResult = await invoke("neon:set-app-project", {
      appId: harness.appId,
      projectId: "test-project-id",
    });
    expect(setResult.success).toBe(true);

    // Linking picks the development branch and injects its env vars.
    const envBeforeSwitch = readEnv();
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

    const cookieSecretBeforeSwitch = readCookieSecret(envBeforeSwitch);
    expect(cookieSecretBeforeSwitch).toBeTruthy();

    // Switch the active branch to main (production).
    const switchToMain = await invoke("neon:set-active-branch", {
      appId: harness.appId,
      branchId: "test-main-branch-id",
    });
    expect(switchToMain.success).toBe(true);

    const envAfterSwitch = readEnv();
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

    const cookieSecretAfterSwitch = readCookieSecret(envAfterSwitch);
    expect(cookieSecretAfterSwitch).toBeTruthy();
    // Each branch has its own persisted secret in the DB — switching to a
    // different branch surfaces a different secret.
    expect(cookieSecretAfterSwitch).not.toBe(cookieSecretBeforeSwitch);

    // Switching back to the original branch must return the SAME secret
    // (per-branch persistence — no rotation on switch).
    const switchBack = await invoke("neon:set-active-branch", {
      appId: harness.appId,
      branchId: "test-development-branch-id",
    });
    expect(switchBack.success).toBe(true);

    const envAfterReturn = readEnv();
    expect(envAfterReturn).toContain(
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
    );
    expect(envAfterReturn).toMatch(/NEON_AUTH_COOKIE_SECRET=[a-f0-9]{64}/);

    const cookieSecretAfterReturn = readCookieSecret(envAfterReturn);
    expect(cookieSecretAfterReturn).toBe(cookieSecretBeforeSwitch);
  }, 30_000);
});
