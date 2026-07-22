import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const MACHINE_DIRECTORIES = [
  "app_run",
  "chat_stream",
  "connection_flow",
  "plan_handoff",
  "version_preview",
  "voice_to_text",
  "user_input",
] as const;

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(filePath);
    if (
      !/\.tsx?$/.test(entry.name) ||
      /\.(?:test|spec)\.tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [filePath];
  });
}

function importsFromSource(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "boundary-check.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function importsIn(filePath: string): string[] {
  return importsFromSource(fs.readFileSync(filePath, "utf8"));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

describe("state-machine boundaries", () => {
  it("keeps the shared kernel independent from domain and platform modules", () => {
    const kernelFiles = productionFiles(
      path.join(SOURCE_ROOT, "state_machines"),
    );
    for (const filePath of kernelFiles) {
      for (const source of importsIn(filePath)) {
        const relativeImportStaysInKernel =
          source.startsWith(".") &&
          isWithin(
            path.join(SOURCE_ROOT, "state_machines"),
            path.resolve(path.dirname(filePath), source),
          );
        expect(
          source === "react" || relativeImportStaysInKernel,
          `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
        ).toBe(true);
      }
    }
  });

  it("detects every module-loading syntax used by production TypeScript", () => {
    expect(
      importsFromSource(`
        import "side-effect";
        import value from "static-import";
        export { value } from "re-export";
        export * from "star-export";
        void import("dynamic-import");
      `),
    ).toEqual([
      "side-effect",
      "static-import",
      "re-export",
      "star-export",
      "dynamic-import",
    ]);
  });

  it("requires machine-to-machine calls to cross an injected facade", () => {
    for (const machine of MACHINE_DIRECTORIES) {
      const machineRoot = path.join(SOURCE_ROOT, machine);
      for (const filePath of productionFiles(machineRoot)) {
        for (const source of importsIn(filePath)) {
          const aliasMatch = /^@\/([^/]+)(?:\/|$)/.exec(source);
          if (aliasMatch) {
            expect(
              !MACHINE_DIRECTORIES.includes(
                aliasMatch[1] as (typeof MACHINE_DIRECTORIES)[number],
              ) || aliasMatch[1] === machine,
              `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
            ).toBe(true);
            continue;
          }
          if (!source.startsWith(".")) continue;
          const resolved = path.resolve(path.dirname(filePath), source);
          const importedMachine = MACHINE_DIRECTORIES.find((candidate) =>
            resolved.startsWith(path.join(SOURCE_ROOT, candidate) + path.sep),
          );
          expect(
            importedMachine === undefined || importedMachine === machine,
            `${path.relative(SOURCE_ROOT, filePath)} imports ${source}`,
          ).toBe(true);
        }
      }
    }
  });
});
