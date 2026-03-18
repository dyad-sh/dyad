import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { SystemServicesPage } from "@/pages/SystemServicesPage";

export const systemServicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system-services",
  component: SystemServicesPage,
});
