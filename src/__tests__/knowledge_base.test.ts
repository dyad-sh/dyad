import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Knowledge Base workflow: documents dropped into the vault's Documents
 * folder are indexed into a dedicated collection, listed per document, and
 * kept in sync when files are added or removed.
 *
 * Runs against the real bundled Qdrant engine; skipped when it is absent.
 */

const architecture = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
const canRun =
  process.platform === "darwin" &&
  fs.existsSync(
    path.resolve(process.cwd(), "assets/qdrant", architecture, "qdrant"),
  );

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-kb-test-"));
const vaultPath = path.join(scratchRoot, "Vault");

vi.mock("electron", () => ({
  app: { getPath: () => scratchRoot, getAppPath: () => process.cwd() },
}));

vi.mock("../paths/paths", () => ({
  getUserDataPath: () => scratchRoot,
}));

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

// The service reads the vault location out of user settings.
vi.mock("../main/settings", () => ({
  readSettings: () => ({ storage: { localVaultPath: vaultPath } }),
  writeSettings: vi.fn(),
}));

const { stopVectorService } =
  await import("@/ipc/utils/vector_service_manager");
const { initializeLocalVault, vaultDocumentsPath } =
  await import("@/ipc/utils/storage_vault");
const {
  getDocumentsFolder,
  getKnowledgeBaseOverview,
  indexKnowledgeBase,
  addKnowledgeBaseDocuments,
  retryKnowledgeBaseDocument,
  removeKnowledgeBaseDocument,
} = await import("@/ipc/utils/knowledge_base");

