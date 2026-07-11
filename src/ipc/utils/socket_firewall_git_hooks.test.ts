import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gitAddMock, gitCommitMock } = vi.hoisted(() => ({
  gitAddMock: vi.fn(),
  gitCommitMock: vi.fn(),
}));

vi.mock("@/ipc/utils/git_utils", () => ({
  gitAdd: gitAddMock,
  gitCommit: gitCommitMock,
}));

import {
  commitPnpmAllowBuildsConfigIfChanged,
  recordDeniedPnpmBuilds,
} from "./socket_firewall";

describe("pnpm policy Git hook options", () => {
  let appPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-pnpm-hooks-"));
    gitAddMock.mockResolvedValue(undefined);
    gitCommitMock.mockResolvedValue("commit-hash");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it("suppresses hooks for the pre-install allowBuilds policy commit", async () => {
    await commitPnpmAllowBuildsConfigIfChanged(appPath, {
      disableHooks: true,
    });

    expect(gitAddMock).toHaveBeenCalledWith({
      path: appPath,
      filepath: "pnpm-workspace.yaml",
      disableHooks: true,
    });
    expect(gitCommitMock).toHaveBeenCalledWith({
      path: appPath,
      message: "[dyad] approve pnpm dependency builds",
      disableHooks: true,
    });
  });

  it("suppresses hooks for the post-install denied-build policy commit", async () => {
    await recordDeniedPnpmBuilds({
      appPath,
      ignoredBuilds: [
        { packageName: "native-addon", packageSpec: "native-addon@1.0.0" },
      ],
      allowBuildsText: [
        "# dyad-default-allow-builds-schema=v1",
        "# dyad-default-allow-builds-data-version=test",
        "# dyad-default-allow-builds-channel=local",
        "",
      ].join("\n"),
      disableHooks: true,
    });

    expect(gitAddMock).toHaveBeenCalledWith({
      path: appPath,
      filepath: "pnpm-workspace.yaml",
      disableHooks: true,
    });
    expect(gitCommitMock).toHaveBeenCalledWith({
      path: appPath,
      message: "[dyad] record denied pnpm dependency builds",
      disableHooks: true,
    });
  });
});
