export interface SyncVirtualFileSystem {
  fileExists: (fileName: string) => boolean;
  readFile: (fileName: string) => string | undefined;

  getVirtualFiles: () => { path: string }[];
  getDeletedFiles: () => string[];
}

export interface SyncFileSystemDelegate {
  fileExists?: (fileName: string) => boolean;
  readFile?: (fileName: string) => string | undefined;
}

export interface Problem {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
  snippet: string;
}

export interface ProblemReport {
  problems: Problem[];
}

export interface WorkerInput {
  appPath: string;
  virtualChanges: VirtualChanges;
  tsBuildInfoCacheDir: string;
}

export interface WorkerOutput {
  success: boolean;
  data?: ProblemReport;
  error?: string;
}

export interface VirtualChanges {
  deletePaths: string[];
  renameTags: VirtualRename[];
  writeTags: VirtualFile[];
}

export interface VirtualFile {
  path: string;
  content: string;
}

export interface VirtualRename {
  from: string;
  to: string;
}
