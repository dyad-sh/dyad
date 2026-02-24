import { describe, expect, it } from "vitest";
import {
  extractRoutesFromReactRouterContent,
  isPreviewNavigableRoutePath,
} from "@/hooks/useParseRouter";

describe("useParseRouter helpers", () => {
  it("filters wildcard route paths from preview navigation", () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    `;

    expect(extractRoutesFromReactRouterContent(content)).toEqual([
      { path: "/", label: "Home" },
      { path: "/about", label: "About" },
    ]);
  });

  it("treats wildcard-containing paths as non-navigable", () => {
    expect(isPreviewNavigableRoutePath("*")).toBe(false);
    expect(isPreviewNavigableRoutePath("/*")).toBe(false);
    expect(isPreviewNavigableRoutePath("/about")).toBe(true);
  });
});
