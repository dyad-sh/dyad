// Route: /local-vault/scrape-wizard
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ScrapeWizardPage from "../pages/local-vault/ScrapeWizardPage";

export const scrapeWizardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/scrape-wizard",
  component: ScrapeWizardPage,
});
