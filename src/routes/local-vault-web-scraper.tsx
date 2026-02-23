// Route: /local-vault/web-scraper
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import WebScraperPage from "../pages/local-vault/WebScraperPage";

export const webScraperRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/web-scraper",
  component: WebScraperPage,
});
