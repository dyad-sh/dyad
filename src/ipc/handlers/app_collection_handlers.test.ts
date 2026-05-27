import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

const mocks = vi.hoisted(() => ({
  createTypedHandler: vi.fn(),
  db: {
    transaction: vi.fn(),
  },
}));

vi.mock("@/db", () => ({
  db: mocks.db,
}));

vi.mock("./base", () => ({
  createTypedHandler: mocks.createTypedHandler,
}));

import { registerAppCollectionHandlers } from "./app_collection_handlers";

type RegisteredHandler = (event: unknown, params: any) => Promise<void> | void;

function getRegisteredHandler(channel: string): RegisteredHandler {
  const call = mocks.createTypedHandler.mock.calls.find(
    ([contract]) => contract.channel === channel,
  );
  if (!call) {
    throw new Error(`No handler registered for ${channel}`);
  }
  return call[1] as RegisteredHandler;
}

function createTx(collectionExists: boolean) {
  const selectGet = vi.fn(() => (collectionExists ? { id: 1 } : undefined));
  const updateRun = vi.fn();
  const deleteRun = vi.fn();
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: selectGet,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: updateRun,
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        run: deleteRun,
      })),
    })),
  };
  return { tx, selectGet, updateRun, deleteRun };
}

describe("registerAppCollectionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAppCollectionHandlers();
  });

  it("throws NotFound when deleting a missing collection", async () => {
    const { tx, updateRun, deleteRun } = createTx(false);
    mocks.db.transaction.mockImplementation((callback) => callback(tx));
    const handler = getRegisteredHandler("appCollections:delete");

    await expect(handler({}, 123)).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Collection not found",
    });
    expect(updateRun).not.toHaveBeenCalled();
    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("deletes an existing collection", async () => {
    const { tx, updateRun, deleteRun } = createTx(true);
    mocks.db.transaction.mockImplementation((callback) => callback(tx));
    const handler = getRegisteredHandler("appCollections:delete");

    await handler({}, 123);

    expect(updateRun).toHaveBeenCalledOnce();
    expect(deleteRun).toHaveBeenCalledOnce();
  });

  it("throws NotFound before assigning apps to a missing collection", async () => {
    const { tx, updateRun } = createTx(false);
    mocks.db.transaction.mockImplementation((callback) => callback(tx));
    const handler = getRegisteredHandler("appCollections:assignApps");

    await expect(
      handler({}, { collectionId: 123, appIds: [1, 2] }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Collection not found",
    });
    expect(updateRun).not.toHaveBeenCalled();
  });

  it("allows unassigning apps without a collection existence check", async () => {
    const { tx, updateRun } = createTx(false);
    mocks.db.transaction.mockImplementation((callback) => callback(tx));
    const handler = getRegisteredHandler("appCollections:assignApps");

    await handler({}, { collectionId: null, appIds: [1, 2] });

    expect(tx.select).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledOnce();
  });
});
