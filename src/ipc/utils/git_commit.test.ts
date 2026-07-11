import { describe, expect, it, vi } from "vitest";

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));

vi.mock("dugite", () => ({ exec }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ enableNativeGit: true })),
}));
vi.mock("../handlers/github_handlers", () => ({
  getGithubUser: vi.fn().mockResolvedValue(null),
}));

import { gitCommit } from "./git_utils";

describe("gitCommit", () => {
  it.each([
    { noVerify: undefined, expected: ["commit", "-m", "message"] },
    { noVerify: false, expected: ["commit", "-m", "message"] },
    { noVerify: true, expected: ["commit", "-m", "message", "--no-verify"] },
  ])("adds --no-verify only when requested", async ({ noVerify, expected }) => {
    exec
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "commit-hash\n", stderr: "" });

    await expect(
      gitCommit({ path: "/test/app", message: "message", noVerify }),
    ).resolves.toBe("commit-hash");

    expect(exec).toHaveBeenNthCalledWith(
      1,
      ["-c", "user.name=[dyad]", "-c", "user.email=git@dyad.sh", ...expected],
      "/test/app",
      undefined,
    );
    exec.mockReset();
  });
});
