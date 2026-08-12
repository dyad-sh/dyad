import { describe, expect, it } from "vitest";

import { collectAncestorDirs, collectUncommittedPaths } from "./FileTree";

const sorted = (paths: ReadonlySet<string>) => [...paths].sort();

describe("collectUncommittedPaths", () => {
  const files = [
    "src/App.tsx",
    "src/newfolder/one.tsx",
    "src/newfolder/nested/two.tsx",
    "src/newfolder2/other.tsx",
    "public/robots.txt",
  ];

  it("keeps ordinary changed files", () => {
    expect(
      sorted(
        collectUncommittedPaths(
          [{ path: "src/App.tsx", status: "modified" }],
          files,
        ),
      ),
    ).toEqual(["src/App.tsx"]);
  });

  it("drops deleted files, which have no row on disk", () => {
    expect(
      collectUncommittedPaths(
        [{ path: "src/Gone.tsx", status: "deleted" }],
        files,
      ),
    ).toEqual(new Set());
  });

  it("expands an untracked directory into the files beneath it", () => {
    // `git status --porcelain` reports a wholly-untracked directory as one
    // entry ending in "/", which matches no row.
    expect(
      sorted(
        collectUncommittedPaths(
          [{ path: "src/newfolder/", status: "added" }],
          files,
        ),
      ),
    ).toEqual(["src/newfolder/nested/two.tsx", "src/newfolder/one.tsx"]);
  });

  it("does not let an untracked directory swallow a sibling with the same prefix", () => {
    const paths = collectUncommittedPaths(
      [{ path: "src/newfolder/", status: "added" }],
      files,
    );
    expect(paths.has("src/newfolder2/other.tsx")).toBe(false);
  });

  it("marks nothing for an untracked directory absent from the file list", () => {
    // A stale file list must not leave a rollup dot over a folder whose
    // children all show nothing.
    expect(
      collectUncommittedPaths([{ path: "src/ghost/", status: "added" }], files),
    ).toEqual(new Set());
  });

  it("keeps the renamed destination, whose row is the one that exists", () => {
    expect(
      sorted(
        collectUncommittedPaths(
          [{ path: "src/App.tsx", status: "renamed" }],
          files,
        ),
      ),
    ).toEqual(["src/App.tsx"]);
  });
});

describe("collectAncestorDirs", () => {
  it("collects every ancestor but not the file itself", () => {
    expect(
      sorted(collectAncestorDirs(new Set(["src/newfolder/nested/two.tsx"]))),
    ).toEqual(["src", "src/newfolder", "src/newfolder/nested"]);
  });

  it("yields nothing for a root-level file", () => {
    expect(collectAncestorDirs(new Set(["README.md"]))).toEqual(new Set());
  });

  it("marks every ancestor exactly once across sibling changes", () => {
    expect(
      sorted(collectAncestorDirs(new Set(["src/a/one.tsx", "src/a/two.tsx"]))),
    ).toEqual(["src", "src/a"]);
  });
});
