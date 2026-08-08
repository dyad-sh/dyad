import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * End-to-end check of the local RAG pipeline against the real bundled Qdrant
 * engine: start the service, create a collection, index files on disk, run a
 * semantic search, then remove the source.
 *
 * Skipped automatically when the platform-specific Qdrant binary is absent
 * (the managed engine ships for macOS only), so this stays harmless on CI
 * runners for other platforms.
 */

const architecture = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
const qdrantBinary = path.resolve(
  process.cwd(),
  "assets/qdrant",
  architecture,
  "qdrant",
);
const canRun = process.platform === "darwin" && fs.existsSync(qdrantBinary);

// Point the service at a scratch userData directory so the developer's real
// vector store is never touched.
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-vector-test-"));

vi.mock("electron", () => ({
  app: { getPath: () => scratchRoot, getAppPath: () => process.cwd() },
}));

vi.mock("../paths/paths", () => ({
  getUserDataPath: () => scratchRoot,
}));

// process_manager pulls in cloud-sandbox and DB machinery that this test does
// not exercise; only killProcess is needed.
// Mirror the real killProcess: terminate gracefully and wait for the process
// to exit. A SIGKILL here would let a restart race the storage lock the old
// Qdrant still holds, which shows up as a flaky start.
vi.mock("../ipc/utils/process_manager", () => ({
  killProcess: async (child: {
    kill: (signal?: string) => void;
    once: (event: string, listener: () => void) => void;
    exitCode: number | null;
  }) => {
    if (child.exitCode != null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  },
}));

const {
  startVectorService,
  stopVectorService,
  restartVectorService,
  getVectorServiceStatus,
} = await import("@/ipc/utils/vector_service_manager");

const {
  chunkText,
  embedLocalText,
  createVectorCollection,
  indexVectorPaths,
  searchVectorWorkspace,
  listVectorSources,
  listVectorCollections,
  removeVectorSource,
  getVectorOverview,
  createVectorBackup,
  deleteVectorCollection,
} = await import("@/ipc/utils/vector_workspace");

describe("embedLocalText", () => {
  it("produces a unit-length vector of the collection dimension", () => {
    const vector = embedLocalText("authentication middleware for the api");
    expect(vector).toHaveLength(384);
    const magnitude = Math.sqrt(
      vector.reduce((total, value) => total + value * value, 0),
    );
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("is deterministic for the same text", () => {
    expect(embedLocalText("refresh token rotation")).toEqual(
      embedLocalText("refresh token rotation"),
    );
  });

  it("scores related text above unrelated text", () => {
    const query = embedLocalText("how do we validate the session token");
    const related = embedLocalText(
      "validateSessionToken checks the session token expiry",
    );
    const unrelated = embedLocalText(
      "the dessert recipe calls for butter and sugar",
    );
    const dot = (a: number[], b: number[]) =>
      a.reduce((total, value, index) => total + value * b[index], 0);
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  });

  it("returns a zero vector for text with no usable tokens", () => {
    expect(embedLocalText("   ").every((value) => value === 0)).toBe(true);
  });
});

describe("chunkText", () => {
  it("keeps short documents in a single chunk with 1-based line numbers", () => {
    const chunks = chunkText("first line\nsecond line\nthird line");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].lineStart).toBe(1);
    expect(chunks[0].lineEnd).toBe(3);
  });

  it("splits long documents into overlapping chunks", () => {
    const document = Array.from(
      { length: 400 },
      (_, index) => `line ${index} with enough text to add up quickly`,
    ).join("\n");
    const chunks = chunkText(document);

    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: each chunk restarts before the previous one ended.
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].lineStart).toBeLessThanOrEqual(
        chunks[index - 1].lineEnd,
      );
    }
    // Full coverage, no gaps.
    expect(chunks[0].lineStart).toBe(1);
    expect(chunks.at(-1)!.lineEnd).toBe(400);
  });

  it("drops whitespace-only documents", () => {
    expect(chunkText("\n\n   \n")).toEqual([]);
  });
});

