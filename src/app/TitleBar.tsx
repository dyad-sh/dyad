import { useAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
// @ts-ignore
import logo from "../../assets/logo_transparent.png";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { cn } from "@/lib/utils";
export const TitleBar = () => {
  const [selectedAppId] = useAtom(selectedAppIdAtom);
  const { apps } = useLoadApps();
  const { navigate } = useRouter();
  const { settings } = useSettings();

  // Get selected app name
  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const displayText = selectedApp
    ? `App: ${selectedApp.name}`
    : "(no app selected)";

  const handleAppClick = () => {
    if (selectedApp) {
      navigate({ to: "/app-details", search: { appId: selectedApp.id } });
    }
  };

  const isDyadPro = !!settings?.providerSettings?.auto?.apiKey?.value;
  const isDyadProEnabled = settings?.enableDyadPro;

  return (
    <div className="@container z-11 w-full h-11 bg-(--sidebar) absolute top-0 left-0 app-region-drag flex items-center">
      <div className="pl-20"></div>
      <img src={logo} alt="Dyad Logo" className="w-6 h-6 mr-2" />
      <Button
        variant="outline"
        size="sm"
        className={`hidden @md:block no-app-region-drag text-sm font-medium ${
          selectedApp ? "cursor-pointer" : ""
        }`}
        onClick={handleAppClick}
      >
        {displayText}
      </Button>
      {isDyadPro && (
        <Button
          onClick={() => {
            navigate({
              to: providerSettingsRoute.id,
              params: { provider: "auto" },
            });
          }}
          variant="outline"
          className={cn(
            "ml-4 no-app-region-drag h-7 bg-indigo-600 text-white dark:bg-indigo-600 dark:text-white",
            !isDyadProEnabled && "bg-zinc-600 dark:bg-zinc-600"
          )}
          size="sm"
        >
          {isDyadProEnabled ? "Dyad Pro" : "Dyad Pro (disabled)"}
        </Button>
      )}
    </div>
  );
};
