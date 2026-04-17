import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import React from "react";

const CreateAssetPage = React.lazy(() => import("@/pages/create-asset"));

export const createAssetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/create-asset",
  component: CreateAssetPage,
});
