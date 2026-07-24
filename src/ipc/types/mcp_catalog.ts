import { z } from "zod";

// Http and stdio entries are supported. The transport discriminator
// makes any other entry kind fail per-entry validation and drop out,
// so the catalog can serve entry kinds this client doesn't know about
// yet.
//
// Kept dependency-free (zod only) so the contract in mcp.ts can import
// it without pulling the main-process catalog client into the renderer
// bundle.

// A value the user must supply during setup. `kind` selects the input to
// render and where the value is stored. Discriminated union: an unknown
// kind fails validation and drops the whole entry, so newer field kinds
// don't break this client.
export const CatalogInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("oauthClientId") }),
  z.object({ kind: z.literal("oauthClientSecret") }),
  z.object({
    kind: z.literal("header"),
    name: z.string().min(1),
    prefix: z.string().optional(),
    label: z.string().min(1),
  }),
  z.object({
    kind: z.literal("env"),
    name: z.string().min(1),
    label: z.string().min(1),
  }),
]);

export type CatalogInput = z.infer<typeof CatalogInputSchema>;

const baseEntry = {
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  // Surfaced in a Featured section as well as its category.
  featured: z.boolean().optional(),
  // Values the user must supply on the plugin's setup page.
  inputs: z.array(CatalogInputSchema).optional(),
} as const;

export const HttpCatalogEntrySchema = z.object({
  ...baseEntry,
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

// Matches a `name@version` arg (optionally scoped) so the UI can show the
// package name. Display-only, so a loose shape is enough.
const PACKAGE_SPEC_REGEX = /^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+@\d/i;

export function looksLikePackageSpec(arg: string): boolean {
  return PACKAGE_SPEC_REGEX.test(arg);
}

// Version pinning is enforced by cloud CI on the catalog data and shown to
// the user by the consent prompt, so the desktop only checks the shape.
export const StdioCatalogEntrySchema = z.object({
  ...baseEntry,
  transport: z.literal("stdio"),
  command: z.literal("npx"),
  args: z.array(z.string()).min(1),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpCatalogEntrySchema = z.discriminatedUnion("transport", [
  HttpCatalogEntrySchema,
  StdioCatalogEntrySchema,
]);

export type McpCatalogEntry = z.infer<typeof McpCatalogEntrySchema>;
export type HttpCatalogEntry = z.infer<typeof HttpCatalogEntrySchema>;
export type StdioCatalogEntry = z.infer<typeof StdioCatalogEntrySchema>;
