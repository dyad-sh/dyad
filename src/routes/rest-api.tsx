import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import RestApiPage from "../pages/RestApiPage";

export const restApiRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/rest-api",
    component: RestApiPage,
});
