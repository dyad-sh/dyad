import { describe, expect, it } from "vitest";

import {
  BLOB_VAULT_PREFIX,
  blobVaultKey,
  isExcludedFromCloud,
} from "@/ipc/utils/blob_vault";
import { VAULT_FOLDERS, vaultStarterFiles } from "@/ipc/utils/vault_structure";

describe("blobVaultKey", () => {
  it("preserves the path so a file returns to where it came from", () => {
    expect(blobVaultKey("Notes/Daily/2026-08-10.md")).toBe(
      "vault/Notes/Daily/2026-08-10.md",
    );
  });

  it("keeps everything under one prefix", () => {
    expect(blobVaultKey("a.md").startsWith(`${BLOB_VAULT_PREFIX}/`)).toBe(true);
  });

  it("does not double the separator on a leading slash", () => {
    expect(blobVaultKey("/Notes/a.md")).toBe("vault/Notes/a.md");
  });
});

describe("what must never reach the cloud", () => {
  it("excludes the vault .env", () => {
    // It holds mirrored API keys. Uploading it would take a deliberately
    // local file and put it somewhere fetchable with a token.
    expect(isExcludedFromCloud(".env")).toBe(true);
  });

  it("excludes Obsidian per-machine workspace state", () => {
    expect(isExcludedFromCloud(".obsidian/workspace.json")).toBe(true);
  });

  it("excludes git internals of mirrored projects", () => {
    expect(isExcludedFromCloud("Code/my-app/.git/objects/ab/cdef")).toBe(true);
  });

  it("excludes .DS_Store", () => {
    expect(isExcludedFromCloud("Notes/.DS_Store")).toBe(true);
  });

  it("includes ordinary vault content", () => {
    for (const keep of [
      "Vault Home.md",
      "Notes/Daily/2026-08-10.md",
      "Media/Images/Generated/a.png",
      "Documents/report.pdf",
      "Code/my-app/src/index.ts",
      ".obsidian/app.json",
    ]) {
      expect(isExcludedFromCloud(keep), keep).toBe(false);
    }
  });

  it("does not exclude a file merely for mentioning env", () => {
    expect(isExcludedFromCloud("Notes/environment setup.md")).toBe(false);
    expect(isExcludedFromCloud("Documents/.env.example")).toBe(false);
  });
});

describe("shared structure", () => {
  it("defines the folders once, for both destinations", () => {
    // Two copies of this list would drift the first time anyone added a
    // folder, and a vault would then mean different things in each place.
    expect(VAULT_FOLDERS).toContain("Conversations/Chat Agent");
    expect(VAULT_FOLDERS).toContain("Documents");
    expect(VAULT_FOLDERS).toContain("Code");
  });

  it("defines the starter files once", () => {
    const files = vaultStarterFiles();
    expect(Object.keys(files)).toContain("Vault Home.md");
    expect(Object.keys(files)).toContain(".obsidian/app.json");
  });

  it("keeps no secret in anything a fresh vault ships with", () => {
    for (const [name, contents] of Object.entries(vaultStarterFiles())) {
      expect(name).not.toBe(".env");
      expect(contents).not.toMatch(/sb_secret|sb_publishable|BLOB_READ_WRITE/);
    }
  });
});
