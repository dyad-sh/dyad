import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DatasetPage from "../pages/datasets";

export const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/datasets",
  component: DatasetPage,
});
