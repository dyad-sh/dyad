// Route: /local-vault/data-studio
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import DataStudioPage from "../pages/local-vault/DataStudioPage";

export const dataStudioLocalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/data-studio",
  component: DataStudioPage,
});
