import { describe, expect, it } from "vitest";
import {
  appendGitConfigEnv,
  getDockerModeGitHardeningConfig,
} from "./git_hardening";

describe("appendGitConfigEnv", () => {
  it("starts at index 0 when no config entries exist", () => {
    expect(appendGitConfigEnv({}, [["core.fsmonitor", "false"]])).toEqual({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.fsmonitor",
      GIT_CONFIG_VALUE_0: "false",
    });
  });

  it("appends after existing entries so per-invocation auth survives", () => {
    const env = appendGitConfigEnv(
      {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_1: "Authorization: Basic abc",
        GIT_TERMINAL_PROMPT: "0",
      },
      [["core.hooksPath", "/dev/null"]],
    );
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_VALUE_1).toBe("Authorization: Basic abc");
    expect(env.GIT_CONFIG_KEY_2).toBe("core.hooksPath");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("treats a malformed count as zero", () => {
    const env = appendGitConfigEnv({ GIT_CONFIG_COUNT: "nope" }, [
      ["core.pager", "cat"],
    ]);
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.pager");
  });
});

describe("getDockerModeGitHardeningConfig", () => {
  it("disables the repository-config paths that launch commands", () => {
    const config = Object.fromEntries(
      getDockerModeGitHardeningConfig("darwin"),
    );
    expect(config).toMatchObject({
      "core.fsmonitor": "false",
      "core.hooksPath": "/dev/null",
      "core.sshCommand": "ssh",
      "core.pager": "cat",
      "protocol.ext.allow": "never",
    });
    expect(
      Object.fromEntries(getDockerModeGitHardeningConfig("win32"))[
        "core.hooksPath"
      ],
    ).toBe("NUL");
  });
});
