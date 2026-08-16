/**
 * What a vault is made of.
 *
 * Its own module because two writers need it: the local one on disk and the
 * cloud one in blob storage. If either owned the definition the other would
 * have to import it, and a vault would end up importing its own backup.
 */

import { CODE_FOLDER_README } from "./vault_code";

/** Everything generated lands here, so it is never scattered across folders. */
export const GENERATED_MEDIA_FOLDER = "Generated";

/**
 * The vault's shape, in one place.
 *
 * Exported because cloud storage scaffolds the same structure. Two copies of
 * this list would drift the first time somebody added a folder, and then a
 * vault would mean one thing locally and another in the cloud.
 */
export const VAULT_FOLDERS: readonly string[] = [
  ".obsidian",
  ".meta-human",
  "Conversations/Apps",
  "Conversations/Chat Agent",
  "Conversations/Hermes Agents",
  "Notes/Apps",
  "Notes/Daily",
  "Notes/Vault",
  "Media/Images",
  // Everything the app generates lands here, so images are never scattered
  // across app-private folders.
  `Media/Images/${GENERATED_MEDIA_FOLDER}`,
  "Media/Videos",
  `Media/Videos/${GENERATED_MEDIA_FOLDER}`,
  "Media/Files",
  "Notes/Generated Media",
  "Attachments",
  // Drop documents here to have them indexed into the Knowledge Base.
  "Documents",
  // Mirrors of coder projects, restored automatically when reopening an
  // app whose working copy is missing.
  "Code",
];

/**
 * Files a fresh vault starts with, keyed by relative path.
 *
 * Exported alongside VAULT_FOLDERS so cloud storage can lay down an identical
 * vault rather than an approximation of one.
 */
export function vaultStarterFiles(): Record<string, string> {
  return {
    ".obsidian/app.json": JSON.stringify(
      {
        attachmentFolderPath: "Attachments",
        newLinkFormat: "shortest",
        useMarkdownLinks: false,
      },
      null,
      2,
    ),
    "Vault Home.md":
      "---\ntype: vault-home\ntags:\n  - meta-human\n---\n\n# Meta Human Vault\n\nThis is an ordinary Obsidian vault. Meta Human automatically keeps conversations, generated media and system notes organised here while preserving notes you create yourself.\n\n- [[Conversations]]\n- [[Notes]]\n- [[Media]]\n- [[Documents]]\n\n> [!info] Your files stay portable\n> Every note is Markdown and every attachment is stored as a normal file.\n",
    "Conversations.md":
      "# Conversations\n\nConversation links appear here automatically after the first sync.\n",
    "Notes.md":
      "# Notes\n\n- [[Notes/System Notes|System Notes]]\n- `Notes/Vault` contains notes created in Notes Vault.\n- `Notes/Apps` contains durable context for each app.\n- `Notes/Daily` is yours for daily notes.\n",
    "Documents.md":
      "---\ntype: documents-index\ntags:\n  - meta-human\n  - knowledge-base\n---\n\n# Documents\n\nDrop documents in the `Documents` folder to add them to your Knowledge Base. Choose **Index now** on the Knowledge Base screen and every file here becomes searchable by your agents.\n\nDocuments you attach in chat are filed here automatically once read, together with a `.md` of their extracted text — that sidecar is what the embedder indexes, since the vector store reads text rather than PDF bytes.\n\nMarkdown, text, code and data files are indexed. Private keys and certificates are skipped.\n",
    "Media.md":
      "---\ntype: media-index\ntags:\n  - meta-human\n---\n\n# Media\n\nEverything the app produces or saves lives here and can be embedded in any note with Obsidian links.\n\n- `Media/Images/Generated` — images created by your agents\n- `Media/Images` — images you add yourself\n- `Media/Videos/Generated` — generated video\n- `Media/Files` — other attachments\n\nEach generated image also gets a note in `Notes/Generated Media` recording its prompt and model.\n",
    "Code.md": CODE_FOLDER_README,
  };
}
