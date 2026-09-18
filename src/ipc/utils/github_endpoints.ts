import { IS_TEST_BUILD } from "./test_utils";

/**
 * Where GitHub lives, for the main process.
 *
 * Test builds point every endpoint at the fake server so the device flow,
 * the REST API and git-over-HTTP all hit the same process. Kept apart from
 * the handlers so consumers that only need a URL (Coolify, the remote
 * resolver) do not have to import the whole handler module.
 */
function isGitHubTestBuild() {
  return IS_TEST_BUILD || process.env.E2E_TEST_BUILD === "true";
}

function getGitHubTestServerBase() {
  return `http://localhost:${process.env.FAKE_LLM_PORT || "3500"}`;
}

export function getGitHubDeviceCodeUrl() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/login/device/code`
    : "https://github.com/login/device/code";
}

export function getGitHubAccessTokenUrl() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/login/oauth/access_token`
    : "https://github.com/login/oauth/access_token";
}

export function getGitHubApiBase() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/api`
    : "https://api.github.com";
}

/** Credential-free base for HTTPS clone and push URLs. */
export function getGitHubGitBase() {
  return isGitHubTestBuild()
    ? `${getGitHubTestServerBase()}/github/git`
    : "https://github.com";
}

/**
 * Host used in SSH clone URLs handed to third parties (Coolify). Not
 * redirected in test builds: nothing in a test ever connects over SSH, and the
 * fake Coolify only records the string it was given.
 */
export const GITHUB_SSH_HOST = "github.com";
