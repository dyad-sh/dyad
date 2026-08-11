import { Route } from "@tanstack/react-router";
import BuildPage from "@/pages/build";
import {
  BUILD_CATEGORIES,
  DEFAULT_BUILD_CATEGORY,
  type BuildCategoryId,
} from "@/lib/build_sections";
import { rootRoute } from "./root";

/**
 * One route per Build category, so a category is linkable, keeps its own tab
 * title, and works with the back control like every other screen.
 *
 * /engineering keeps its own definition alongside the coding routes and
 * renders Build too. The section was renamed, not removed, and existing links
 * must still land somewhere real.
 */

function routeForCategory(category: BuildCategoryId, path: string) {
  return new Route({
    getParentRoute: () => rootRoute,
    path,
    component: function BuildCategoryRoute() {
      return <BuildPage category={category} />;
    },
  });
}

export const buildIndexRoute = routeForCategory(
  DEFAULT_BUILD_CATEGORY,
  "/build",
);

export const buildCategoryRoutes = BUILD_CATEGORIES.map((category) =>
  routeForCategory(category.id, category.route),
);
