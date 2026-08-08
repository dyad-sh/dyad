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
  sync: defineContract({
    channel: "storage:sync",
    input: z.object({
      preferences: StoragePreferencesSchema,
      chatAgentConversations: z.array(ChatAgentConversationSchema),
    }),
    output: StorageSyncResultSchema,
  }),
} as const;

export const storageClient = createClient(storageContracts);
