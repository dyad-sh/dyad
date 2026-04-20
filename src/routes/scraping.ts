import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ScrapingPage from "@/pages/scraping/ScrapingPage";

export const scrapingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scraping",
  component: ScrapingPage,
});
