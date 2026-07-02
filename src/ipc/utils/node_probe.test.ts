import { describe, expect, it } from "vitest";

import {
  getNodeProbeCandidateDirs,
  parseNodeVersion,
  pickNewestNodeCandidate,
} from "./node_probe";

const noSubdirectories = () => [];

describe("parseNodeVersion", () => {
  it("parses versions with and without the v prefix", () => {
    expect(parseNodeVersion("v22.11.0")).toEqual([22, 11, 0]);
    expect(parseNodeVersion("20.1.2")).toEqual([20, 1, 2]);
  });

  it("returns null for non-version strings", () => {
    expect(parseNodeVersion("latest")).toBeNull();
    expect(parseNodeVersion("system")).toBeNull();
  });
});

describe("pickNewestNodeCandidate", () => {
  it("prefers the newest version regardless of order", () => {
    expect(
      pickNewestNodeCandidate([
        { version: "v6.14.0", origin: "stray" },
        { version: "v22.11.0", origin: "installer" },
        { version: "v20.19.0", origin: "nvm" },
      ]),
    ).toEqual({ version: "v22.11.0", origin: "installer" });
  });

  it("ignores unparsable versions and handles empty input", () => {
    expect(
      pickNewestNodeCandidate([{ version: "broken" }, { version: "v18.0.1" }]),
    ).toEqual({ version: "v18.0.1" });
    expect(pickNewestNodeCandidate([])).toBeNull();
  });
});

describe("getNodeProbeCandidateDirs on Windows", () => {
  it("includes installer, nvm-windows, fnm, and volta locations", () => {
    const dirs = getNodeProbeCandidateDirs({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\john\\AppData\\Local",
        APPDATA: "C:\\Users\\john\\AppData\\Roaming",
        NVM_SYMLINK: "C:\\nvm4w\\nodejs",
      },
      homeDir: "C:\\Users\\john",
      listSubdirectories: (dir) =>
        dir === "C:\\Users\\john\\AppData\\Roaming\\fnm\\node-versions"
          ? ["v22.11.0", "v20.10.0"]
          : [],
    });

    expect(dirs).toEqual([
      { binDir: "C:\\Program Files\\nodejs", origin: "nodejs-installer" },
      {
        binDir: "C:\\Users\\john\\AppData\\Local\\Programs\\nodejs",
        origin: "nodejs-installer",
      },
      { binDir: "C:\\nvm4w\\nodejs", origin: "nvm-windows" },
      {
        binDir:
          "C:\\Users\\john\\AppData\\Roaming\\fnm\\node-versions\\v22.11.0\\installation",
        origin: "fnm",
      },
      {
        binDir:
          "C:\\Users\\john\\AppData\\Roaming\\fnm\\node-versions\\v20.10.0\\installation",
        origin: "fnm",
      },
      {
        binDir: "C:\\Users\\john\\AppData\\Local\\Volta\\bin",
        origin: "volta",
      },
    ]);
  });

  it("falls back to default Program Files and dedupes case-insensitively", () => {
    const dirs = getNodeProbeCandidateDirs({
      platform: "win32",
      env: { NVM_SYMLINK: "c:\\program files\\NODEJS" },
      homeDir: "C:\\Users\\john",
      listSubdirectories: noSubdirectories,
    });

    // NVM_SYMLINK points at the same dir as the default installer location,
    // so only the first occurrence is kept.
    expect(dirs).toEqual([
      { binDir: "C:\\Program Files\\nodejs", origin: "nodejs-installer" },
    ]);
  });
});

describe("getNodeProbeCandidateDirs on macOS", () => {
  it("includes homebrew, /usr/local, and version manager dirs", () => {
    const home = "/Users/jane";
    const dirs = getNodeProbeCandidateDirs({
      platform: "darwin",
      env: {},
      homeDir: home,
      listSubdirectories: (dir) => {
        if (dir === `${home}/.nvm/versions/node`) {
          return ["v22.11.0", "v18.20.4", "v20.19.0"];
        }
        if (dir === `${home}/.local/share/mise/installs/node`) {
          return ["22.11.0", "latest"];
        }
        return [];
      },
    });

    expect(dirs).toEqual([
      { binDir: "/opt/homebrew/bin", origin: "homebrew" },
      { binDir: "/usr/local/bin", origin: "system-prefix" },
      // Newest two nvm versions only, newest first.
      { binDir: `${home}/.nvm/versions/node/v22.11.0/bin`, origin: "nvm" },
      { binDir: `${home}/.nvm/versions/node/v20.19.0/bin`, origin: "nvm" },
      // "latest" is not a version directory and is skipped.
      {
        binDir: `${home}/.local/share/mise/installs/node/22.11.0/bin`,
        origin: "mise",
      },
      { binDir: `${home}/.volta/bin`, origin: "volta" },
    ]);
  });

  it("respects NVM_DIR, FNM_DIR, and VOLTA_HOME overrides", () => {
    const dirs = getNodeProbeCandidateDirs({
      platform: "darwin",
      env: {
        NVM_DIR: "/custom/nvm",
        FNM_DIR: "/custom/fnm",
        VOLTA_HOME: "/custom/volta",
      },
      homeDir: "/Users/jane",
      listSubdirectories: (dir) => {
        if (dir === "/custom/nvm/versions/node") {
          return ["v22.0.0"];
        }
        if (dir === "/custom/fnm/node-versions") {
          return ["v21.7.3"];
        }
        return [];
      },
    });

    expect(dirs).toContainEqual({
      binDir: "/custom/nvm/versions/node/v22.0.0/bin",
      origin: "nvm",
    });
    expect(dirs).toContainEqual({
      binDir: "/custom/fnm/node-versions/v21.7.3/installation/bin",
      origin: "fnm",
    });
    expect(dirs).toContainEqual({
      binDir: "/custom/volta/bin",
      origin: "volta",
    });
  });

  it("does not include homebrew arm64 dir on linux", () => {
    const dirs = getNodeProbeCandidateDirs({
      platform: "linux",
      env: {},
      homeDir: "/home/jane",
      listSubdirectories: noSubdirectories,
    });

    expect(dirs.map((dir) => dir.binDir)).not.toContain("/opt/homebrew/bin");
    expect(dirs).toContainEqual({
      binDir: "/usr/local/bin",
      origin: "system-prefix",
    });
  });
});
