import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import VideoStudioPage from "@/pages/VideoStudioPage";

export const videoStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/video-studio",
  component: VideoStudioPage,
});
