import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Everything the preload bundle pulls in must be bundleable.
 *
 * The preload script is the only bridge between the renderer and the main
 * process. If its build fails, there is no bridge, and every screen reports
 * "IPC renderer not available" — which reads like a broken feature rather than
 * a build that did not happen. That is exactly what one unresolvable import in
 * one contract file caused.
 *
 * Two things are checked: the preload graph reaches nothing from the renderer
 * (hooks, atoms, components, pages), and its config can resolve the "@/" alias
 * that the rest of the codebase uses.
 */

const root = process.cwd();

/** Directories that belong to the renderer and must stay out of preload. */
const RENDERER_DIRS = ["src/hooks", "src/atoms", "src/components", "src/pages"];

function withoutTypeImports(source: string): string {
  return source.replace(/import\s+type\s[^;]*;/g, "");
}

function resolveImport(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every local module the preload entry reaches. */
function preloadGraph(): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = withoutTypeImports(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const resolved = resolveImport(match[1], file);
      if (resolved) visit(resolved);
    }
  };
  visit(path.join(root, "src", "preload.ts"));
  return seen;
}

describe("preload bundle", () => {
  it("reaches nothing that belongs to the renderer", () => {
    const offenders = [...preloadGraph()]
      .map((file) => path.relative(root, file))
      .filter((file) => RENDERER_DIRS.some((dir) => file.startsWith(dir)));

    expect(offenders, "renderer modules pulled into preload").toEqual([]);
  });

  it("has a config that can resolve the alias the code uses", () => {
    // Without this, the first "@/" import anywhere in the graph fails the
    // build, and the failure is silent until every IPC call reports that the
    // renderer bridge is missing.
    const config = fs.readFileSync(
      path.join(root, "vite.preload.config.mts"),
      "utf8",
    );
    expect(config).toMatch(/alias/);
    expect(config).toMatch(/"@"/);
  });
});
