import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import LogsPage from "../pages/LogsPage";

export const logsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/logs",
    component: LogsPage,
});
