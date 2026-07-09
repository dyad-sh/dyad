export interface CodeExplorerWorkerInput {
  appPath: string;
  query: string;
  tsconfigPath?: string;
  tsBuildInfoCacheDir?: string;
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
  endLine: number;
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

// All explorer sessions share a single host process, so replies must be
// correlated to their requests explicitly instead of relying on
// one-in-flight-per-worker ordering.
export interface CodeExplorerHostRequest {
  requestId: number;
  input: CodeExplorerWorkerInput;
}

export type CodeExplorerHostResponse = CodeExplorerWorkerOutput & {
  requestId: number;
};
