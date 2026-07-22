import { z } from "zod";

// Http and stdio entries are supported. The transport discriminator
// makes any other entry kind fail per-entry validation and drop out,
// so the catalog can serve entry kinds this client doesn't know about
// yet.
//
// Kept dependency-free (zod only) so the contract in mcp.ts can import
// it without pulling the main-process catalog client into the renderer
// bundle.

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

// Exact-version package spec: `name@1.2.3` or `@scope/name@1.2.3` with an
// optional prerelease/build suffix. Rejects tags and ranges. The name
// can't start with `-`, so a flag-shaped token isn't read as a spec. Also
// used by the UI to show an entry's package name.
const PINNED_PACKAGE_SPEC_REGEX =
  /^(@[a-z0-9~._][a-z0-9~._-]*\/)?[a-z0-9~._][a-z0-9~._-]*@\d+\.\d+\.\d+(-[0-9a-z.-]+)?(\+[0-9a-z.-]+)?$/i;

export function isPinnedPackageSpec(arg: string): boolean {
  return PINNED_PACKAGE_SPEC_REGEX.test(arg);
}

// Enforces our npx and exact-version convention, dropping a malformed
// entry like an @latest slip. Real protection against a bad package comes
// from curation, cloud CI, and the consent prompt. Refine returns false
// instead of throwing so one bad entry does not abort the batch.
export const StdioCatalogEntrySchema = z.object({
  ...baseEntry,
  transport: z.literal("stdio"),
  command: z.literal("npx"),
  args: z
    .array(z.string())
    .min(1)
    .refine(
      (args) => args.some(isPinnedPackageSpec),
      "args must include an exact-version-pinned package spec",
    ),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpCatalogEntrySchema = z.discriminatedUnion("transport", [
  HttpCatalogEntrySchema,
  StdioCatalogEntrySchema,
]);

export type McpCatalogEntry = z.infer<typeof McpCatalogEntrySchema>;
export type HttpCatalogEntry = z.infer<typeof HttpCatalogEntrySchema>;
export type StdioCatalogEntry = z.infer<typeof StdioCatalogEntrySchema>;
