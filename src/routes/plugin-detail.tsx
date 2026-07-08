import { createRoute } from "@tanstack/react-router";
import { PluginDetailPage } from "@/components/plugins/PluginDetailPage";
import { rootRoute } from "./root";

export const pluginDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plugins/$serverId",
  params: {
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
