import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ThemesPage from "@/pages/themes";

export const themesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/themes",
  component: ThemesPage,
});
