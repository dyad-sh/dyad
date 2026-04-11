import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import CICDBuilderPage from "../pages/CICDBuilderPage";

export const cicdBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cicd-builder",
  component: CICDBuilderPage,
});
