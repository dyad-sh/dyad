import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DataSovereigntyPage from "@/pages/data-sovereignty";

export const dataSovereigntyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/data-sovereignty",
  component: DataSovereigntyPage,
});