describe.skipIf(!canRun)("Knowledge Base workflow", () => {
  let documentsFolder: string;

  beforeAll(async () => {
    fs.mkdirSync(vaultPath, { recursive: true });
    await initializeLocalVault(vaultPath);
    documentsFolder = vaultDocumentsPath(vaultPath);
  }, 60_000);

  afterAll(async () => {
    await stopVectorService();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("creates a Documents folder inside the vault", () => {
    expect(fs.existsSync(documentsFolder)).toBe(true);
    expect(getDocumentsFolder()).toBe(documentsFolder);
  });

  it("starts empty and reports the local embedder", async () => {
    const overview = await getKnowledgeBaseOverview();
    expect(overview.documentCount).toBe(0);
    expect(overview.documents).toEqual([]);
    expect(overview.documentsFolder).toBe(documentsFolder);
    expect(overview.embeddingModel).toBeTruthy();
    expect(overview.dimensions).toBe(384);
  }, 30_000);

  it("counts documents dropped into the folder as pending", async () => {
    fs.writeFileSync(
      path.join(documentsFolder, "handbook.md"),
      "# Onboarding handbook\n\nRequest laptop access through the IT portal.",
    );
    const overview = await getKnowledgeBaseOverview();
    expect(overview.pendingCount).toBe(1);
    expect(overview.documentCount).toBe(0);
  }, 30_000);

  it("indexes the folder and lists each document separately", async () => {
    fs.writeFileSync(
      path.join(documentsFolder, "expenses.md"),
      "# Expense policy\n\nSubmit receipts within thirty days of purchase.",
    );

    const overview = await indexKnowledgeBase();

    expect(overview.documentCount).toBe(2);
    expect(overview.pendingCount).toBe(0);
    expect(overview.chunkCount).toBeGreaterThan(0);
    expect(overview.lastIndexedAt).toBeTruthy();
    expect(overview.collectionId).toBeTruthy();

    const names = overview.documents.map((document) => document.name).sort();
    expect(names).toEqual(["expenses.md", "handbook.md"]);
    for (const document of overview.documents) {
      expect(document.status).toBe("ready");
      expect(document.chunkCount).toBeGreaterThan(0);
      expect(document.sizeBytes).toBeGreaterThan(0);
      expect(document.extension).toBe("md");
    }
  }, 60_000);

  it("makes the documents retrievable by search", async () => {
    const { searchVectorWorkspace } =
      await import("@/ipc/utils/vector_workspace");
    const overview = await getKnowledgeBaseOverview();

    const results = await searchVectorWorkspace({
      query: "submit receipts expense policy",
      collectionIds: [overview.collectionId!],
      limit: 5,
      minimumScore: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sourceName).toBe("expenses.md");
  }, 30_000);

  it("copies added documents into the vault and indexes them", async () => {
    const external = path.join(scratchRoot, "security-policy.md");
    fs.writeFileSync(
      external,
      "# Security policy\n\nRotate production credentials every ninety days.",
    );

    const overview = await addKnowledgeBaseDocuments([external]);

    expect(
      fs.existsSync(path.join(documentsFolder, "security-policy.md")),
    ).toBe(true);
    expect(overview.documentCount).toBe(3);
    expect(
      overview.documents.some(
        (document) => document.name === "security-policy.md",
      ),
    ).toBe(true);
  }, 60_000);

  it("serializes concurrent document repairs without losing either result", async () => {
    const before = await getKnowledgeBaseOverview();
    const securityPolicy = before.documents.find(
      (document) => document.name === "security-policy.md",
    )!;
    const handbook = before.documents.find(
      (document) => document.name === "handbook.md",
    )!;

    await Promise.all([
      retryKnowledgeBaseDocument(securityPolicy.id),
      retryKnowledgeBaseDocument(handbook.id),
    ]);
    const overview = await getKnowledgeBaseOverview();
    const repaired = overview.documents.filter((document) =>
      [securityPolicy.id, handbook.id].includes(document.id),
    );

    expect(repaired).toHaveLength(2);
    expect(repaired.every((document) => document.status === "ready")).toBe(
      true,
    );
    expect(repaired.every((document) => document.chunkCount > 0)).toBe(true);
  }, 60_000);

  it("re-indexing picks up edits without duplicating documents", async () => {
    fs.appendFileSync(
      path.join(documentsFolder, "handbook.md"),
      "\n\nParking passes are issued by the facilities team.",
    );

    const overview = await indexKnowledgeBase();
    expect(overview.documentCount).toBe(3);

    const handbook = overview.documents.filter(
      (document) => document.name === "handbook.md",
    );
    expect(handbook).toHaveLength(1);

    const { searchVectorWorkspace } =
      await import("@/ipc/utils/vector_workspace");
    const results = await searchVectorWorkspace({
      query: "parking passes facilities team",
      collectionIds: [overview.collectionId!],
      limit: 5,
      minimumScore: 0,
    });
    expect(results[0].sourceName).toBe("handbook.md");
  }, 60_000);

  it("drops documents deleted from the folder on the next index", async () => {
    fs.unlinkSync(path.join(documentsFolder, "expenses.md"));

    const overview = await indexKnowledgeBase();
    expect(overview.documentCount).toBe(2);
    expect(
      overview.documents.some((document) => document.name === "expenses.md"),
    ).toBe(false);
  }, 60_000);

  it("removes a document from the index but leaves the file in place", async () => {
    const before = await getKnowledgeBaseOverview();
    const target = before.documents.find(
      (document) => document.name === "handbook.md",
    )!;

    const overview = await removeKnowledgeBaseDocument({
      documentId: target.id,
      deleteFile: false,
    });

    expect(
      overview.documents.some((document) => document.name === "handbook.md"),
    ).toBe(false);
    // File is still on disk, so it shows up as pending again.
    expect(fs.existsSync(path.join(documentsFolder, "handbook.md"))).toBe(true);
    expect(overview.pendingCount).toBe(1);
  }, 60_000);

  it("deletes the file when asked", async () => {
    const before = await getKnowledgeBaseOverview();
    const target = before.documents[0];

    await removeKnowledgeBaseDocument({
      documentId: target.id,
      deleteFile: true,
    });

    expect(fs.existsSync(target.path)).toBe(false);
  }, 60_000);
});
