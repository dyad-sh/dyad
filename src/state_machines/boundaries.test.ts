import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const MACHINE_DIRECTORIES = [
  "app_run",
  "chat_stream",
  "connection_flow",
  "first_prompt",
  "github_ops",
  "image_generation",
  "mcp_oauth",
  "plan_handoff",
  "preview_iframe",
  "screenshot",
  "version_preview",
  "voice_to_text",
  "user_input",
] as const;
type MachineDirectory = (typeof MACHINE_DIRECTORIES)[number];
type DeletionPr = "A2" | "A3" | "A4" | "A5" | "A6";
type BoundaryRule =
  | "pure-machine-module"
  | "writable-projection-export"
  | "atom-projection-call"
  | "cross-machine-atom-read";

interface AllowlistEntry {
  rule: BoundaryRule;
  atom: string;
  file: string;
  detail: string;
  deletionPr: DeletionPr;
  note?: string;
}

/**
 * Temporary ownership violations verified against the population-2 and
 * population-3 inventory in plans/claude-cleanup-machines.md.
 *
 * Exact matching is intentional: deleting a violation makes this list stale,
 * while adding one fails until it is classified and assigned to A2-A6.
 */
const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    rule: "pure-machine-module",
    atom: "previewRunStateByAppIdAtom",
    file: "app_run/transition.ts",
    detail: "@/atoms/previewRuntimeAtoms",
    deletionPr: "A4",
  },
  {
    rule: "pure-machine-module",
    atom: "chatMessagesByIdAtom",
    file: "chat_stream/state.ts",
    detail: "@/ipc/types",
    deletionPr: "A6",
    note: "Inventory gap: lifecycle request types still come from IPC.",
  },
  {
    rule: "pure-machine-module",
    atom: "imageGenerationJobsAtom",
    file: "image_generation/state.ts",
    detail: "@/ipc/types",
    deletionPr: "A3",
    note: "Inventory gap: the state type still imports its IPC response types.",
  },
  {
    rule: "writable-projection-export",
    atom: "streamingPreviewByChatIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A3",
  },
  {
    rule: "writable-projection-export",
    atom: "setImageGenerationJobsProjectionAtom",
    file: "atoms/imageGenerationAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A3",
  },
  {
    rule: "writable-projection-export",
    atom: "previewAppExitByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A3",
  },
  {
    rule: "writable-projection-export",
    atom: "setPreviewAppExitForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A3",
  },
  {
    rule: "writable-projection-export",
    atom: "pendingScreenshotAppIdsAtom",
    file: "atoms/previewAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "previewRunStateByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "setPreviewRunStateForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "appUrlByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "setAppUrlForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "previewReloadTokenByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "bumpPreviewReloadTokenForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A4",
  },
  {
    rule: "writable-projection-export",
    atom: "previewErrorByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "setPreviewErrorForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "consoleEntriesByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "setConsoleEntriesForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "appendConsoleEntriesForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "packageManagerWarningByAppIdAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "setPackageManagerWarningForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "clearPackageManagerWarningForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "clearPreviewRuntimeForAppAtom",
    file: "atoms/previewRuntimeAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A5",
  },
  {
    rule: "writable-projection-export",
    atom: "chatErrorByIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "writable-projection-export",
    atom: "chatMessagesByIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "writable-projection-export",
    atom: "isStreamingByIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "writable-projection-export",
    atom: "queuedMessagesByIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "writable-projection-export",
    atom: "queuePausedByIdAtom",
    file: "atoms/chatAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "writable-projection-export",
    atom: "planStateAtom",
    file: "atoms/planAtoms.ts",
    detail: "exported writable atom",
    deletionPr: "A6",
  },
  {
    rule: "atom-projection-call",
    atom: "setImageGenerationJobsProjectionAtom",
    file: "image_generation/ImageGenerationProvider.tsx",
    detail: "projectToAtom",
    deletionPr: "A3",
  },
  {
    rule: "atom-projection-call",
    atom: "writableUserInputRequestsAtom",
    file: "user_input/projection.ts",
    detail: "registerAtomWriter",
    deletionPr: "A3",
  },
  {
    rule: "atom-projection-call",
    atom: "writableRespondingRequestIdsAtom",
    file: "user_input/projection.ts",
    detail: "registerAtomWriter",
    deletionPr: "A3",
  },
  {
    rule: "atom-projection-call",
    atom: "setPreviewRunStateForAppAtom",
    file: "app_run/manager.ts",
    detail: "registerAtomWriter",
    deletionPr: "A4",
  },
  {
    rule: "atom-projection-call",
    atom: "isStreamingByIdAtom",
    file: "chat_stream/manager.ts",
    detail: "registerAtomWriter",
    deletionPr: "A6",
  },
  {
    rule: "cross-machine-atom-read",
    atom: "isStreamingByIdAtom",
    file: "plan_handoff/commands.ts",
    detail: "get:chat_stream",
    deletionPr: "A6",
  },
  {
    rule: "cross-machine-atom-read",
    atom: "isStreamingByIdAtom",
    file: "plan_handoff/commands.ts",
    detail: "sub:chat_stream",
    deletionPr: "A6",
  },
] as const;

