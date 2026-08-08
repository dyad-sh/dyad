import { GiftIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
// @ts-ignore
import openrouterLogo from "../../assets/ai-logos/openrouter-logo.png";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import SetupProviderCard from "@/components/SetupProviderCard";
import { cn } from "@/lib/utils";

export const OpenRouterSetupBanner = ({
  className,
}: {
  className?: string;
}) => {
  const posthog = usePostHog();
  const navigate = useNavigate();
  return (
    <SetupProviderCard
      className={cn("mt-2", className)}
      variant="openrouter"
      onClick={() => {
        posthog.capture("setup-flow:ai-provider-setup:openrouter:click");
        navigate({
          to: providerSettingsRoute.id,
          params: { provider: "openrouter" },
        });
      }}
      tabIndex={0}
      leadingIcon={
        <img src={openrouterLogo} alt="OpenRouter" className="w-4 h-4" />
      }
      title="Setup OpenRouter API Key"
      chip={
        <>
          <GiftIcon className="w-3 h-3" />
          Free models available
        </>
      }
    />
  );
};
