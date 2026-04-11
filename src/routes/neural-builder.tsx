import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import NeuralBuilderPage from "../pages/NeuralBuilderPage";

export const neuralBuilderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/neural-builder",
  component: NeuralBuilderPage,
});
