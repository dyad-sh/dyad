import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

export const VercelBlobStatusSchema = z.object({
  connected: z.boolean(),
});
export type VercelBlobStatus = z.infer<typeof VercelBlobStatusSchema>;

export const VercelBlobItemSchema = z.object({
  pathname: z.string(),
  url: z.string(),
  size: z.number(),
  uploadedAt: z.string(),
});
export type VercelBlobItem = z.infer<typeof VercelBlobItemSchema>;

export const vercelBlobContracts = {
  status: defineContract({
    channel: "vercel-blob:status",
    input: z.void(),
    output: VercelBlobStatusSchema,
  }),

  connect: defineContract({
    channel: "vercel-blob:connect",
    input: z.object({ token: z.string() }),
    output: VercelBlobStatusSchema,
  }),

  disconnect: defineContract({
    channel: "vercel-blob:disconnect",
    input: z.void(),
    output: VercelBlobStatusSchema,
  }),

  list: defineContract({
    channel: "vercel-blob:list",
    input: z.void(),
    output: z.array(VercelBlobItemSchema),
  }),

  upload: defineContract({
    channel: "vercel-blob:upload",
    input: z.object({
      pathname: z.string(),
      dataBase64: z.string(),
      contentType: z.string().optional(),
    }),
    output: z.object({ pathname: z.string(), url: z.string() }),
  }),

  createFolder: defineContract({
    channel: "vercel-blob:createFolder",
    input: z.string(), // folder path
    output: z.void(),
  }),

  renameFolder: defineContract({
    channel: "vercel-blob:renameFolder",
    input: z.object({ from: z.string(), to: z.string() }),
    output: z.void(),
  }),

  deleteFolder: defineContract({
    channel: "vercel-blob:deleteFolder",
    input: z.string(), // folder prefix
    output: z.void(),
  }),

  delete: defineContract({
    channel: "vercel-blob:delete",
    input: z.string(), // blob url
    output: z.void(),
  }),

  getDataUrl: defineContract({
    channel: "vercel-blob:getDataUrl",
    input: z.string(), // blob url
    output: z.string().nullable(),
  }),

  renameFile: defineContract({
    channel: "vercel-blob:renameFile",
    input: z.object({ fromUrl: z.string(), toPathname: z.string() }),
    output: z.object({ pathname: z.string(), url: z.string() }),
  }),
} as const;

export const vercelBlobClient = createClient(vercelBlobContracts);
