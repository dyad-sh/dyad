import { z } from "zod";

// Only http entries are supported. The transport literal makes any
// other transport fail per-entry validation and drop out, so the
// catalog can serve entry kinds this client doesn't know about yet.
//
// Kept dependency-free (zod only) so the contract in mcp.ts can import
// it without pulling the main-process catalog client into the renderer
// bundle.
export const McpCatalogEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  // Surfaced in a Featured section as well as its category.
  featured: z.boolean().optional(),
  transport: z.literal("http"),
  url: z
    .string()
    .url()
    // Case-insensitive so mixed-case schemes like HTTPS:// pass too.
    .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)"),
  // Absent means no OAuth. When present, `required` distinguishes a
  // must-connect server from one that also works anonymously.
  oauth: z
    .object({
      required: z.boolean(),
      scope: z.string().min(1).optional(),
    })
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type McpCatalogEntry = z.infer<typeof McpCatalogEntrySchema>;
