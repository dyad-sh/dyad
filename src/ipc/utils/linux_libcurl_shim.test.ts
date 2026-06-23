import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseLdconfig } from "./linux_libcurl_shim";

const execFileSyncMock = vi.fn();
const fsMock = {
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  symlinkSync: vi.fn(),
  readlinkSync: vi.fn(),
};

vi.mock("node:child_process", () => ({
  default: { execFileSync: (...args: unknown[]) => execFileSyncMock(...args) },
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: (...args: unknown[]) => fsMock.mkdirSync(...args),
    rmSync: (...args: unknown[]) => fsMock.rmSync(...args),
    symlinkSync: (...args: unknown[]) => fsMock.symlinkSync(...args),
    readlinkSync: (...args: unknown[]) => fsMock.readlinkSync(...args),
  },
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/userdata" },
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const GNUTLS_LINE =
  "\tlibcurl-gnutls.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl-gnutls.so.4";
const LIBCURL_LINE =
  "\tlibcurl.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl.so.4";
const LIBCURL_PATH = "/lib/x86_64-linux-gnu/libcurl.so.4";

function setPlatform(platform: NodeJS.Platform, arch: NodeJS.Architecture) {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
}

// computeShimDir caches its result in module state, so import a fresh copy per
// test to exercise it in isolation.
async function loadEnsureLibcurlShim() {
  vi.resetModules();
  return (await import("./linux_libcurl_shim")).ensureLibcurlShim;
}

describe("ensureLibcurlShim", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    fsMock.mkdirSync.mockReset();
    fsMock.rmSync.mockReset();
    fsMock.symlinkSync.mockReset();
    fsMock.readlinkSync.mockReset();
    // Default: a RHEL-like system (gnutls missing, plain libcurl present) with
    // no existing shim symlink.
    execFileSyncMock.mockReturnValue(LIBCURL_LINE);
    fsMock.readlinkSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    setPlatform("linux", "x64");
  });

  afterEach(() => {
    setPlatform(origPlatform, origArch);
  });

  it("returns undefined and touches nothing on non-Linux", async () => {
    setPlatform("darwin", "x64");
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBeUndefined();
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(fsMock.symlinkSync).not.toHaveBeenCalled();
  });

  it("no-ops when libcurl-gnutls.so.4 is already present", async () => {
    execFileSyncMock.mockReturnValue([GNUTLS_LINE, LIBCURL_LINE].join("\n"));
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBeUndefined();
    expect(fsMock.symlinkSync).not.toHaveBeenCalled();
  });

  it("creates a symlink to libcurl.so.4 when the gnutls soname is missing", async () => {
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBe("/userdata/native-shims");
    expect(fsMock.symlinkSync).toHaveBeenCalledWith(
      LIBCURL_PATH,
      "/userdata/native-shims/libcurl-gnutls.so.4",
    );
  });

  it("returns undefined when no libcurl at all is found", async () => {
    execFileSyncMock.mockReturnValue("");
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBeUndefined();
    expect(fsMock.symlinkSync).not.toHaveBeenCalled();
  });

  it("does not recreate the symlink when it already points at the right target", async () => {
    fsMock.readlinkSync.mockReturnValue(LIBCURL_PATH);
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBe("/userdata/native-shims");
    expect(fsMock.rmSync).not.toHaveBeenCalled();
    expect(fsMock.symlinkSync).not.toHaveBeenCalled();
  });

  it("computes once and caches the result across calls", async () => {
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    ensureLibcurlShim();
    ensureLibcurlShim();

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next ldconfig path when the first is unavailable", async () => {
    execFileSyncMock.mockImplementation((bin: string) => {
      if (bin === "/usr/sbin/ldconfig") throw new Error("ENOENT");
      return LIBCURL_LINE;
    });
    const ensureLibcurlShim = await loadEnsureLibcurlShim();

    expect(ensureLibcurlShim()).toBe("/userdata/native-shims");
    expect(execFileSyncMock).toHaveBeenCalledWith("/sbin/ldconfig", ["-p"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  });
});

describe("parseLdconfig", () => {
  it("parses soname -> path entries for the matching arch", () => {
    const output = [
      "1281 libs found in cache `/etc/ld.so.cache'",
      "\tlibcurl.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl.so.4",
      "\tlibcurl-gnutls.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl-gnutls.so.4",
    ].join("\n");

    const libs = parseLdconfig(output, "x86-64");

    expect(libs.get("libcurl.so.4")).toBe("/lib/x86_64-linux-gnu/libcurl.so.4");
    expect(libs.get("libcurl-gnutls.so.4")).toBe(
      "/lib/x86_64-linux-gnu/libcurl-gnutls.so.4",
    );
  });

  it("skips entries whose arch tag does not match (e.g. i386)", () => {
    const output = [
      "\tlibcurl.so.4 (libc6) => /lib/i386-linux-gnu/libcurl.so.4",
      "\tlibcurl.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl.so.4",
    ].join("\n");

    const libs = parseLdconfig(output, "x86-64");

    // The i386 entry must be ignored so we never hand a 32-bit lib to a
    // 64-bit binary.
    expect(libs.get("libcurl.so.4")).toBe("/lib/x86_64-linux-gnu/libcurl.so.4");
  });

  it("keeps the first path listed for a given soname", () => {
    const output = [
      "\tlibcurl.so.4 (libc6,x86-64) => /usr/lib64/libcurl.so.4",
      "\tlibcurl.so.4 (libc6,x86-64) => /usr/local/lib/libcurl.so.4",
    ].join("\n");

    const libs = parseLdconfig(output, "x86-64");

    expect(libs.get("libcurl.so.4")).toBe("/usr/lib64/libcurl.so.4");
  });

  it("includes all matching archs when no arch tag is given", () => {
    const output = [
      "\tlibcurl.so.4 (libc6) => /lib/i386-linux-gnu/libcurl.so.4",
    ].join("\n");

    const libs = parseLdconfig(output, undefined);

    expect(libs.get("libcurl.so.4")).toBe("/lib/i386-linux-gnu/libcurl.so.4");
  });

  it("ignores malformed lines and headers", () => {
    const output = [
      "1281 libs found in cache `/etc/ld.so.cache'",
      "garbage without arrow",
      "\tlibcurl.so.4 (libc6,x86-64) => /lib/x86_64-linux-gnu/libcurl.so.4",
      "",
    ].join("\n");

    const libs = parseLdconfig(output, "x86-64");

    expect(libs.size).toBe(1);
    expect(libs.get("libcurl.so.4")).toBe("/lib/x86_64-linux-gnu/libcurl.so.4");
  });

  it("returns an empty map for empty output", () => {
    expect(parseLdconfig("", "x86-64").size).toBe(0);
  });
});
