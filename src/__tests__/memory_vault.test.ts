import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureMemoryVault, MEMORY_FOLDERS } from "@/ipc/utils/memory_vault";

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-vault-"));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

const read = (relative: string) =>
  fs.readFileSync(path.join(vault, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(vault, relative));

describe("ensureMemoryVault", () => {
  it("creates the whole memory tree", async () => {
    await ensureMemoryVault(vault);
    for (const folder of MEMORY_FOLDERS) {
      expect(exists(folder)).toBe(true);
    }
  });

  it("creates the long-term memory files", async () => {
    await ensureMemoryVault(vault);
    for (const file of [
      "Preferences.md",
      "Goals.md",
      "Important Facts.md",
      "Decisions.md",
      "Timeline.md",
    ]) {
      expect(exists(`Memory/Long Term Memory/${file}`)).toBe(true);
    }
  });

  it("creates the system files", async () => {
    await ensureMemoryVault(vault);
    expect(exists("Memory/System/Memory Index.md")).toBe(true);
    expect(exists("Memory/System/Memory Rules.md")).toBe(true);
    expect(exists("Memory/System/Retrieval Log.md")).toBe(true);
  });

  it("creates the companion folders alongside Memory", async () => {
    await ensureMemoryVault(vault);
    for (const folder of ["Projects", "Knowledge", "Exports", "Archive"]) {
      expect(exists(folder)).toBe(true);
    }
  });

  it("never overwrites a file the user has edited", async () => {
    // The whole point of Markdown as the source of truth: the user's own words
    // must survive every future launch.
    await ensureMemoryVault(vault);
    const edited = "# Preferences\n\nI prefer local models.\n";
    fs.writeFileSync(
      path.join(vault, "Memory/Long Term Memory/Preferences.md"),
      edited,
    );

    await ensureMemoryVault(vault);

    expect(read("Memory/Long Term Memory/Preferences.md")).toBe(edited);
  });

  it("leaves unrelated files in the vault alone", async () => {
    fs.mkdirSync(path.join(vault, "My Notes"), { recursive: true });
    fs.writeFileSync(path.join(vault, "My Notes/thoughts.md"), "mine");

    await ensureMemoryVault(vault);

    expect(read("My Notes/thoughts.md")).toBe("mine");
  });

  it("fills in only what is missing on a partly-built vault", async () => {
    fs.mkdirSync(path.join(vault, "Memory/People"), { recursive: true });

    const result = await ensureMemoryVault(vault);

    expect(result.createdFolders).not.toContain("Memory/People");
    expect(result.createdFolders).toContain("Memory/Conversations");
  });

  it("reports nothing created on a second run", async () => {
    await ensureMemoryVault(vault);
    const second = await ensureMemoryVault(vault);
    expect(second.createdFolders).toEqual([]);
    expect(second.createdFiles).toEqual([]);
  });

  it("is safe to run concurrently", async () => {
    // Two launches racing must not throw or produce a half-written file.
    await Promise.all([
      ensureMemoryVault(vault),
      ensureMemoryVault(vault),
      ensureMemoryVault(vault),
    ]);
    expect(read("Memory/System/Memory Rules.md")).toContain("Privacy flags");
  });

  it("documents the privacy flags where a user will find them", async () => {
    await ensureMemoryVault(vault);
    const rules = read("Memory/System/Memory Rules.md");
    expect(rules).toContain("local_only");
    expect(rules).toContain("do_not_index");
    expect(rules).toContain("do_not_send_to_cloud");
  });
});
