import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The renderer must not reach anything that only exists in the main process.
 *
 * Importing node:child_process into a component does not fail the build and
 * does not log usefully: the window simply never renders, which looks like a
 * black screen rather than one import being wrong. That happened, and this is
 * the check that would have caught it.
 *
 * The whole import graph is followed, not one hop. The chain that caused it
 * was two hops long — component → provider → environment — and a one-hop
 * version of this test passed while the app was black.
 */

/**
 * The modules that actually take the window out.
 *
 * node:path is deliberately absent: Vite provides it in the renderer and the
 * vault browser has used it for weeks. This lists what has no browser
 * equivalent, so the rule stays about breakage rather than tidiness.
 */
const NODE_ONLY =
  /from\s+["'](node:(child_process|fs|os|net|dns|worker_threads|module)|electron)["']/;

const root = process.cwd();
const rendererDirs = ["src/components", "src/pages", "src/hooks", "src/atoms"];

/**
 * Source with type-only imports removed.
 *
 * `import type { X } from "y"` is erased before a bundle exists, so it cannot
 * drag anything into the renderer.
 */
function withoutTypeImports(source: string): string {
  return source.replace(/import\s+type\s[^;]*;/g, "");
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
      ? [full]
      : [];
  });
}

/** Local imports a file makes, resolved to real paths. */
function localImports(file: string): string[] {
  const source = withoutTypeImports(fs.readFileSync(file, "utf8"));
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );

  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (!base) return [];

    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (fs.existsSync(candidate)) return [candidate];
    }
    return [];
  });
}

/**
 * The path from a renderer file to a Node-only module, or null.
 *
 * Depth-first with a visited set, so a cycle in the graph terminates rather
 * than recursing until the stack gives out.
 */
function pathToNode(
  file: string,
  seen: Set<string>,
  trail: string[],
): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);

  if (NODE_ONLY.test(withoutTypeImports(fs.readFileSync(file, "utf8")))) {
    return [...trail, file];
  }

  for (const imported of localImports(file)) {
    const found = pathToNode(imported, seen, [...trail, file]);
    if (found) return found;
  }
  return null;
}

describe("renderer imports", () => {
  it("never reaches a Node-only module, however many hops away", () => {
    const offenders: string[] = [];

    for (const dir of rendererDirs) {
      for (const file of walk(path.join(root, dir))) {
        const chain = pathToNode(file, new Set(), []);
        if (chain) {
          offenders.push(
            chain.map((step) => path.relative(root, step)).join(" → "),
          );
        }
      }
    }

    expect(offenders, "renderer files reaching main-process modules").toEqual(
      [],
    );
  });
});
