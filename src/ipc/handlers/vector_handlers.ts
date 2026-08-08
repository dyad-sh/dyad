import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  addKnowledgeBaseDocuments,
  getDocumentsFolder,
  getKnowledgeBaseOverview,
  indexKnowledgeBase,
  removeKnowledgeBaseDocument,
  retryKnowledgeBaseDocument,
} from "../utils/knowledge_base";
import { vectorContracts } from "../types/vector";
import { createTypedHandler } from "./base";
import { safeSend } from "../utils/safe_sender";
import {
  restartVectorService,
  startVectorService,
  startVectorServiceSupervisor,
  stopVectorServiceSupervisor,
} from "../utils/vector_service_manager";
import {
  createVectorBackup,
  createVectorCollection,
  deleteVectorCollection,
  getVectorOverview,
  indexVectorPaths,
  listVectorCollections,
  listVectorSources,
  removeVectorSource,
  searchVectorWorkspace,
  updateVectorCollection,
  updateVectorSettings,
} from "../utils/vector_workspace";

const sourcePreviewWindows = new Set<BrowserWindow>();

/**
 * PDFs open in a dedicated Electron viewer so Chromium can honour #page=N.
 * Other indexed documents keep using the operating system's associated app.
 */
async function openIndexedSource(
  sourcePath: string,
  pageNumber?: number,
): Promise<boolean> {
  if (pageNumber != null && path.extname(sourcePath).toLowerCase() === ".pdf") {
    const previewWindow = new BrowserWindow({
      width: 1080,
      height: 820,
      minWidth: 720,
      minHeight: 500,
      title: `${path.basename(sourcePath)} — page ${pageNumber}`,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#101318",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true,
      },
    });
    sourcePreviewWindows.add(previewWindow);
    previewWindow.once("closed", () => {
      sourcePreviewWindows.delete(previewWindow);
    });
    previewWindow.once("ready-to-show", () => previewWindow.show());

    try {
      const fileUrl = pathToFileURL(sourcePath);
      fileUrl.hash = `page=${pageNumber}`;
      await previewWindow.loadURL(fileUrl.href);
      return true;
    } catch {
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
      // A platform without Chromium's PDF viewer still gets the original
      // document in its associated app rather than a dead citation.
    }
  }

  const error = await shell.openPath(sourcePath);
  if (!error) return true;
  shell.showItemInFolder(sourcePath);
  return true;
}

