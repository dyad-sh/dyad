import { Route } from "@tanstack/react-router";
import JarvisPage from "../pages/jarvis";
import { rootRoute } from "./root";

export const jarvisRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/jarvis",
  component: JarvisPage,
});
