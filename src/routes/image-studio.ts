import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import ImageStudioPage from "@/pages/ImageStudioPage";

export const imageStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/image-studio",
  component: ImageStudioPage,
});
