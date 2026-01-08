import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { ExtensionsPage } from "@/pages/extensions";

export const extensionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/extensions",
  component: ExtensionsPage,
});
