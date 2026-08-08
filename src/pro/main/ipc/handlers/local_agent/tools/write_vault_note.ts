import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeJoin } from "@/ipc/utils/path_utils";
import { initializeLocalVault } from "@/ipc/utils/storage_vault";
import { readSettings } from "@/main/settings";
import type { AgentContext, ToolDefinition } from "./types";

const writeVaultNoteSchema = z.object({
  title: z.string().min(1).max(120).describe("Human-readable note title"),
  content: z.string().describe("Markdown note content"),
  folder: z
    .string()
    .max(120)
    .optional()
    .describe("Optional subfolder below Notes/Agent Notes"),
});

function safeNoteName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 120) || "Untitled"
  );
}

export const writeVaultNoteTool: ToolDefinition<
  z.infer<typeof writeVaultNoteSchema>
> = {
  name: "write_vault_note",
  description:
    "Create or update an Obsidian Markdown note in the configured Local Vault",
  inputSchema: writeVaultNoteSchema,
  defaultConsent: "ask",
  modifiesState: true,
  isEnabled: () => {
    const storage = readSettings().storage;
    return (
      storage?.destination === "local" &&
      Boolean(storage.localVaultPath?.trim())
    );
  },
  getConsentPreview: ({ title, folder }) =>
    `Write vault note ${folder ? `${folder}/` : ""}${title}.md`,
  execute: async ({ title, content, folder }, _ctx: AgentContext) => {
    const storage = readSettings().storage;
    if (storage?.destination !== "local" || !storage.localVaultPath?.trim()) {
      throw new DyadError(
        "Select a Local Vault in Settings before writing vault notes.",
        DyadErrorKind.Precondition,
      );
    }
    const root = await initializeLocalVault(storage.localVaultPath);
    const notesRoot = path.join(root, "Notes", "Agent Notes");
    const relativeFolder = folder
      ? folder
          .split(/[\\/]+/)
          .map(safeNoteName)
          .filter(Boolean)
          .join(path.sep)
      : "";
    const destination = safeJoin(
      notesRoot,
      relativeFolder,
      `${safeNoteName(title)}.md`,
    );
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(
      destination,
      `---\ntype: agent-note\nupdated: ${new Date().toISOString()}\ntags:\n  - meta-human\n  - agent-note\n---\n\n# ${title.trim()}\n\n${content.trim()}\n`,
      "utf8",
    );
    return `Saved Obsidian note ${path.relative(root, destination)}`;
  },
};
