import { createRootRoute, Outlet } from "@tanstack/react-router";
import Layout from "../app/layout";
import { useNotificationHandler } from "../hooks/useNotificationHandler";

export const rootRoute = createRootRoute({
  // Named (not anonymous) so the rules-of-hooks lint can see this is a
  // component and allow the hook call below.
  component: function RootRouteComponent() {
    useNotificationHandler();
    return (
      <Layout>
        <Outlet />
      </Layout>
    );
  },
});
