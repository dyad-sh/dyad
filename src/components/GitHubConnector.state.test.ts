import { describe, expect, it } from "vitest";
import {
  getInitialGitHubRepoSetupState,
  githubDeviceFlowReducer,
  githubRepoSetupReducer,
  initialGithubDeviceFlowState,
} from "./GitHubConnector.state";

describe("githubDeviceFlowReducer", () => {
  it("tracks the device flow from request to waiting to success", () => {
    const requesting = githubDeviceFlowReducer(initialGithubDeviceFlowState, {
      type: "start",
    });

    expect(requesting).toMatchObject({
      status: "requesting",
      message: "Requesting device code from GitHub...",
      error: null,
    });

    const waiting = githubDeviceFlowReducer(requesting, {
      type: "update",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      message: "Waiting for authorization...",
    });

    expect(waiting).toEqual({
      status: "waiting",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      message: "Waiting for authorization...",
      error: null,
    });

    expect(githubDeviceFlowReducer(waiting, { type: "success" })).toEqual({
      status: "connected",
      userCode: null,
      verificationUri: null,
      message: "Successfully connected to GitHub!",
      error: null,
    });
  });

  it("clears user-facing device code on error", () => {
    const waiting = githubDeviceFlowReducer(initialGithubDeviceFlowState, {
      type: "update",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
    });

    expect(
      githubDeviceFlowReducer(waiting, {
        type: "error",
        error: "Authorization expired.",
      }),
    ).toEqual({
      status: "error",
      userCode: null,
      verificationUri: null,
      message: null,
      error: "Authorization expired.",
    });
  });
});

describe("githubRepoSetupReducer", () => {
  it("switches setup modes", () => {
    const initial = getInitialGitHubRepoSetupState("My App");

    expect(
      githubRepoSetupReducer(initial, {
        type: "set-mode",
        mode: "existing",
      }),
    ).toMatchObject({
      mode: "existing",
    });
  });

  it("selects a default branch after loading branches", () => {
    const initial = getInitialGitHubRepoSetupState("My App");

    expect(
      githubRepoSetupReducer(initial, {
        type: "branches-loaded",
        branches: [
          { name: "develop", commit: { sha: "1" } },
          { name: "main", commit: { sha: "2" } },
        ],
      }),
    ).toMatchObject({
      selectedBranch: "main",
      branchInputMode: "select",
      customBranchName: "",
    });
  });

  it("clears availability feedback when the repo name changes", () => {
    const initial = getInitialGitHubRepoSetupState("My App");
    const unavailable = githubRepoSetupReducer(initial, {
      type: "repo-check-succeeded",
      available: false,
      error: "Already exists",
    });

    expect(
      githubRepoSetupReducer(unavailable, {
        type: "set-repo-name",
        name: "next-name",
      }),
    ).toMatchObject({
      repoName: "next-name",
      repoAvailable: null,
      repoCheckError: null,
    });
  });
});
