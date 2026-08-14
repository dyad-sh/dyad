import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Library's tabs are its navigation.
 *
 * The Stock Images gallery was first added to LibraryList, a sidebar component
 * nothing renders, so the feature shipped with no way to reach it. These check
 * that a tab exists for every filter and that the page actually renders each
 * one, which is what "reachable" means here.
 */

const root = process.cwd();

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(root, ...segments), "utf8");
}

const tabs = read("src", "components", "LibraryFilterTabs.tsx");
const page = read("src", "pages", "library-home.tsx");

/** The keys in FilterType. */
function filterTypes(): string[] {
  const declaration = tabs.match(/export type FilterType =([\s\S]*?);/);
  expect(declaration, "FilterType is still declared as a union").toBeTruthy();
  return [...declaration![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("library tabs", () => {
  const types = filterTypes();

  it("offers a tab for every filter", () => {
    const offered = [...tabs.matchAll(/key:\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect([...types].sort()).toEqual([...offered].sort());
  });

  it("includes stock images", () => {
    expect(types).toContain("stock");
  });

  for (const type of types) {
    it(`the page handles the ${type} filter`, () => {
      expect(page).toContain(`"${type}"`);
    });
  }

  it("renders the stock gallery rather than only naming it", () => {
    expect(page).toContain("<StockImageGallery />");
    expect(page).toContain(
      'import { StockImageGallery } from "@/components/library/StockImageGallery"',
    );
  });
});
