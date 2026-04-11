import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import CalendarPage from "../pages/CalendarPage";

export const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  component: CalendarPage,
});
