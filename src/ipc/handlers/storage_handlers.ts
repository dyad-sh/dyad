import fs from "node:fs";
import nodePath from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings, writeSettings } from "@/main/settings";
import { createTypedHandler } from "./base";
import { storageContracts } from "../types/storage";
import { isBlobConnected } from "../utils/vercel_blob";
import {
  initializeLocalVault,
  isLocalVaultReady,
  syncVault,
} from "../utils/storage_vault";
import {
  restoreSecretsFromVault,
  syncSecretsToVault,
} from "../utils/vault_secrets_sync";

export function registerStorageHandlers() {
  createTypedHandler(storageContracts.chooseVault, async () => {
    const parent = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: "Choose Local Vault",
      buttonLabel: "Use as Vault",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });

  createTypedHandler(storageContracts.createVault, async () => {
    const parent = BrowserWindow.getFocusedWindow();
    const options: SaveDialogOptions = {
      title: "Create Local Vault",
      buttonLabel: "Create Vault",
      // Save dialog lets the user name a new folder anywhere they like.
      defaultPath: nodePath.join(app.getPath("documents"), "Meta Human Vault"),
      nameFieldLabel: "Vault name:",
      properties: ["createDirectory"],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { path: null };
    }

    // Refuse to scaffold into a folder that already holds unrelated files, so
    // an accidental pick of e.g. Documents cannot litter it.
    if (fs.existsSync(result.filePath)) {
      const existing = fs
        .readdirSync(result.filePath)
        .filter((entry) => !entry.startsWith("."));
      const looksLikeVault = existing.includes("Vault Home.md");
      if (existing.length > 0 && !looksLikeVault) {
        throw new DyadError(
          "That folder already has files in it. Choose an empty folder or a new name for the vault.",
          DyadErrorKind.Validation,
        );
      }
    }

    await fs.promises.mkdir(result.filePath, { recursive: true });
    await initializeLocalVault(result.filePath);
    return { path: result.filePath };
  });

  createTypedHandler(storageContracts.initializeVault, async (_, { path }) => {
    await initializeLocalVault(path);
    // Selecting a vault that already carries keys should bring them back, and
    // a fresh one should receive whatever this install already has.
    await restoreSecretsFromVault();
    await syncSecretsToVault(readSettings());
    return { ready: true };
  });

  createTypedHandler(storageContracts.openVault, async (_, { path }) => {
    if (!isLocalVaultReady(path)) {
      throw new DyadError(
        "The local vault folder is not available.",
        DyadErrorKind.NotFound,
      );
    }
    const error = await shell.openPath(path);
    if (error) {
      throw new DyadError(error, DyadErrorKind.External);
    }
  });

  createTypedHandler(
    storageContracts.status,
    async (_, { localVaultPath }) => ({
      localVaultReady: isLocalVaultReady(localVaultPath),
      cloudConnected: isBlobConnected(),
      lastSyncedAt: readSettings().storage?.lastSyncedAt,
    }),
  );

  createTypedHandler(storageContracts.sync, async (_, input) => {
    if (input.preferences.destination === "cloud" && !isBlobConnected()) {
      throw new DyadError(
        "Connect Vercel Blob before syncing to cloud storage.",
        DyadErrorKind.Precondition,
      );
    }
    const counts = await syncVault(input);
    const syncedAt = Date.now();
    const current = readSettings();
    writeSettings({
      storage: {
        ...current.storage,
        ...input.preferences,
        lastSyncedAt: syncedAt,
      },
    });
    return { destination: input.preferences.destination, ...counts, syncedAt };
  });
}
