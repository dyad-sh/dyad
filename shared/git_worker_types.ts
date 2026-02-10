/**
 * Types for git worker thread communication.
 * Used by both the main process and the git worker.
 */

export interface GitPushWorkerInput {
  type: "push";
  appPath: string;
  branch: string;
  accessToken?: string;
  force?: boolean;
  forceWithLease?: boolean;
  enableNativeGit: boolean;
  sanitizedEnv?: Record<string, string | undefined>;
}

export interface GitPullWorkerInput {
  type: "pull";
  appPath: string;
  branch: string;
  remote: string;
  accessToken?: string;
  enableNativeGit: boolean;
  sanitizedEnv?: Record<string, string | undefined>;
}

export interface GitSetRemoteUrlWorkerInput {
  type: "setRemoteUrl";
  appPath: string;
  remoteUrl: string;
  enableNativeGit: boolean;
  sanitizedEnv?: Record<string, string | undefined>;
}

export type GitWorkerInput =
  | GitPushWorkerInput
  | GitPullWorkerInput
  | GitSetRemoteUrlWorkerInput;

export interface GitWorkerSuccess {
  success: true;
}

export interface GitWorkerError {
  success: false;
  error: string;
  code?: string;
  name?: string;
}

export type GitWorkerOutput = GitWorkerSuccess | GitWorkerError;
