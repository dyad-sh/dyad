import { beforeEach, describe, expect, it, vi } from "vitest";

const registeredHandlers = vi.hoisted(
  () => [] as Array<(event: any, input: any) => Promise<unknown>>,
);
const database = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));
const windows = vi.hoisted(() => ({
  ensureRegistered: vi.fn(() => "window-session"),
}));
const actors = vi.hoisted(() => ({
  acquireWindowInterest: vi.fn(),
  restoreWindowInterest: vi.fn(),
  releaseWindowInterest: vi.fn(),
}));

vi.mock("./base", () => ({
  createTypedHandler: vi.fn(
    (
      _contract: unknown,
      handler: (event: any, input: any) => Promise<unknown>,
    ) => {
      registeredHandlers.push(handler);
    },
  ),
}));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({
  apps: { id: "id" },
}));
vi.mock("@/window_infrastructure/main/window_registry", () => ({
  windowRegistry: windows,
}));
vi.mock("../services/version_preview_actor_service", () => ({
  versionPreviewActorService: actors,
}));

const { registerVersionPreviewWindowInterestHandlers } =
  await import("./version_preview_window_interest_handlers");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("version preview window interest handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.length = 0;
    registerVersionPreviewWindowInterestHandlers();
  });

  it("does not acquire interest when the sender is destroyed during app lookup", async () => {
    const lookup = deferred<{ id: number }>();
    database.findFirst.mockReturnValue(lookup.promise);
    let destroyed = false;
    const sender = {
      id: 42,
      isDestroyed: () => destroyed,
    };

    const acquire = registeredHandlers[0];
    const result = acquire({ sender }, { appId: 7 });
    expect(windows.ensureRegistered).toHaveBeenCalledWith(sender);

    destroyed = true;
    lookup.resolve({ id: 7 });
    await result;

    expect(actors.acquireWindowInterest).not.toHaveBeenCalled();
  });

  it("atomically restores interest only through the orphan recovery handler", async () => {
    database.findFirst.mockResolvedValue({ id: 7 });
    actors.restoreWindowInterest.mockReturnValue(true);
    const sender = {
      id: 42,
      isDestroyed: () => false,
    };

    await expect(
      registeredHandlers[1]({ sender }, { appId: 7 }),
    ).resolves.toEqual({ acquired: true });

    expect(windows.ensureRegistered).toHaveBeenCalledWith(sender);
    expect(actors.restoreWindowInterest).toHaveBeenCalledWith(7, 42);
    expect(actors.acquireWindowInterest).not.toHaveBeenCalled();
  });
});
