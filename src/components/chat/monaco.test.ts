import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@monaco-editor/react", () => ({ loader: { init } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it("keeps extensionless diff buffers available to TypeScript after enabling JSX", async () => {
  // Monaco's defaults allow anonymous models such as inmemory://model/4.
  let compilerOptions: ts.CompilerOptions = {
    allowNonTsExtensions: true,
    target: ts.ScriptTarget.ESNext,
  };
  const setCompilerOptions = vi.fn((options: ts.CompilerOptions) => {
    // Monaco replaces the entire configuration rather than merging it.
    compilerOptions = options;
  });
  init.mockResolvedValue({
    editor: { defineTheme: vi.fn() },
    languages: {
      typescript: {
        JsxEmit: { React: ts.JsxEmit.React },
        typescriptDefaults: {
          getCompilerOptions: () => compilerOptions,
          setCompilerOptions,
          setDiagnosticsOptions: vi.fn(),
        },
      },
    },
  });

  // Exercise production initialization with a local loader, without a CDN load.
  vi.stubEnv("VITEST", "false");
  await import("./monaco");
  await vi.waitFor(() => expect(setCompilerOptions).toHaveBeenCalledOnce());

  const fileName = "inmemory://model/4";
  const source = "const value: number = 42;\nvalue;";
  const service = ts.createLanguageService({
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) =>
      name === fileName ? ts.ScriptSnapshot.fromString(source) : undefined,
    getScriptKind: () => ts.ScriptKind.TS,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? source : undefined),
  });

  try {
    // These requests previously threw "Could not find source file".
    expect(service.getSyntacticDiagnostics(fileName)).toEqual([]);
    expect(service.getSuggestionDiagnostics(fileName)).toEqual([]);
    const hover = service.getQuickInfoAtPosition(
      fileName,
      source.lastIndexOf("value"),
    );
    expect(ts.displayPartsToString(hover?.displayParts)).toBe(
      "const value: number",
    );
    expect(compilerOptions.jsx).toBe(ts.JsxEmit.React);
    expect(compilerOptions.target).toBe(ts.ScriptTarget.ESNext);
  } finally {
    service.dispose();
  }
});
