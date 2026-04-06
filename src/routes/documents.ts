import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents",
  component: lazyRouteComponent(() => import("@/pages/documents")),
});

export const documentEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/documents/$docId",
  component: lazyRouteComponent(() => import("@/pages/document-editor")),
});
