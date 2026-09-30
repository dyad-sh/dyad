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
import { clearPreviewStorage } from "./preview_storage";

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
    ]);
    await clearPreviewStorage("http://app-42.localhost:42142/screen");
    expect(mocks.clear).toHaveBeenCalledWith({
      origins: ["http://app-42.localhost:42142"],
      originMatchingMode: "origin-in-all-contexts",
      dataTypes: ["localStorage", "indexedDB", "serviceWorkers", "cache"],
    });
    expect(mocks.get).toHaveBeenCalledWith({ domain: "app-42.localhost" });
    expect(mocks.remove.mock.calls).toEqual([
      ["https://app-42.localhost:42142/", "session"],
      ["http://app-42.localhost:42142/auth", "session"],
    ]);
  });
  it("clears ordinary localhost storage and its shared cookies", async () => {
    mocks.get.mockResolvedValue([
      { name: "session", domain: "localhost", path: "/" },
      { name: "session", domain: "app-42.localhost", path: "/" },
    ]);
    await clearPreviewStorage("http://localhost:42142");
    expect(mocks.clear).toHaveBeenCalledWith({
      origins: ["http://localhost:42142"],
      originMatchingMode: "origin-in-all-contexts",
      dataTypes: ["localStorage", "indexedDB", "serviceWorkers", "cache"],
    });
    expect(mocks.remove.mock.calls).toEqual([
      ["http://localhost:42142/", "session"],
    ]);
  });

  it.each([
    "not a URL",
    "https://app-42.localhost:42142",
    "http://localhost.evil:42142",
    "http://app-42.localhost.evil:42142",
    "http://child.app-42.localhost:42142",
  ])("refuses ambiguous cleanup for %s", async (origin) => {
    await expect(clearPreviewStorage(origin)).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
