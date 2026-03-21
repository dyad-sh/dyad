import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { OpenClawControlPage } from "@/pages/OpenClawControlPage";

export const openclawControlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/openclaw-control",
  component: OpenClawControlPage,
});
