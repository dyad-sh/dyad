import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LibraryPage from "@/pages/library";

export const promptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/prompts",
  component: LibraryPage,
});
