import { Route } from "@tanstack/react-router";
import BuildPage, { BuildCategoryPage } from "@/pages/build";
import { BUILD_CATEGORIES } from "@/lib/build_sections";
import { rootRoute } from "./root";

/**
 * /build lists the disciplines; one route per discipline lists its tools.
 *
 * A category having its own route is what makes it linkable, gives it its own
 * tab title, and lets the back control return to Build like any other screen.
 *
 * /engineering keeps its own definition alongside the coding routes and
 * renders Build too. The section was renamed, not removed, and existing links
 * must still land somewhere real.
 */

export const buildIndexRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/build",
  component: BuildPage,
});

export const buildCategoryRoutes = BUILD_CATEGORIES.map(
  (category) =>
    new Route({
      getParentRoute: () => rootRoute,
      path: category.route,
      component: function BuildCategoryRoute() {
        return <BuildCategoryPage category={category.id} />;
      },
    }),
);
