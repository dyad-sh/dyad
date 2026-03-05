// Route: /local-vault/memory
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import MemoryLearningPage from "../pages/local-vault/MemoryLearningPage";

export const memoryLearningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/local-vault/memory",
  component: MemoryLearningPage,
});
