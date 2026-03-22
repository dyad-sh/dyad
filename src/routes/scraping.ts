import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const scrapingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scraping",
  component: lazyRouteComponent(() => import("../pages/scraping/ScrapingPage")),
});
