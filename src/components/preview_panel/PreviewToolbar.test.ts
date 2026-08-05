import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  computeVisibleTabs,
  exitVersionEventForState,
  getVersionDisplayId,
  VersionDiffContext,
} from "./PreviewToolbar";
import type { Version } from "@/ipc/types";
import type { PreviewSession } from "@/version_preview/state";

const ORDER = ["a", "b", "c", "d", "e", "f"] as const;
const WIDTHS = { a: 100, b: 100, c: 100, d: 100, e: 100, f: 100 };
const GAP = 4;
const OVERFLOW = 28;

const compute = (availableWidth: number, active: string | null = "a") =>
  computeVisibleTabs({
    order: ORDER,
    active,
    widths: WIDTHS,
    availableWidth,
    gap: GAP,
    overflowWidth: OVERFLOW,
  });

describe("computeVisibleTabs", () => {
  it("shows all tabs when they fit", () => {
    // 6 * 100 + 5 * 4 = 620
    expect(compute(620)).toEqual({ visible: [...ORDER], hidden: [] });
  });

  it("collapses trailing tabs into overflow when space runs out", () => {
    // budget = 400 - 28 - 4 = 368 → fits a, b, c (308)
    expect(compute(400, "a")).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });

  it("swaps an overflowed active tab into the last visible slot", () => {
    expect(compute(400, "f")).toEqual({
      visible: ["a", "b", "f"],
      hidden: ["c", "d", "e"],
    });
  });

  it("keeps a visible active tab in its canonical position", () => {
    expect(compute(400, "b")).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });

  it("always shows the active tab even when nothing else fits", () => {
    expect(compute(100, "f")).toEqual({
      visible: ["f"],
      hidden: ["a", "b", "c", "d", "e"],
    });
  });

  it("ignores an active mode that is not in the tab order", () => {
    expect(compute(400, null)).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d", "e", "f"],
    });
  });
});

const previewSession: PreviewSession = {
  appId: 1,
  originBranch: "main",
  targetVersionId: "bbbbbbb",
  checkedOutVersionId: "bbbbbbb",
  exitIntent: { type: "none" },
  selectedDiffFile: null,
  isDiffVisible: true,
};

describe("version diff context", () => {
  it("hides the version label in compact layouts while keeping exit available", () => {
    const onExit = vi.fn();
    render(
      createElement(VersionDiffContext, {
        versionLabel: "Viewing Version 2",
        exitLabel: "Exit",
        exitAriaLabel: "Exit version view",
        onExit,
      }),
    );

    const context = screen.getByTestId("version-diff-context");
    expect(context.textContent).toContain("Viewing Version 2");
    expect(context.className.split(" ")).toContain("min-w-fit");
    expect(
      screen.getByTestId("version-diff-label").className.split(" "),
    ).toEqual(expect.arrayContaining(["hidden", "@md:inline"]));
    expect(
      screen.getByTestId("exit-version-view-button").className.split(" "),
    ).toContain("py-1.5");
    fireEvent.click(screen.getByRole("button", { name: "Exit version view" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("numbers known versions from oldest to newest", () => {
    const versions = [
      { oid: "ccccccc" },
      { oid: "bbbbbbb" },
      { oid: "aaaaaaa" },
    ] as Version[];

    expect(getVersionDisplayId("bbbbbbb", versions)).toBe("2");
    expect(getVersionDisplayId("ddddddd123", versions)).toBe("ddddddd");
  });

  it("closes a read-only diff without starting repository cleanup", () => {
    expect(
      exitVersionEventForState({
        type: "viewing-diff",
        session: { ...previewSession, checkedOutVersionId: null },
      }),
    ).toEqual({ type: "CLOSE_VERSION_DIFF" });
  });

  it("closes an active historical preview through repository cleanup", () => {
    expect(
      exitVersionEventForState({ type: "previewing", session: previewSession }),
    ).toEqual({ type: "CLOSE" });
  });
});
