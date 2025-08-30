
import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/root";
import { homeRoute } from "./routes/home";
import { chatRoute } from "./routes/chat";
import { settingsRoute } from "./routes/settings";
import { providerSettingsRoute } from "./routes/settings/providers/$provider";
import { appDetailsRoute } from "./routes/app-details";
import { hubRoute } from "./routes/hub";
import { libraryRoute } from "./routes/library";
import { landingRoute } from "./routes/landing";
import { ErrorBoundary } from "./components/ErrorBoundary";

const routeTree = rootRoute.addChildren([
  landingRoute,
  homeRoute,
  hubRoute,
  libraryRoute,
  chatRoute,
  appDetailsRoute,
  settingsRoute.addChildren([providerSettingsRoute]),
]);

export const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorBoundary,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