describe.skipIf(!canRun)("Qdrant-backed RAG pipeline", () => {
  const sourceDir = path.join(scratchRoot, "corpus");
  let collectionId: string;

  beforeAll(async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "auth.ts"),
      [
        "export function validateSessionToken(token: string) {",
        "  // Rejects an expired or tampered session token.",
        "  return verifySignature(token) && !isExpired(token);",
        "}",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(sourceDir, "billing.ts"),
      [
        "export function calculateInvoiceTotal(items: LineItem[]) {",
        "  // Sums line items and applies the sales tax rate.",
        "  return items.reduce((total, item) => total + item.amount, 0) * 1.1;",
        "}",
      ].join("\n"),
    );
    // A secret that must never be indexed.
    fs.writeFileSync(
      path.join(sourceDir, "server.key"),
      "PRIVATE KEY MATERIAL",
    );

    await startVectorService();
  }, 60_000);

  afterAll(async () => {
    await stopVectorService();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("starts the managed engine and reports ready", () => {
    const status = getVectorServiceStatus();
    expect(status.state).toBe("ready");
    expect(status.localOnly).toBe(true);
    expect(status.error).toBeNull();
  });

  it("creates a collection in Qdrant", async () => {
    const collection = await createVectorCollection({
      name: "Test Knowledge",
      description: "Integration test collection",
    });
    collectionId = collection.id;

    expect(collection.dimensions).toBe(384);
    expect(collection.chunkCount).toBe(0);
    expect(listVectorSources(collectionId)).toEqual([]);
  }, 30_000);

  it("indexes a directory and records chunk counts", async () => {
    const result = await indexVectorPaths(collectionId, [sourceDir]);
    expect(result.length).toBeGreaterThan(0);

    const sources = listVectorSources(collectionId);
    expect(sources).toHaveLength(1);
    expect(sources[0].status).toBe("ready");
    expect(sources[0].chunkCount).toBeGreaterThan(0);
    // The .key file is excluded, so only the two .ts files are indexed.
    expect(sources[0].fileCount).toBe(2);
  }, 60_000);

  it("retrieves the relevant chunk for a query", async () => {
    const results = await searchVectorWorkspace({
      query: "validate session token expiry",
      collectionIds: [collectionId],
      limit: 5,
      minimumScore: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourcePath).toContain("auth.ts");
    expect(results[0].content).toContain("validateSessionToken");
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].lineStart).toBeGreaterThan(0);
    // Results come back ranked.
    for (let index = 1; index < results.length; index += 1) {
      expect(results[index - 1].score).toBeGreaterThanOrEqual(
        results[index].score,
      );
    }
  }, 30_000);

  it("ranks a billing query onto the billing file", async () => {
    const results = await searchVectorWorkspace({
      query: "calculate invoice total with sales tax",
      collectionIds: [collectionId],
      limit: 5,
      minimumScore: 0,
    });
    expect(results[0].sourcePath).toContain("billing.ts");
  }, 30_000);

  it("never indexes private key material", async () => {
    const results = await searchVectorWorkspace({
      query: "PRIVATE KEY MATERIAL",
      collectionIds: [collectionId],
      limit: 10,
      minimumScore: 0,
    });
    for (const result of results) {
      expect(result.sourcePath).not.toContain("server.key");
      expect(result.content).not.toContain("PRIVATE KEY MATERIAL");
    }
  }, 30_000);

  it("honours the score threshold", async () => {
    const results = await searchVectorWorkspace({
      query: "completely unrelated gardening topic",
      collectionIds: [collectionId],
      limit: 5,
      minimumScore: 0.95,
    });
    expect(results).toHaveLength(0);
  }, 30_000);

  it("reports the workspace overview", async () => {
    const overview = await getVectorOverview();
    expect(overview.collectionCount).toBeGreaterThan(0);
    expect(overview.sourceCount).toBeGreaterThan(0);
    expect(overview.chunkCount).toBeGreaterThan(0);
    expect(overview.embeddingModel).toBeTruthy();
    expect(overview.storageBytes).toBeGreaterThan(0);
    expect(overview.status.state).toMatch(/ready|indexing/);
  }, 30_000);

  it("backs up the workspace metadata", async () => {
    const backup = createVectorBackup();
    expect(fs.existsSync(path.join(backup.path, "workspace.json"))).toBe(true);
    const overview = await getVectorOverview();
    expect(overview.lastBackupAt).toBe(backup.createdAt);
  }, 30_000);

  it("restarts the engine without losing indexed data", async () => {
    await restartVectorService();
    expect(getVectorServiceStatus().state).toBe("ready");

    const results = await searchVectorWorkspace({
      query: "validate session token expiry",
      collectionIds: [collectionId],
      limit: 5,
      minimumScore: 0,
    });
    expect(results[0].sourcePath).toContain("auth.ts");
  }, 60_000);

  it("removes a source and its points", async () => {
    const [source] = listVectorSources(collectionId);
    await removeVectorSource(collectionId, source.id);

    expect(listVectorSources(collectionId)).toHaveLength(0);
    const results = await searchVectorWorkspace({
      query: "validate session token expiry",
      collectionIds: [collectionId],
      limit: 5,
      minimumScore: 0,
    });
    expect(results).toHaveLength(0);
  }, 30_000);

  it("deletes the collection", async () => {
    await deleteVectorCollection(collectionId);
    expect(
      listVectorCollections().some((entry) => entry.id === collectionId),
    ).toBe(false);
    // The overview must survive Qdrant's background segment cleanup.
    const overview = await getVectorOverview();
    expect(overview.collectionCount).toBe(0);
  }, 30_000);
});
