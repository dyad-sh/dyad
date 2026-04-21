import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";
import BackupRestorePage from "@/pages/BackupRestorePage";

export const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backup",
  component: BackupRestorePage,
});
