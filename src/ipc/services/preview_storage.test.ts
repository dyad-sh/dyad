import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
const mocks = vi.hoisted(() => ({
  clear: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("electron", () => ({
  session: {
    defaultSession: {
      clearData: mocks.clear,
      cookies: { get: mocks.get, remove: mocks.remove },
    },
  },
}));
import {
  clearPreviewNamespacedCookies,
  clearPreviewStorage,
} from "./preview_storage";

describe("recording storage cleanup", () => {
  beforeEach(() => vi.clearAllMocks());
  it("clears only the selected origin and exact hostname cookies, including other paths/ports", async () => {
    mocks.get.mockResolvedValue([
      { name: "session", domain: "app-42.localhost", path: "/", secure: true },
      {
        name: "session",
        domain: ".app-42.localhost",
        path: "/auth",
        secure: false,
      },
      { name: "session", domain: "app-43.localhost", path: "/" },
      { name: "session", domain: "child.app-42.localhost", path: "/" },
      { name: "legacy", domain: "localhost", path: "/" },
      {
        name: "dyad-a7.session",
        domain: "app-42.localhost",
        path: "/",
        httpOnly: true,
      },
      {
        name: "__Host-dyad-a7.session",
        domain: "app-42.localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ]);
    await clearPreviewStorage("http://app-42.localhost:42142/screen", 42);
    expect(mocks.clear).toHaveBeenCalledWith({
      origins: ["http://app-42.localhost:42142"],
      originMatchingMode: "origin-in-all-contexts",
      dataTypes: ["localStorage", "indexedDB", "serviceWorkers", "cache"],
    });
    expect(mocks.get).toHaveBeenCalledWith({ domain: "app-42.localhost" });
    expect(mocks.remove.mock.calls).toEqual([
      ["https://app-42.localhost:42142/", "session"],
      ["http://app-42.localhost:42142/auth", "session"],
      ["http://app-42.localhost:42142/", "dyad-a7.session"],
      ["https://app-42.localhost:42142/", "__Host-dyad-a7.session"],
    ]);
  });
  it("clears ordinary localhost storage, its shared cookies, and only this app's namespaced cookies", async () => {
    mocks.get.mockResolvedValue([
      { name: "session", domain: "localhost", path: "/" },
      { name: "session", domain: "app-42.localhost", path: "/" },
      {
        name: "dyad-a1.__Secure_neon-auth.session_token",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "dyad-a12.__Secure_neon-auth.session_token",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      { name: "dyad-a2.sid", domain: ".localhost", path: "/", httpOnly: true },
      {
        name: "__Host-dyad-a1.sid",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "__Host-dyad-a2.sid",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ]);
    await clearPreviewStorage("http://localhost:42142", 1);
    expect(mocks.clear).toHaveBeenCalledWith({
      origins: ["http://localhost:42142"],
      originMatchingMode: "origin-in-all-contexts",
      dataTypes: ["localStorage", "indexedDB", "serviceWorkers", "cache"],
    });
    expect(mocks.remove.mock.calls).toEqual([
      ["http://localhost:42142/", "session"],
      ["https://localhost:42142/", "dyad-a1.__Secure_neon-auth.session_token"],
      ["https://localhost:42142/", "__Host-dyad-a1.sid"],
    ]);
  });

  it.each([
    "not a URL",
    "https://app-42.localhost:42142",
    "http://localhost.evil:42142",
    "http://app-42.localhost.evil:42142",
    "http://child.app-42.localhost:42142",
  ])("refuses ambiguous cleanup for %s", async (origin) => {
    await expect(clearPreviewStorage(origin, 42)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("refuses cleanup without a valid app ID", async () => {
    await expect(
      clearPreviewStorage("http://localhost:42142", 0),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Validation });
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});

describe("shared preview session cookie cleanup", () => {
  // The sweep runs once per process, so each test loads a fresh module.
  const load = async () =>
    (await import("./preview_storage")).clearSharedPreviewSessionCookies;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("removes only unprefixed HttpOnly cookies on shared localhost", async () => {
    mocks.get.mockResolvedValue([
      {
        name: "__Secure_neon-auth.session_token",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      { name: "sid", domain: ".localhost", path: "/api", httpOnly: true },
      {
        name: "dyad-a1.__Secure_neon-auth.session_token",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      { name: "theme", domain: "localhost", path: "/", httpOnly: false },
      {
        name: "__Host-dyad-a1.session",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "session",
        domain: "app-42.localhost",
        path: "/",
        httpOnly: true,
      },
    ]);
    await (
      await load()
    )();
    expect(mocks.get).toHaveBeenCalledWith({ domain: "localhost" });
    expect(mocks.remove.mock.calls).toEqual([
      ["https://localhost/", "__Secure_neon-auth.session_token"],
      ["http://localhost/api", "sid"],
    ]);
  });

  it("sweeps once per process and retries after a failure", async () => {
    const clear = await load();
    mocks.get.mockRejectedValueOnce(new Error("cookie store unavailable"));
    await expect(clear()).rejects.toThrow("cookie store unavailable");
    mocks.get.mockResolvedValue([]);
    await clear();
    await clear();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight sweep and waits for every deletion before admitting proxies", async () => {
    const clear = await load();
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    mocks.remove.mockReturnValueOnce(removal);
    mocks.get.mockResolvedValue([
      { name: "sid", domain: "localhost", path: "/", httpOnly: true },
    ]);
    const first = clear();
    const second = clear();
    expect(second).toBe(first);
    let completed = false;
    void first.then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(completed).toBe(false);
    finishRemoval();
    await Promise.all([first, second]);
    await clear();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});

describe("deleted app preview cookie cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes only that app's namespaced HttpOnly localhost cookies", async () => {
    mocks.get.mockResolvedValue([
      {
        name: "dyad-a1.__Secure_neon-auth.session_token",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "dyad-a1.sid",
        domain: ".localhost",
        path: "/api",
        httpOnly: true,
      },
      { name: "dyad-a1.theme", domain: "localhost", path: "/" },
      {
        name: "__Host-dyad-a1.sid",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "__Host-dyad-a12.sid",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "dyad-a12.sid",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      { name: "sid", domain: "localhost", path: "/", httpOnly: true },
      {
        name: "dyad-a1.sid",
        domain: "app-1.localhost",
        path: "/",
        httpOnly: true,
      },
    ]);
    await clearPreviewNamespacedCookies(1);
    expect(mocks.get).toHaveBeenCalledWith({ domain: "localhost" });
    expect(mocks.remove.mock.calls).toEqual([
      ["https://localhost/", "dyad-a1.__Secure_neon-auth.session_token"],
      ["http://localhost/api", "dyad-a1.sid"],
      ["https://localhost/", "__Host-dyad-a1.sid"],
    ]);
  });
});