interface BoundaryViolation {
  rule: BoundaryRule;
  file: string;
  detail: string;
  atom: string;
}

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

function sourceFileFor(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.win32.sep).join(path.posix.sep);
}

function relativeSourcePath(filePath: string): string {
  return toPortablePath(path.relative(SOURCE_ROOT, filePath));
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function machineForFile(filePath: string): MachineDirectory | undefined {
  return MACHINE_DIRECTORIES.find((machine) =>
    isWithin(path.join(SOURCE_ROOT, machine), filePath),
  );
}

function importedMachineFor(
  filePath: string,
  source: string,
): MachineDirectory | undefined {
  const aliasMatch = /^@\/([^/]+)(?:\/|$)/.exec(source);
  if (aliasMatch) {
    return MACHINE_DIRECTORIES.find((machine) => machine === aliasMatch[1]);
  }
  if (!source.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(filePath), source);
  return machineForFile(resolved);
}

function resolvesWithin(
  filePath: string,
  source: string,
  root: string,
): boolean {
  if (source.startsWith("@/")) {
    return isWithin(root, path.join(SOURCE_ROOT, source.slice(2)));
  }
  return (
    source.startsWith(".") &&
    isWithin(root, path.resolve(path.dirname(filePath), source))
  );
}

function isJotaiModule(source: string): boolean {
  return source === "jotai" || source.startsWith("jotai/");
}

function isJotaiAtomCall(
  call: ts.CallExpression,
  bindings: Map<string, { imported: string; source: string }>,
): boolean {
  if (ts.isIdentifier(call.expression)) {
    const binding = bindings.get(call.expression.text);
    return binding?.imported === "atom" && isJotaiModule(binding.source);
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    const binding = bindings.get(call.expression.expression.text);
    return (
      binding?.imported === "*" &&
      isJotaiModule(binding.source) &&
      call.expression.name.text === "atom"
    );
  }
  return false;
}

function isProjectionModuleImport(filePath: string, source: string): boolean {
  if (source === "@/state_machines/projection") return true;
  if (!source.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(filePath), source);
  const projectionModule = path.join(SOURCE_ROOT, "state_machines/projection");
  return resolved === projectionModule || resolved === `${projectionModule}.ts`;
}

function isForbiddenPureMachineImport(
  filePath: string,
  machine: MachineDirectory,
  source: string,
): boolean {
  const importedMachine = importedMachineFor(filePath, source);
  return (
    source === "react" ||
    source.startsWith("react/") ||
    source === "electron" ||
    source.startsWith("electron/") ||
    source.startsWith("@electron/") ||
    source === "jotai" ||
    source.startsWith("jotai/") ||
    resolvesWithin(filePath, source, path.join(SOURCE_ROOT, "atoms")) ||
    resolvesWithin(filePath, source, path.join(SOURCE_ROOT, "ipc")) ||
    (importedMachine !== undefined && importedMachine !== machine)
  );
}

function allowlistAtom(
  rule: BoundaryRule,
  file: string,
  detail: string,
): string {
  return (
    ALLOWLIST.find(
      (entry) =>
        entry.rule === rule && entry.file === file && entry.detail === detail,
    )?.atom ?? "<unclassified>"
  );
}

function expectExactAllowlist(
  rule: BoundaryRule,
  actual: BoundaryViolation[],
): void {
  const comparable = (entry: BoundaryViolation | AllowlistEntry) => ({
    rule: entry.rule,
    atom: entry.atom,
    file: entry.file,
    detail: entry.detail,
  });
  const sort = <T extends ReturnType<typeof comparable>>(entries: T[]) =>
    entries.sort((left, right) =>
      `${left.file}:${left.detail}:${left.atom}`.localeCompare(
        `${right.file}:${right.detail}:${right.atom}`,
      ),
    );
  expect(sort(actual.map(comparable))).toEqual(
    sort(ALLOWLIST.filter((entry) => entry.rule === rule).map(comparable)),
  );
}

function importedBindings(
  sourceFile: ts.SourceFile,
): Map<string, { imported: string; source: string }> {
  const bindings = new Map<string, { imported: string; source: string }>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    const source = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      bindings.set(clause.name.text, { imported: "default", source });
    }
    const namedBindings = clause.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.set(element.name.text, {
          imported: element.propertyName?.text ?? element.name.text,
          source,
        });
      }
    } else if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindings.set(namedBindings.name.text, { imported: "*", source });
    }
  }
  return bindings;
}

