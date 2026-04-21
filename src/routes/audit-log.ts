import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import AuditLogPage from "@/pages/AuditLogPage";

export const auditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-log",
  component: AuditLogPage,
});
