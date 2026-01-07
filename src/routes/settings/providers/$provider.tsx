import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "@/routes/root";
import { ProviderSettingsPage } from "@/components/settings/ProviderSettingsPage";

interface ProviderSettingsParams {
  provider: string;
}

export const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/providers/$provider",
  params: {
    parse: (params: { provider: string }): ProviderSettingsParams => ({
      provider: params.provider,
    }),
  },
  component: function ProviderSettingsRouteComponent() {
    const { provider } = providerSettingsRoute.useParams();

    return <ProviderSettingsPage provider={provider} />;
  },
});
