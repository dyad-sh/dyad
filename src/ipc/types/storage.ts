import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

const StoragePreferencesSchema = z.object({
  destination: z.enum(["local", "cloud"]),
  localVaultPath: z.string().optional(),
  autoSync: z.boolean(),
  syncConversations: z.boolean(),
  syncGeneratedMedia: z.boolean(),
  syncSystemNotes: z.boolean(),
});

const ChatAgentConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  updatedAt: z.number(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    }),
  ),
});

export const VaultNoteSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(500),
  body: z.string().max(1_000_000),
  pinned: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type VaultNote = z.infer<typeof VaultNoteSchema>;

export const StorageStatusSchema = z.object({
  localVaultReady: z.boolean(),
  cloudConnected: z.boolean(),
  lastSyncedAt: z.number().optional(),
});

export const StorageSyncResultSchema = z.object({
  destination: z.enum(["local", "cloud"]),
  conversations: z.number(),
  notes: z.number(),
  media: z.number(),
  syncedAt: z.number(),
});

export const VaultEntrySchema = z.object({
  name: z.string(),
  /** Vault-relative, forward slashes, so the renderer can ask for it back. */
  path: z.string(),
  kind: z.enum(["directory", "file"]),
  /** Null for directories, where a size would be misleading. */
  sizeBytes: z.number().nullable(),
  modifiedAt: z.number().nullable(),
});

export const VaultListingSchema = z.object({
  /** Null when no vault is connected, which the page shows rather than fails. */
  vaultPath: z.string().nullable(),
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(VaultEntrySchema),
});

export const storageContracts = {
  chooseVault: defineContract({
    channel: "storage:choose-vault",
    input: z.void(),
    output: z.object({ path: z.string().nullable() }),
  }),
  /** Create a brand-new vault folder on this machine, fully scaffolded. */
  createVault: defineContract({
    channel: "storage:create-vault",
    input: z.void(),
    output: z.object({ path: z.string().nullable() }),
  }),
  initializeVault: defineContract({
    channel: "storage:initialize-vault",
    input: z.object({ path: z.string() }),
    output: z.object({ ready: z.boolean() }),
  }),
  openVault: defineContract({
    channel: "storage:open-vault",
    input: z.object({ path: z.string() }),
    output: z.void(),
  }),
  status: defineContract({
    channel: "storage:status",
    input: z.object({ localVaultPath: z.string().optional() }),
    output: StorageStatusSchema,
  }),
  /** One folder of the connected local vault. Read only. */
  listVaultDirectory: defineContract({
    channel: "storage:list-vault-directory",
    input: z.object({ path: z.string().default("") }),
    output: VaultListingSchema,
  }),
  /** Show a vault file or folder in the system file browser. */
  revealVaultEntry: defineContract({
    channel: "storage:reveal-vault-entry",
    input: z.object({ path: z.string() }),
    output: z.void(),
  }),
  sync: defineContract({
    channel: "storage:sync",
    input: z.object({
      preferences: StoragePreferencesSchema,
      chatAgentConversations: z.array(ChatAgentConversationSchema),
    }),
    output: StorageSyncResultSchema,
  }),
  syncVaultNotes: defineContract({
    channel: "storage:sync-vault-notes",
    input: z.object({ notes: z.array(VaultNoteSchema).max(10_000) }),
    output: z.object({
      destination: z.enum(["local", "cloud", "cache"]),
      files: z.number(),
      syncedAt: z.number().nullable(),
      location: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  }),
  deleteConversation: defineContract({
    channel: "storage:delete-conversation",
    input: z.object({ conversationId: z.string().min(1).max(200) }),
    output: z.object({ deletedFiles: z.number().int().nonnegative() }),
  }),
  listConversations: defineContract({
    channel: "storage:list-conversations",
    input: z.void(),
    output: z.array(ChatAgentConversationSchema),
  }),
} as const;

export const storageClient = createClient(storageContracts);
