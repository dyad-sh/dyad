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

// A package spec pinned to an exact version (`name@1.2.3` or
// `@scope/name@1.2.3`). Version grammar is the official semver.org regex
// (https://semver.org); the name can't start with `-` so flags aren't specs.
const PINNED_PACKAGE_SPEC_REGEX =
  /^(@[a-z0-9~._][a-z0-9~._-]*\/)?[a-z0-9~._][a-z0-9~._-]*@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/i;

export function isPinnedPackageSpec(arg: string): boolean {
  return PINNED_PACKAGE_SPEC_REGEX.test(arg);
}

// An arg shaped like `name@version` (optionally scoped), used to spot
// specs that aren't pinned, e.g. `pkg@latest`.
const VERSIONED_SPEC_REGEX = /^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+@/i;

// Requires every package-spec-shaped arg to be pinned, so a repeated
// `--package foo@latest` can't float a version. Returns false instead of
// throwing so one bad entry doesn't abort the batch.
function argsPinPackages(args: string[]): boolean {
  return (
    args.some(isPinnedPackageSpec) &&
    args.every(
      (arg) => !VERSIONED_SPEC_REGEX.test(arg) || isPinnedPackageSpec(arg),
    )
  );
}

export const StdioCatalogEntrySchema = z.object({
  ...baseEntry,
  transport: z.literal("stdio"),
  command: z.literal("npx"),
  args: z
    .array(z.string())
    .min(1)
    .refine(
      argsPinPackages,
      "every package arg must be pinned to an exact version",
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
