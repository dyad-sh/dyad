import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LibraryHomePage from "@/pages/library-home";

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: LibraryHomePage,
});
