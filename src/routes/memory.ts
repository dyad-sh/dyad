import { Route } from "@tanstack/react-router";
import MemoryPage from "@/pages/memory";
import { rootRoute } from "./root";

export const memoryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/memory",
  component: MemoryPage,
});
