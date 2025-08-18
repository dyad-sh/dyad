import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LibraryPage from "@/pages/library";

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: LibraryPage,
});
