import { Route } from "@tanstack/react-router";
import DataSourcesPage from "../pages/data-sources";
import { rootRoute } from "./root";

/** Connected external databases MyMeta can read. */
export const dataSourcesRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/data-sources",
  component: DataSourcesPage,
});
