export interface CodeExplorerWorkerInput {
  appPath: string;
  query: string;
  tsconfigPath?: string;
  maxFiles?: number;
  maxDepth?: number;
}

export interface CodeExplorerSymbolResult {
  name: string;
  kind: string;
  line: number;
}

export interface CodeExplorerSourceWindow {
  startLine: number;
  lines: string[];
}

export interface CodeExplorerFileResult {
  path: string;
  symbols: CodeExplorerSymbolResult[];
  windows: CodeExplorerSourceWindow[];
}

export interface CodeExplorerResult {
  query: string;
  totalSymbols: number;
  totalFiles: number;
  indexedFileCount: number;
  indexMs: number;
  searchMs: number;
  files: CodeExplorerFileResult[];
  truncated: boolean;
  notes: string[];
}

export type CodeExplorerWorkerOutput =
  | { success: true; data: CodeExplorerResult }
  | { success: false; error: string };
