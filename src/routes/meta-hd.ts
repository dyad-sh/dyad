import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";
import MetaHdPage from "@/pages/meta-hd/MetaHdPage";

export const metaHdRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/meta-hd",
  component: MetaHdPage,
});
