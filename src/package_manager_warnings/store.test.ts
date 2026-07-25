import { describe, expect, it } from "vitest";
import { PackageManagerWarningStore } from "./store";

describe("PackageManagerWarningStore", () => {
  it("keeps release-age warnings ahead of pnpm migration warnings", () => {
    const store = new PackageManagerWarningStore();
    store.setWarning(1, {
      kind: "pnpm-migration",
      message: "Migrate to pnpm 11",
    });
    store.setWarning(1, {
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
    });
    store.setWarning(1, {
      kind: "pnpm-migration",
      message: "Migrate to pnpm 11",
    });

    expect(store.getSnapshot(1)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
      appId: 1,
    });
  });

  it("lets equal-priority warnings replace the previous warning", () => {
    const store = new PackageManagerWarningStore();
    store.setWarning(1, { kind: "release-age", message: "first" });
    store.setWarning(1, { kind: "release-age", message: "second" });
    expect(store.getSnapshot(1)?.message).toBe("second");
  });

  it("guards dismissed apps until entity disposal", () => {
    const store = new PackageManagerWarningStore();
    store.setWarning(1, { kind: "release-age", message: "first" });
    store.dismiss(1);
    store.setWarning(1, { kind: "release-age", message: "second" });
    expect(store.getSnapshot(1)).toBeUndefined();

    store.clearAllForApp(1);
    store.setWarning(1, { kind: "release-age", message: "third" });
    expect(store.getSnapshot(1)?.message).toBe("third");
  });
});
