import type { Plugin } from "vite";

const ALLOWED_MODULES = new Set([
  "electron",
  "electron/renderer",
  "electron/common",
]);

/** Electron 45 removes the old Node module shims from sandboxed preloads. */
export function sandboxedPreloadPlugin(): Plugin {
  return {
    name: "dyad-sandboxed-preload",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const name of [...output.imports, ...output.dynamicImports]) {
          if (!name.startsWith(".") && !ALLOWED_MODULES.has(name)) {
            this.error(
              `Sandboxed preload cannot import ${name}; bundle its browser implementation or move it to main.`,
            );
          }
        }
        // Rollup can leave CommonJS requires in otherwise bundled dependencies.
        const visit = (node: any): void => {
          if (
            node?.type === "CallExpression" &&
            node.callee?.type === "Identifier" &&
            node.callee.name === "require"
          ) {
            const name = node.arguments[0]?.value;
            if (!ALLOWED_MODULES.has(name))
              this.error(`Sandboxed preload cannot require ${String(name)}.`);
          }
          if (!node || typeof node !== "object") return;
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
          }
        };
        visit(this.parse(output.code));
      }
    },
  };
}
