import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import MediaPage from "@/pages/media";

export const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media",
  component: MediaPage,
});
