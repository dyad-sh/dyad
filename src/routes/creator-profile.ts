import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import CreatorProfilePage from "@/pages/creator-profile";

export const creatorProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/creator-profile",
  component: CreatorProfilePage,
});