function expressionName(
  expression: ts.Expression | undefined,
): string | undefined {
  while (
    expression &&
    (ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isParenthesizedExpression(expression))
  ) {
    expression = expression.expression;
  }
  if (expression && ts.isIdentifier(expression)) return expression.text;
  if (expression && ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function argumentName(
  call: ts.CallExpression,
  index: number,
): string | undefined {
  return expressionName(call.arguments[index]);
}

function importedArgumentName(
  call: ts.CallExpression,
  index: number,
  bindings: Map<string, { imported: string; source: string }>,
): string | undefined {
  const expression = call.arguments[index];
  if (expression && ts.isIdentifier(expression)) {
    return bindings.get(expression.text)?.imported;
  }
  if (
    expression &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const binding = bindings.get(expression.expression.text);
    if (binding?.imported === "*") return expression.name.text;
  }
  return undefined;
}

function importedCallName(
  call: ts.CallExpression,
  bindings: Map<string, { imported: string; source: string }>,
  moduleSuffix: string,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    const binding = bindings.get(call.expression.text);
    return binding?.source.endsWith(moduleSuffix)
      ? binding.imported
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    const binding = bindings.get(call.expression.expression.text);
    if (binding?.imported === "*" && binding.source.endsWith(moduleSuffix)) {
      return call.expression.name.text;
    }
  }
  return undefined;
}

describe("state-machine boundaries", () => {
  it("normalizes Windows paths used in boundary assertions", () => {
    expect(toPortablePath("first_prompt\\FirstPromptProvider.tsx")).toBe(
      "first_prompt/FirstPromptProvider.tsx",
    );
  });

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
          source === "react" ||
            source === "use-sync-external-store/with-selector" ||
            relativeImportStaysInKernel,
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

  it("recognizes relative and platform imports forbidden in pure modules", () => {
    const stateFile = path.join(SOURCE_ROOT, "app_run/state.ts");
    expect(
      [
        "../atoms/previewRuntimeAtoms",
        "../ipc/types",
        "electron",
        "@electron/remote",
      ].every((source) =>
        isForbiddenPureMachineImport(stateFile, "app_run", source),
      ),
    ).toBe(true);
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

  it("keeps state.ts and transition.ts free of UI, IPC, and other machines", () => {
    const violations: BoundaryViolation[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      for (const name of ["state.ts", "transition.ts"]) {
        const filePath = path.join(SOURCE_ROOT, machine, name);
        if (!fs.existsSync(filePath)) continue;
        for (const source of importsIn(filePath)) {
          if (!isForbiddenPureMachineImport(filePath, machine, source)) {
            continue;
          }
          const file = relativeSourcePath(filePath);
          violations.push({
            rule: "pure-machine-module",
            atom: allowlistAtom("pure-machine-module", file, source),
            file,
            detail: source,
          });
        }
      }
    }
    expectExactAllowlist("pure-machine-module", violations);
  });

  it("does not import another machine's controller, registry, manager, or provider", () => {
    const ownerModule =
      /(?:^|\/)(?:controller|registry|manager|[^/]*provider)(?:\.[^/]*)?$/i;
    const violations: string[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      const machineRoot = path.join(SOURCE_ROOT, machine);
      for (const filePath of productionFiles(machineRoot)) {
        for (const source of importsIn(filePath)) {
          const importedMachine = importedMachineFor(filePath, source);
          if (
            importedMachine !== undefined &&
            importedMachine !== machine &&
            ownerModule.test(source)
          ) {
            violations.push(
              `${relativeSourcePath(filePath)} imports ${source}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not export writable Jotai atoms from machine projection modules", () => {
    const violations: BoundaryViolation[] = [];
    const projectionFiles = new Set(
      ALLOWLIST.filter(
        (entry) => entry.rule === "writable-projection-export",
      ).map((entry) => path.join(SOURCE_ROOT, entry.file)),
    );
    for (const machine of MACHINE_DIRECTORIES) {
      const filePath = path.join(SOURCE_ROOT, machine, "projection.ts");
      if (fs.existsSync(filePath)) projectionFiles.add(filePath);
    }
    for (const filePath of projectionFiles) {
      const sourceFile = sourceFileFor(filePath);
      const bindings = importedBindings(sourceFile);
      const exportedNames = new Set<string>();
      for (const statement of sourceFile.statements) {
        if (
          ts.isVariableStatement(statement) &&
          statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          )
        ) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              exportedNames.add(declaration.name.text);
            }
          }
        } else if (
          ts.isExportDeclaration(statement) &&
          !statement.moduleSpecifier &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        ) {
          for (const element of statement.exportClause.elements) {
            exportedNames.add(element.propertyName?.text ?? element.name.text);
          }
        }
      }
      for (const statement of sourceFile.statements) {
        if (
          ts.isExportAssignment(statement) &&
          !statement.isExportEquals &&
          ts.isCallExpression(statement.expression) &&
          isJotaiAtomCall(statement.expression, bindings)
        ) {
          violations.push({
            rule: "writable-projection-export",
            atom: "<default>",
            file: relativeSourcePath(filePath),
            detail: "exported writable atom",
          });
          continue;
        }
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            !ts.isIdentifier(declaration.name) ||
            !exportedNames.has(declaration.name.text) ||
            !declaration.initializer ||
            !ts.isCallExpression(declaration.initializer) ||
            !isJotaiAtomCall(declaration.initializer, bindings)
          ) {
            continue;
          }
          const [read, write] = declaration.initializer.arguments;
          const writable =
            write !== undefined ||
            read === undefined ||
            (!ts.isArrowFunction(read) && !ts.isFunctionExpression(read));
          if (!writable) continue;
          const file = relativeSourcePath(filePath);
          const atom = declaration.name.text;
          const dedicatedProjectionModule =
            path.basename(filePath) === "projection.ts" &&
            machineForFile(filePath) !== undefined;
          const inventoriedLegacyProjection = ALLOWLIST.some(
            (entry) =>
              entry.rule === "writable-projection-export" &&
              entry.file === file &&
              entry.atom === atom,
          );
          if (!dedicatedProjectionModule && !inventoriedLegacyProjection) {
            continue;
          }
          violations.push({
            rule: "writable-projection-export",
            atom,
            file,
            detail: "exported writable atom",
          });
        }
      }
    }
    expectExactAllowlist("writable-projection-export", violations);
  });

  it("allows only inventoried atom projection call sites", () => {
    const violations: BoundaryViolation[] = [];
    for (const filePath of productionFiles(SOURCE_ROOT)) {
      if (filePath === path.join(SOURCE_ROOT, "state_machines/projection.ts")) {
        continue;
      }
      const file = relativeSourcePath(filePath);
      const sourceFile = sourceFileFor(filePath);
      const bindings = importedBindings(sourceFile);
      const helperBindings = new Map<string, string>();
      const namespaceBindings = new Set<string>();
      for (const [localName, binding] of bindings) {
        if (!isProjectionModuleImport(filePath, binding.source)) continue;
        if (
          binding.imported === "registerAtomWriter" ||
          binding.imported === "projectToAtom"
        ) {
          helperBindings.set(localName, binding.imported);
        } else if (binding.imported === "*") {
          namespaceBindings.add(localName);
        }
      }
      const helperReference = (node: ts.Expression): string | undefined => {
        if (ts.isIdentifier(node)) return helperBindings.get(node.text);
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          namespaceBindings.has(node.expression.text) &&
          (node.name.text === "registerAtomWriter" ||
            node.name.text === "projectToAtom")
        ) {
          return node.name.text;
        }
        return undefined;
      };
      for (const statement of sourceFile.statements) {
        if (
          !ts.isExportDeclaration(statement) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteralLike(statement.moduleSpecifier) ||
          !isProjectionModuleImport(filePath, statement.moduleSpecifier.text)
        ) {
          continue;
        }
        const names =
          statement.exportClause && ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements
                .map(
                  (element) => element.propertyName?.text ?? element.name.text,
                )
                .filter(
                  (name) =>
                    name === "registerAtomWriter" || name === "projectToAtom",
                )
            : ["*"];
        for (const name of names) {
          violations.push({
            rule: "atom-projection-call",
            atom: "<escaped>",
            file,
            detail: `${name}:re-export`,
          });
        }
      }
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          if (
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments.length === 1 &&
            ts.isStringLiteralLike(node.arguments[0]) &&
            isProjectionModuleImport(filePath, node.arguments[0].text)
          ) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: "*:dynamic-import",
            });
          }
          const callName = helperReference(node.expression);
          if (
            callName !== "registerAtomWriter" &&
            callName !== "projectToAtom"
          ) {
            ts.forEachChild(node, visit);
            return;
          }
          violations.push({
            rule: "atom-projection-call",
            atom: argumentName(node, 1) ?? "<dynamic>",
            file,
            detail: callName,
          });
        }
        if (ts.isIdentifier(node) && helperBindings.has(node.text)) {
          const parent = node.parent;
          const isImportName =
            ts.isImportSpecifier(parent) ||
            (ts.isImportClause(parent) && parent.name === node);
          const isDirectCall =
            ts.isCallExpression(parent) && parent.expression === node;
          if (!isImportName && !isDirectCall) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: `${helperBindings.get(node.text)}:indirect-reference`,
            });
          }
        } else if (ts.isIdentifier(node) && namespaceBindings.has(node.text)) {
          const parent = node.parent;
          const isImportName = ts.isNamespaceImport(parent);
          const isHelperProperty =
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            helperReference(parent) !== undefined;
          if (!isImportName && !isHelperProperty) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: "*:indirect-reference",
            });
          }
        } else if (
          ts.isPropertyAccessExpression(node) &&
          helperReference(node)
        ) {
          const parent = node.parent;
          if (!(ts.isCallExpression(parent) && parent.expression === node)) {
            violations.push({
              rule: "atom-projection-call",
              atom: "<escaped>",
              file,
              detail: `${helperReference(node)}:indirect-reference`,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    expectExactAllowlist("atom-projection-call", violations);
  });

  it("allows only inventoried cross-machine atom reads", () => {
    type AtomAccess = {
      atom: string;
      file: string;
      machine: MachineDirectory;
      method: "get" | "set" | "sub";
    };
    const accesses: AtomAccess[] = [];
    for (const machine of MACHINE_DIRECTORIES) {
      for (const filePath of productionFiles(path.join(SOURCE_ROOT, machine))) {
        const collectsReads = [
          "commands.ts",
          "controller.ts",
          "manager.ts",
        ].includes(path.basename(filePath));
        const sourceFile = sourceFileFor(filePath);
        const bindings = importedBindings(sourceFile);
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            (node.expression.name.text === "get" ||
              node.expression.name.text === "set" ||
              node.expression.name.text === "sub")
          ) {
            const atom = importedArgumentName(node, 0, bindings);
            const method = node.expression.name.text;
            if (atom && (method === "set" || collectsReads)) {
              accesses.push({
                atom,
                file: relativeSourcePath(filePath),
                machine,
                method,
              });
            }
          }
          if (ts.isCallExpression(node)) {
            const callName = importedCallName(
              node,
              bindings,
              "state_machines/projection",
            );
            if (
              callName !== "registerAtomWriter" &&
              callName !== "projectToAtom"
            ) {
              ts.forEachChild(node, visit);
              return;
            }
            const atom = importedArgumentName(node, 1, bindings);
            if (atom) {
              accesses.push({
                atom,
                file: relativeSourcePath(filePath),
                machine,
                method: "set",
              });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      }
    }

    const writers = new Map<string, Set<MachineDirectory>>();
    for (const access of accesses) {
      if (access.method !== "set") continue;
      const machines = writers.get(access.atom) ?? new Set();
      machines.add(access.machine);
      writers.set(access.atom, machines);
    }

    const violations: BoundaryViolation[] = [];
    for (const access of accesses) {
      if (access.method === "set") continue;
      const otherWriters = [...(writers.get(access.atom) ?? [])]
        .filter((writer) => writer !== access.machine)
        .sort();
      if (otherWriters.length === 0) continue;
      const detail = `${access.method}:${otherWriters.join(",")}`;
      violations.push({
        rule: "cross-machine-atom-read",
        atom: access.atom,
        file: access.file,
        detail,
      });
    }
    expectExactAllowlist("cross-machine-atom-read", violations);
  });

  it("keeps image-generation projection writes inside its provider", () => {
    const projectionAtomModule = path.join(
      SOURCE_ROOT,
      "atoms/imageGenerationAtoms.ts",
    );
    const writers = productionFiles(SOURCE_ROOT)
      .filter((filePath) => filePath !== projectionAtomModule)
      .filter((filePath) =>
        fs
          .readFileSync(filePath, "utf8")
          .includes("setImageGenerationJobsProjectionAtom"),
      )
      .map((filePath) => toPortablePath(path.relative(SOURCE_ROOT, filePath)));

    expect(writers).toEqual(["image_generation/ImageGenerationProvider.tsx"]);
  });
});
