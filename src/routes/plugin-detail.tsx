import { createRoute } from "@tanstack/react-router";
import { PluginDetailPage } from "@/components/plugins/PluginDetailPage";
import { rootRoute } from "./root";

export const pluginDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plugins/$serverId",
  params: {
    // A non-numeric id parses to NaN, which matches no server and
    // lands back on the plugins list via the detail page's unknown-id
    // redirect, the same handling as a stale link to a deleted server.
    parse: (params: { serverId: string }) => ({
      serverId: Number(params.serverId),
    }),
    stringify: (params: { serverId: number }) => ({
      serverId: String(params.serverId),
    }),
  },
  component: function PluginDetailRouteComponent() {
    const { serverId } = pluginDetailRoute.useParams();
    return <PluginDetailPage serverId={serverId} />;
  },
});
