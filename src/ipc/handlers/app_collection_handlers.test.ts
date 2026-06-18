import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DyadErrorKind } from "@/errors/dyad_error";
import { apps, appCollections } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { registerAppCollectionHandlers } from "./app_collection_handlers";

describe("registerAppCollectionHandlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    harness = setupHandlerTestHarness();
    registerAppCollectionHandlers();
  });

  afterEach(() => {
    harness.dispose();
  });

  function seedApp(name: string, collectionId?: number): number {
    const result = harness.db
      .insert(apps)
      .values({ name, path: name, collectionId })
      .run();
    return Number(result.lastInsertRowid);
  }

  function seedCollection(name: string): number {
    const result = harness.db.insert(appCollections).values({ name }).run();
    return Number(result.lastInsertRowid);
  }

  it("creates a collection and assigns apps to it", async () => {
    const appId = seedApp("app-1");

    const created = await harness.invokeHandler<{
      id: number;
      name: string;
      appIds: number[];
    }>("appCollections:create", { name: " My Apps ", appIds: [appId] });

    expect(created.name).toBe("My Apps");
    expect(created.appIds).toEqual([appId]);
    const appRow = harness.db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .get();
    expect(appRow?.collectionId).toBe(created.id);
  });

  it("rejects duplicate collection names with Conflict", async () => {
    seedCollection("My Apps");

    await expect(
      harness.invokeHandler("appCollections:create", {
        name: "My Apps",
        appIds: [],
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Conflict,
      message: "A collection with that name already exists",
    });
  });

  it("lists collections with their member app ids", async () => {
    const collectionId = seedCollection("My Apps");
    const appId = seedApp("app-1", collectionId);
    seedApp("app-2");

    const collections = await harness.invokeHandler<
      Array<{ id: number; appIds: number[] }>
    >("appCollections:list");

    expect(collections).toHaveLength(1);
    expect(collections[0].id).toBe(collectionId);
    expect(collections[0].appIds).toEqual([appId]);
  });

  it("updates membership, adding and removing apps", async () => {
    const collectionId = seedCollection("My Apps");
    const keptAppId = seedApp("kept", collectionId);
    const removedAppId = seedApp("removed", collectionId);
    const addedAppId = seedApp("added");

    await harness.invokeHandler("appCollections:update", {
      id: collectionId,
      name: "Renamed",
      appIds: [keptAppId, addedAppId],
    });

    const rows = harness.db.select().from(apps).all();
    const byId = new Map(rows.map((r) => [r.id, r.collectionId]));
    expect(byId.get(keptAppId)).toBe(collectionId);
    expect(byId.get(addedAppId)).toBe(collectionId);
    expect(byId.get(removedAppId)).toBeNull();
    const collection = harness.db
      .select()
      .from(appCollections)
      .where(eq(appCollections.id, collectionId))
      .get();
    expect(collection?.name).toBe("Renamed");
  });

  it("throws NotFound when deleting a missing collection", async () => {
    await expect(
      harness.invokeHandler("appCollections:delete", 123),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Collection not found",
    });
  });

  it("deletes an existing collection and unassigns its apps", async () => {
    const collectionId = seedCollection("My Apps");
    const appId = seedApp("app-1", collectionId);

    await harness.invokeHandler("appCollections:delete", collectionId);

    const collection = harness.db
      .select()
      .from(appCollections)
      .where(eq(appCollections.id, collectionId))
      .get();
    expect(collection).toBeUndefined();
    const appRow = harness.db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .get();
    expect(appRow?.collectionId).toBeNull();
  });

  it("throws NotFound before assigning apps to a missing collection", async () => {
    const appId = seedApp("app-1");

    await expect(
      harness.invokeHandler("appCollections:assignApps", {
        collectionId: 123,
        appIds: [appId],
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.NotFound,
      message: "Collection not found",
    });
    const appRow = harness.db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .get();
    expect(appRow?.collectionId).toBeNull();
  });

  it("allows unassigning apps without a collection existence check", async () => {
    const collectionId = seedCollection("My Apps");
    const appId = seedApp("app-1", collectionId);

    await harness.invokeHandler("appCollections:assignApps", {
      collectionId: null,
      appIds: [appId],
    });

    const appRow = harness.db
      .select()
      .from(apps)
      .where(eq(apps.id, appId))
      .get();
    expect(appRow?.collectionId).toBeNull();
  });
});
