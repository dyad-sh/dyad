import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LibraryTemplatesPage from "@/pages/library-templates";

export const libraryTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/templates",
  component: LibraryTemplatesPage,
});
