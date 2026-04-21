import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import UserProfilePage from "@/pages/UserProfilePage";

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profile",
  component: UserProfilePage,
});
