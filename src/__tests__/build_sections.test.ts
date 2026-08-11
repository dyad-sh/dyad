import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILD_CATEGORIES,
  BUILD_TOOLS,
  buildToolsInCategory,
  findBuildCategory,
} from "@/lib/build_sections";
import { screenForPath } from "@/lib/workspace_screens";

/**
 * Build is a container that is meant to grow, so the tests guard the shape
 * rather than today's contents.
 *
 * The one that matters most asserts that every listed tool opens a route that
 * exists. The failure this section invites is a card for a tool somebody
 * intends to write: it looks like progress, reads as a feature, and opens
 * nothing.
 */

const declaredRoutePaths = (): Set<string> => {
  const dir = path.join(process.cwd(), "src", "routes");
  const paths = new Set<string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      for (const match of fs
        .readFileSync(full, "utf8")
        .matchAll(/path:\s*"([^"]+)"/g)) {
        paths.add(match[1]);
      }
    }
  };
  walk(dir);
  return paths;
};

describe("Build section", () => {
  it("lists no tool that does not exist", () => {
    const routes = declaredRoutePaths();
    for (const tool of BUILD_TOOLS) {
      expect(
        routes.has(tool.route),
        `"${tool.title}" points at ${tool.route}, which no route declares`,
      ).toBe(true);
    }
  });

  it("puts every tool in a real category", () => {
    for (const tool of BUILD_TOOLS) {
      expect(
        findBuildCategory(tool.category),
        `"${tool.title}" is in unknown category "${tool.category}"`,
      ).toBeDefined();
    }
  });

  it("has the three disciplines and nothing from software", () => {
    expect(BUILD_CATEGORIES.map((category) => category.id)).toEqual([
      "electronics",
      "mechanical",
      "fabrication",
    ]);
  });

  it("keeps Assembler, under Mechanical", () => {
    // The whole of the old Engineering section. Losing it in a rename is the
    // regression this test exists for.
    const assembler = BUILD_TOOLS.find((tool) => tool.id === "assembler");
    expect(assembler?.route).toBe("/assembler3d");
    expect(buildToolsInCategory("mechanical")).toContainEqual(assembler);
  });

  it("gives every category its own route and screen", () => {
    for (const category of BUILD_CATEGORIES) {
      expect(category.route).toBe(`/build/${category.id}`);
      expect(
        screenForPath(category.route)?.title,
        `${category.label} opens an untitled tab`,
      ).toBe(category.label);
    }
  });

  it("keeps the retired Engineering path working", () => {
    // Renamed, not removed. Existing links must still land somewhere real.
    expect(declaredRoutePaths().has("/engineering")).toBe(true);
    expect(screenForPath("/engineering")).toBeDefined();
  });
});
