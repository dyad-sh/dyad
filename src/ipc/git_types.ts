// Type definitions for Git operations
export type GitCommit = {
  oid: string;
  commit: {
    message: string;
    author: {
      timestamp: number;
    };
  };
};
export interface GitBaseParams {
  path: string;
}
export interface GitCommitParams extends GitBaseParams {
  message: string;
  amend?: boolean;
}
export interface GitFileParams extends GitBaseParams {
  filepath: string;
}
export interface GitCheckoutParams extends GitBaseParams {
  ref: string;
}
export interface GitBranchRenameParams extends GitBaseParams {
  oldBranch: string;
  newBranch: string;
}
export interface GitCloneParams {
  path: string; // destination
  url: string;
  depth?: number | null;
  singleBranch?: boolean;
  accessToken?: string;
}
export interface GitLogParams extends GitBaseParams {
  depth?: number;
}

export interface GitResult {
  success: boolean;
  error?: string;
}
export interface GitPushParams extends GitBaseParams {
  branch: string;
  accessToken: string;
  force?: boolean;
  forceWithLease?: boolean;
}
export interface GitFileAtCommitParams extends GitBaseParams {
  filePath: string;
  commitHash: string;
}
export interface GitSetRemoteUrlParams extends GitBaseParams {
  remoteUrl: string;
}
export interface GitInitParams extends GitBaseParams {
  ref?: string; // branch name, default = "main"
}
export interface GitStageToRevertParams extends GitBaseParams {
  targetOid: string;
}
export interface GitAuthorParam {
  name: string;
  email: string;
  timestamp?: number;
  timezoneOffset?: number;
}

export interface GitFetchParams extends GitBaseParams {
  remote?: string;
  accessToken?: string;
}

export interface GitPullParams extends GitBaseParams {
  remote?: string;
  branch?: string;
  accessToken?: string;
  author?: GitAuthorParam;
  rebase?: boolean;
}

export interface GitMergeParams extends GitBaseParams {
  branch: string;
  author?: GitAuthorParam;
}

export interface GitCreateBranchParams extends GitBaseParams {
  branch: string;
  from?: string;
}

export interface GitDeleteBranchParams extends GitBaseParams {
  branch: string;
}
