import { slugifyAppPath } from "@/shared/slugify";

export interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

export type GithubDeviceFlowState =
  | {
      status: "idle";
      userCode: null;
      verificationUri: null;
      message: null;
      error: null;
    }
  | {
      status: "requesting";
      userCode: null;
      verificationUri: null;
      message: string;
      error: null;
    }
  | {
      status: "waiting";
      userCode: string | null;
      verificationUri: string | null;
      message: string | null;
      error: null;
    }
  | {
      status: "connected";
      userCode: null;
      verificationUri: null;
      message: string;
      error: null;
    }
  | {
      status: "error";
      userCode: null;
      verificationUri: null;
      message: null;
      error: string;
    };

export type GithubDeviceFlowAction =
  | { type: "start" }
  | {
      type: "update";
      userCode?: string;
      verificationUri?: string;
      message?: string;
    }
  | { type: "success" }
  | { type: "error"; error?: string }
  | { type: "reset" };

export const initialGithubDeviceFlowState: GithubDeviceFlowState = {
  status: "idle",
  userCode: null,
  verificationUri: null,
  message: null,
  error: null,
};

export function githubDeviceFlowReducer(
  state: GithubDeviceFlowState,
  action: GithubDeviceFlowAction,
): GithubDeviceFlowState {
  switch (action.type) {
    case "start":
      return {
        status: "requesting",
        userCode: null,
        verificationUri: null,
        message: "Requesting device code from GitHub...",
        error: null,
      };
    case "update": {
      const userCode = action.userCode ?? state.userCode;
      const verificationUri = action.verificationUri ?? state.verificationUri;
      const message = action.message ?? state.message;
      if (userCode || verificationUri) {
        return {
          status: "waiting",
          userCode,
          verificationUri,
          message,
          error: null,
        };
      }
      return {
        status: "requesting",
        userCode: null,
        verificationUri: null,
        message: message || "Requesting device code from GitHub...",
        error: null,
      };
    }
    case "success":
      return {
        status: "connected",
        userCode: null,
        verificationUri: null,
        message: "Successfully connected to GitHub!",
        error: null,
      };
    case "error":
      return {
        status: "error",
        userCode: null,
        verificationUri: null,
        message: null,
        error: action.error || "An unknown error occurred.",
      };
    case "reset":
      return initialGithubDeviceFlowState;
  }
}

export type GitHubRepoSetupMode = "create" | "existing";
export type GitHubBranchInputMode = "select" | "custom";

export interface GitHubRepoSetupState {
  mode: GitHubRepoSetupMode;
  selectedRepo: string;
  selectedBranch: string;
  branchInputMode: GitHubBranchInputMode;
  customBranchName: string;
  repoName: string;
  repoAvailable: boolean | null;
  repoCheckError: string | null;
  isCheckingRepo: boolean;
}

export type GitHubRepoSetupAction =
  | { type: "set-mode"; mode: GitHubRepoSetupMode }
  | { type: "select-repo"; repo: string }
  | { type: "branches-loaded"; branches: GitHubBranch[] }
  | { type: "select-branch"; branch: string }
  | { type: "use-custom-branch" }
  | { type: "set-custom-branch"; branch: string }
  | { type: "set-repo-name"; name: string }
  | { type: "repo-check-started" }
  | { type: "repo-check-skipped" }
  | { type: "repo-check-succeeded"; available: boolean; error?: string }
  | { type: "repo-check-failed"; error: string };

export function getInitialGitHubRepoSetupState(
  folderName: string,
): GitHubRepoSetupState {
  return {
    mode: "create",
    selectedRepo: "",
    selectedBranch: "main",
    branchInputMode: "select",
    customBranchName: "",
    repoName: slugifyAppPath(folderName),
    repoAvailable: null,
    repoCheckError: null,
    isCheckingRepo: false,
  };
}

export function githubRepoSetupReducer(
  state: GitHubRepoSetupState,
  action: GitHubRepoSetupAction,
): GitHubRepoSetupState {
  switch (action.type) {
    case "set-mode":
      return {
        ...state,
        mode: action.mode,
      };
    case "select-repo":
      return { ...state, selectedRepo: action.repo };
    case "branches-loaded": {
      const defaultBranch =
        action.branches.find((b) => b.name === "main" || b.name === "master") ??
        action.branches[0];
      return {
        ...state,
        selectedBranch: defaultBranch?.name ?? state.selectedBranch,
        branchInputMode: "select",
        customBranchName: "",
      };
    }
    case "select-branch":
      return {
        ...state,
        branchInputMode: "select",
        selectedBranch: action.branch,
      };
    case "use-custom-branch":
      return { ...state, branchInputMode: "custom", customBranchName: "" };
    case "set-custom-branch":
      return { ...state, customBranchName: action.branch };
    case "set-repo-name":
      return {
        ...state,
        repoName: action.name,
        repoAvailable: null,
        repoCheckError: null,
      };
    case "repo-check-started":
      return {
        ...state,
        repoAvailable: null,
        repoCheckError: null,
        isCheckingRepo: true,
      };
    case "repo-check-skipped":
      return {
        ...state,
        repoAvailable: null,
        repoCheckError: null,
        isCheckingRepo: false,
      };
    case "repo-check-succeeded":
      return {
        ...state,
        repoAvailable: action.available,
        repoCheckError: action.available
          ? null
          : action.error || "Repository name is not available.",
        isCheckingRepo: false,
      };
    case "repo-check-failed":
      return {
        ...state,
        repoCheckError: action.error,
        isCheckingRepo: false,
      };
  }
}
