import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for projects.
 *
 * A project is a named working context with standing instructions. Those
 * instructions reach the model, so they are stored and returned as plain text
 * the user wrote and can read back: nothing here is a credential, and nothing
 * is generated on the user's behalf.
 */

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Project = z.infer<typeof ProjectSchema>;

const ProjectInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  instructions: z.string().max(20_000).optional(),
});

export const ProjectFileSchema = z.object({
  name: z.string(),
  /** Project-relative, forward slashes. */
  path: z.string(),
  kind: z.enum(["directory", "file"]),
  sizeBytes: z.number().nullable(),
  modifiedAt: z.number().nullable(),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(ProjectFileSchema),
});

/** A conversation stored in a project, as listed. */
export const ProjectConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
  messageCount: z.number(),
});

export type ProjectConversation = z.infer<typeof ProjectConversationSchema>;

const StoredMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const projectContracts = {
  list: defineContract({
    channel: "project:list",
    input: z.void(),
    output: z.array(ProjectSchema),
  }),
  create: defineContract({
    channel: "project:create",
    input: ProjectInputSchema,
    output: ProjectSchema,
  }),
  update: defineContract({
    channel: "project:update",
    input: ProjectInputSchema.partial().extend({ id: z.string() }),
    output: ProjectSchema,
  }),
  delete: defineContract({
    channel: "project:delete",
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),

  /** One folder of a project's files. */
  listFiles: defineContract({
    channel: "project:list-files",
    input: z.object({ id: z.string(), path: z.string().default("") }),
    output: ProjectListingSchema,
  }),
  /** Copy files chosen from this machine into the project. */
  addFiles: defineContract({
    channel: "project:add-files",
    input: z.object({ id: z.string(), path: z.string().default("") }),
    output: z.object({ added: z.array(z.string()) }),
  }),
  createFolder: defineContract({
    channel: "project:create-folder",
    input: z.object({
      id: z.string(),
      path: z.string().default(""),
      name: z.string().min(1),
    }),
    output: z.void(),
  }),
  deleteFile: defineContract({
    channel: "project:delete-file",
    input: z.object({ id: z.string(), path: z.string().min(1) }),
    output: z.void(),
  }),
  /** Record a conversation in the project, or update the one already there. */
  saveConversation: defineContract({
    channel: "project:save-conversation",
    input: z.object({
      projectId: z.string(),
      conversationId: z.string(),
      title: z.string(),
      updatedAt: z.number(),
      messages: z.array(StoredMessageSchema),
    }),
    output: z.void(),
  }),
  /** Conversations recorded in a project, newest first. */
  listConversations: defineContract({
    channel: "project:list-conversations",
    input: z.object({ projectId: z.string() }),
    output: z.array(ProjectConversationSchema),
  }),
  /** One recorded conversation, with its messages, to continue it. */
  getConversation: defineContract({
    channel: "project:get-conversation",
    input: z.object({ projectId: z.string(), conversationId: z.string() }),
    output: z.object({
      id: z.string(),
      title: z.string(),
      updatedAt: z.number(),
      messages: z.array(StoredMessageSchema),
    }),
  }),
  deleteConversation: defineContract({
    channel: "project:delete-conversation",
    input: z.object({ projectId: z.string(), conversationId: z.string() }),
    output: z.void(),
  }),

  /** Show a project file in the system file browser. */
  revealFile: defineContract({
    channel: "project:reveal-file",
    input: z.object({ id: z.string(), path: z.string().default("") }),
    output: z.void(),
  }),
} as const;

export const projectClient = createClient(projectContracts);
