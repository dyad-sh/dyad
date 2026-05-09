import { createRootRoute, Outlet } from "@tanstack/react-router";
import Layout from "../app/layout";
import { useNotificationHandler } from "../hooks/useNotificationHandler";

export const rootRoute = createRootRoute({
  component: () => {
    useNotificationHandler();
    return (
      <Layout>
        <Outlet />
      </Layout>
    );
  },
});
