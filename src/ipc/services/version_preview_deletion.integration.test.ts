import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActorHost } from "@/distributed_machines/actor_host";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { versionPreviewKey } from "@/version_preview/transport";
import { VersionPreviewActorService } from "./version_preview_actor_service";
import { versionPreviewDefinition } from "./version_preview_definition";

const lowLevel = vi.hoisted(() => ({
  checkoutVersion: vi.fn(),
  revertVersion: vi.fn(),
  restoreToMessage: vi.fn(),
}));
const appRun = vi.hoisted(() => ({
  executeExternalLifecycle: vi.fn(),
}));
const database = vi.hoisted(() => ({
  appPath: "",
  findFirst: vi.fn(async () => ({ id: 7, path: database.appPath })),
}));
const persistence = vi.hoisted(() => ({
  load: vi.fn((): any => ({ type: "closed" })),
  schedule: vi.fn(),
  checkpoint: vi.fn(),
  flush: vi.fn(),
  remove: vi.fn(),
  removeAll: vi.fn(),
}));

vi.mock("../handlers/version_handlers", () => ({
  versionPreviewHandlerService: lowLevel,
}));
vi.mock("./app_run_actor_service", () => ({
  appRunActorService: appRun,
}));
vi.mock("./version_preview_persistence", () => ({
  versionPreviewPersistence: persistence,
}));
vi.mock("./version_preview_presentation_service", () => ({
  versionPreviewPresentationService: {
    recordInitiator: vi.fn(),
    publishResult: vi.fn(),
    publishError: vi.fn(),
    originEndpointFor: vi.fn(),
    forget: vi.fn(),
  },
}));
vi.mock(
  "@/window_infrastructure/main/query_invalidation_bus",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/window_infrastructure/main/query_invalidation_bus")
    >()),
    queryInvalidationBus: { publish: vi.fn() },
  }),
);
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));
vi.mock("../utils/git_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/git_utils")>()),
  gitCurrentBranch: vi.fn(async () => "feature/origin"),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("version preview deletion lifecycle", () => {
  let appPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-version-delete-"));
    fs.mkdirSync(path.join(appPath, ".git"));
    database.appPath = appPath;
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it("waits for restart and the compensating return before disposal", async () => {
    const checkout = deferred<any>();
    const restart = deferred<void>();
    const returned = deferred<any>();
    lowLevel.checkoutVersion
      .mockReturnValueOnce(checkout.promise)
      .mockReturnValueOnce(returned.promise);
    appRun.executeExternalLifecycle.mockReturnValue(restart.promise);

    const host = new ActorHost({
      placement: "main",
      clock: createFakeClock(),
      ids: createSequentialIdSource(),
    });
    host.register(versionPreviewDefinition);
    const actor = host.localRef(versionPreviewDefinition, versionPreviewKey(7));
    const actors = new VersionPreviewActorService(host as never);

    actor.send({
      type: "SELECT_VERSION",
      versionId: "abc123",
      operationId: "preview-1",
    });
    await flush();
    expect(actor.getSnapshot().state.type).toBe("checking-out");

    actors.beginAppDeletion(7);
    const preparation = actors.prepareAppDeletion(7);
    let prepared = false;
    void preparation.then(() => {
      prepared = true;
    });

    checkout.resolve({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "restart",
      affectedChatId: null,
      createdChatId: null,
    });
    await flush();
    expect(prepared).toBe(false);
    expect(appRun.executeExternalLifecycle).toHaveBeenCalled();

    restart.resolve();
    await flush();
    expect(prepared).toBe(false);
    expect(lowLevel.checkoutVersion).toHaveBeenLastCalledWith({
      purpose: "return",
      appId: 7,
      branch: "feature/origin",
    });

    returned.resolve({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    await preparation;
    expect(actor.getSnapshot().state.type).toBe("closed");

    await actors.disposeApp(7);
    expect(host.peek(versionPreviewDefinition.id, versionPreviewKey(7))).toBe(
      undefined,
    );
    actors.endAppDeletion(7);
  });
});
