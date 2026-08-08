import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "@/routes/root";
import { ProviderSettingsPage } from "@/components/settings/ProviderSettingsPage";
import { ParticleBackground } from "@/components/home/ParticleBackground";

interface ProviderSettingsParams {
  provider: string;
}

export const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/providers/$provider",
  params: {
    parse: (params: { provider: string }): ProviderSettingsParams => ({
      provider: params.provider,
    }),
  },
  component: function ProviderSettingsRouteComponent() {
    const { provider } = providerSettingsRoute.useParams();

    return (
      <div className="settings-jarvis home-jarvis no-app-region-drag relative flex min-h-full w-full flex-1 flex-col overflow-x-hidden">
        <ParticleBackground className="z-0" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <ProviderSettingsPage provider={provider} />
        </div>
      </div>
    );
  },
});
