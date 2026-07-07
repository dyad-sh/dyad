// @vitest-environment node
//
// Migrated from e2e-tests/env_var.spec.ts.
//
// The e2e test drove the "Configure" panel UI to create/edit/delete app
// environment variables and snapshotted the app's `.env.local` file after each
// step. The UI reads the current vars via `get-app-env-vars` and writes the
// full list back via `set-app-env-vars`; here we exercise those real handlers
// directly and assert the exact `.env.local` contents (same expected values as
// the old e2e snapshots: create-aKey, create-bKey, edit-bKey, delete-aKey).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
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
import { registerAppEnvVarsHandlers } from "@/ipc/handlers/app_env_vars_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import type { EnvVar } from "@/ipc/types";

describe("env var (integration)", () => {
  let harness: ChatFlowHarness;

  const getEnvVars = async (): Promise<EnvVar[]> => {
    const handler = getRegisteredHandlerForTesting("get-app-env-vars");
    return (await handler({} as any, { appId: harness.appId })) as EnvVar[];
  };

  const setEnvVars = async (envVars: EnvVar[]): Promise<void> => {
    const handler = getRegisteredHandlerForTesting("set-app-env-vars");
    await handler({} as any, { appId: harness.appId, envVars });
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerAppEnvVarsHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("returns an empty list when no .env.local exists", async () => {
    expect(harness.appFileExists(".env.local")).toBe(false);
    expect(await getEnvVars()).toEqual([]);
  });

  it("creates the first env var (create-aKey)", async () => {
    await setEnvVars([{ key: "aKey", value: "aValue" }]);

    expect(harness.readAppFile(".env.local")).toBe("aKey=aValue");
    expect(await getEnvVars()).toEqual([{ key: "aKey", value: "aValue" }]);
  });

  it("creates a second env var (create-bKey)", async () => {
    const current = await getEnvVars();
    await setEnvVars([...current, { key: "bKey", value: "bValue" }]);

    expect(harness.readAppFile(".env.local")).toBe("aKey=aValue\nbKey=bValue");
  });

  it("edits an env var (edit-bKey)", async () => {
    const current = await getEnvVars();
    const updated = current.map((envVar) =>
      envVar.key === "bKey" ? { ...envVar, value: "bValue2" } : envVar,
    );
    await setEnvVars(updated);

    expect(harness.readAppFile(".env.local")).toBe("aKey=aValue\nbKey=bValue2");
  });

  it("deletes an env var (delete-aKey)", async () => {
    const current = await getEnvVars();
    await setEnvVars(current.filter((envVar) => envVar.key !== "aKey"));

    expect(harness.readAppFile(".env.local")).toBe("bKey=bValue2");
    expect(await getEnvVars()).toEqual([{ key: "bKey", value: "bValue2" }]);
  });
});
