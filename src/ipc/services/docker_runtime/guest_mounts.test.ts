import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runDockerCliMock } = vi.hoisted(() => ({ runDockerCliMock: vi.fn() }));

vi.mock("./docker_cli", () => ({
  runDockerCli: runDockerCliMock,
  forceRemoveContainer: vi.fn(),
}));

import { prepareGuestMounts, sweepStaleGuestJobs } from "./guest_command";

const ok = (stdout = "") => ({
  code: 0,
  signal: null,
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  aborted: false,
  timedOut: false,
});

describe("sweepStaleGuestJobs", () => {
  it("removes only jobs from other sessions whose owning process has exited", async () => {
    const deadPid = 2_147_483_000; // Far above any real PID.
    runDockerCliMock
      .mockResolvedValueOnce(
        ok(
          [
            `dead1 other-session ${deadPid}`,
            `live1 other-session ${process.pid}`,
            "nolabel1 other-session ",
          ].join("\n"),
        ),
      )
      .mockResolvedValue(ok());

    await sweepStaleGuestJobs();

    const listArgs = runDockerCliMock.mock.calls[0][0] as string[];
    // Docker ignores --format when -q is set; the labels would be lost.
    expect(listArgs).not.toContain("-q");
    expect(listArgs).not.toContain("-aq");
    expect(runDockerCliMock).toHaveBeenCalledWith([
      "rm",
      "-f",
      "dead1",
      "nolabel1",
    ]);
  });
});

describe("prepareGuestMounts", () => {
  let appPath = "";

  beforeEach(() => {
    runDockerCliMock.mockReset();
    runDockerCliMock.mockResolvedValue(ok());
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-mounts-"));
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it("creates the node_modules mount point on the host as the host user", async () => {
    await prepareGuestMounts(
      { appId: 1, hostRoot: appPath, nodeModules: "app-volume" },
      "img",
      undefined,
    );
    expect(fs.statSync(path.join(appPath, "node_modules")).isDirectory()).toBe(
      true,
    );
    expect(runDockerCliMock).not.toHaveBeenCalled();
  });

  it("hands the app's volumes to the host user once per process", async () => {
    const user = { uid: 1234, gid: 5678 };
    const input = {
      appId: 2,
      hostRoot: appPath,
      nodeModules: "in-tree",
    } as const;
    await prepareGuestMounts(input, "img", user);
    await prepareGuestMounts(input, "img", user);

    const chowns = runDockerCliMock.mock.calls.map(
      (call) => call[0] as string[],
    );
    expect(chowns).toEqual([
      expect.arrayContaining([
        "type=volume,source=dyad-nm-2,target=/volume",
        "chown",
        "-R",
        "1234:5678",
      ]),
      expect.arrayContaining([
        "type=volume,source=dyad-playwright-browsers,target=/volume",
      ]),
    ]);
    expect(fs.existsSync(path.join(appPath, "node_modules"))).toBe(false);
  });
});
