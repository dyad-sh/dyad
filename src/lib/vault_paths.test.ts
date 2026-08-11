import { describe, expect, it } from "vitest";

import {
  VaultPathError,
  resolveInsideVault,
  vaultBreadcrumbs,
  vaultParentPath,
  vaultRelativePath,
} from "./vault_paths";

const ROOT = "/Users/someone/Vault";

describe("vault path confinement", () => {
  it("resolves a folder inside the vault", () => {
    expect(resolveInsideVault(ROOT, "Media/Images")).toBe(
      `${ROOT}/Media/Images`,
    );
    expect(resolveInsideVault(ROOT, "")).toBe(ROOT);
  });

  it("refuses to escape the vault", () => {
    // The whole reason this module exists: the renderer chooses the path.
    for (const attempt of [
      "..",
      "../",
      "../../etc/passwd",
      "Media/../../..",
      "Media/../../Documents",
      "./../secrets",
    ]) {
      expect(
        () => resolveInsideVault(ROOT, attempt),
        `"${attempt}" was allowed out of the vault`,
      ).toThrow(VaultPathError);
    }
  });

  it("refuses absolute paths", () => {
    expect(() => resolveInsideVault(ROOT, "/etc/passwd")).toThrow(
      VaultPathError,
    );
    // Including one that happens to point inside: the contract is relative.
    expect(() => resolveInsideVault(ROOT, `${ROOT}/Media`)).toThrow(
      VaultPathError,
    );
  });

  it("refuses a sibling folder whose name starts with the vault's", () => {
    // A prefix comparison without the separator would let this through.
    expect(() => resolveInsideVault(ROOT, "../Vault-backup")).toThrow(
      VaultPathError,
    );
  });

  it("refuses a null byte", () => {
    expect(() => resolveInsideVault(ROOT, "Media\0/Images")).toThrow(
      VaultPathError,
    );
  });

  it("refuses when no vault is connected", () => {
    expect(() => resolveInsideVault("", "Media")).toThrow(VaultPathError);
  });

  it("reports paths relative to the vault", () => {
    expect(vaultRelativePath(ROOT, `${ROOT}/Media/Images`)).toBe(
      "Media/Images",
    );
    expect(vaultRelativePath(ROOT, ROOT)).toBe("");
  });

  it("walks back up", () => {
    expect(vaultParentPath("Media/Images/Generated")).toBe("Media/Images");
    expect(vaultParentPath("Media")).toBe("");
    expect(vaultParentPath("")).toBeNull();
  });

  it("builds a breadcrumb for each level", () => {
    expect(vaultBreadcrumbs("Media/Images/Generated")).toEqual([
      { name: "Media", path: "Media" },
      { name: "Images", path: "Media/Images" },
      { name: "Generated", path: "Media/Images/Generated" },
    ]);
    expect(vaultBreadcrumbs("")).toEqual([]);
  });
});