export function registerVectorHandlers(): void {
  startVectorServiceSupervisor();
  createTypedHandler(vectorContracts.getOverview, async () =>
    getVectorOverview(),
  );
  createTypedHandler(vectorContracts.start, async () => startVectorService());
  createTypedHandler(vectorContracts.restart, async () =>
    restartVectorService(),
  );
  createTypedHandler(vectorContracts.listCollections, async () =>
    listVectorCollections(),
  );
  createTypedHandler(vectorContracts.createCollection, async (_event, input) =>
    createVectorCollection(input),
  );
  createTypedHandler(vectorContracts.updateCollection, async (_event, input) =>
    updateVectorCollection(input),
  );
  createTypedHandler(
    vectorContracts.deleteCollection,
    async (_event, input) => {
      await deleteVectorCollection(input.collectionId);
      return { deleted: true };
    },
  );
  createTypedHandler(vectorContracts.chooseSources, async () => {
    const result = await dialog.showOpenDialog({
      title: "Add knowledge sources",
      buttonLabel: "Add to Vector",
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return { paths: result.canceled ? [] : result.filePaths };
  });
  createTypedHandler(vectorContracts.indexPaths, async (_event, input) =>
    indexVectorPaths(input.collectionId, input.paths),
  );
  createTypedHandler(
    vectorContracts.openSourceByName,
    async (_event, { sourceName, page: pageNumber }) => {
      // The model cites by file name, which is all it is shown. Resolve that
      // back to the indexed source so the citation can be opened, and refuse
      // anything that is not actually in the index rather than opening an
      // arbitrary path a reply happened to mention.
      const wanted = sourceName.trim().toLowerCase();
      const match = listVectorCollections()
        .flatMap((collection) => listVectorSources(collection.id))
        .find(
          (source) =>
            source.name.toLowerCase() === wanted ||
            path.basename(source.path).toLowerCase() === wanted,
        );

      if (!match || !fs.existsSync(match.path)) {
        return { opened: false, path: null };
      }
      return {
        opened: await openIndexedSource(match.path, pageNumber),
        path: match.path,
      };
    },
  );
  createTypedHandler(
    vectorContracts.openSourceLocation,
    async (_event, { collectionId, sourceId, page: pageNumber }) => {
      const match = listVectorSources(collectionId).find(
        (source) => source.id === sourceId,
      );
      if (!match || !fs.existsSync(match.path)) {
        return { opened: false, path: null };
      }
      return {
        opened: await openIndexedSource(match.path, pageNumber),
        path: match.path,
      };
    },
  );

  createTypedHandler(vectorContracts.listSources, async (_event, input) =>
    listVectorSources(input.collectionId),
  );
  createTypedHandler(vectorContracts.removeSource, async (_event, input) => {
    await removeVectorSource(input.collectionId, input.sourceId);
    return { deleted: true };
  });
  createTypedHandler(vectorContracts.search, async (_event, input) =>
    searchVectorWorkspace(input),
  );
  createTypedHandler(vectorContracts.ragQuery, async (_event, input) => {
    const overview = await getVectorOverview();
    if (input.allowCloud && !overview.settings.allowCloudRag) {
      throw new DyadError(
        "Cloud-assisted RAG is disabled in Vector privacy settings.",
        DyadErrorKind.Precondition,
      );
    }
    const results = await searchVectorWorkspace({
      query: input.query,
      collectionIds: input.collectionIds,
      limit: input.limit,
      minimumScore: overview.settings.minimumScore,
    });
    const answer =
      results.length === 0
        ? "I couldn’t find a relevant passage in the selected local knowledge."
        : [
            "Here are the most relevant passages from your local knowledge:",
            "",
            ...results
              .slice(0, 4)
              .map(
                (result, index) =>
                  `${index + 1}. ${result.content.slice(0, 700)}\n   — ${result.sourceName}${result.lineStart ? `, lines ${result.lineStart}–${result.lineEnd}` : ""}`,
              ),
          ].join("\n");
    return { answer, results, usedCloudModel: false };
  });
  createTypedHandler(vectorContracts.updateSettings, async (_event, input) =>
    updateVectorSettings(input),
  );
  createTypedHandler(vectorContracts.createBackup, async () =>
    createVectorBackup(),
  );

  createTypedHandler(vectorContracts.getKnowledgeBase, async () =>
    getKnowledgeBaseOverview(),
  );
  createTypedHandler(vectorContracts.indexKnowledgeBase, async (event) =>
    indexKnowledgeBase((progress) => {
      safeSend(event.sender, "vector:knowledge-base:import-progress", progress);
    }),
  );
  createTypedHandler(
    vectorContracts.addKnowledgeBaseDocuments,
    async (event) => {
      const result = await dialog.showOpenDialog({
        title: "Add documents to your Knowledge Base",
        buttonLabel: "Add documents",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return getKnowledgeBaseOverview();
      }
      return addKnowledgeBaseDocuments(result.filePaths, (progress) => {
        safeSend(
          event.sender,
          "vector:knowledge-base:import-progress",
          progress,
        );
      });
    },
  );
  createTypedHandler(
    vectorContracts.retryKnowledgeBaseDocument,
    async (event, input) =>
      retryKnowledgeBaseDocument(input.documentId, (progress) => {
        safeSend(
          event.sender,
          "vector:knowledge-base:import-progress",
          progress,
        );
      }),
  );
  createTypedHandler(
    vectorContracts.removeKnowledgeBaseDocument,
    async (_event, input) => removeKnowledgeBaseDocument(input),
  );
  createTypedHandler(vectorContracts.openDocumentsFolder, async () => {
    const folder = getDocumentsFolder();
    if (!folder) {
      throw new DyadError(
        "Choose a local vault folder in Storage first.",
        DyadErrorKind.Precondition,
      );
    }
    fs.mkdirSync(folder, { recursive: true });
    await shell.openPath(folder);
    return { opened: true };
  });

  app?.on?.("before-quit", () => {
    stopVectorServiceSupervisor();
  });
}
