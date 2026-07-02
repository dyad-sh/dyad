import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import {
  CircleCheck,
  ChevronRight,
  GiftIcon,
  Play,
  Settings,
} from "lucide-react";
import { pendingFirstPromptAtom } from "@/atoms/chatAtoms";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";

import SetupProviderCard from "@/components/SetupProviderCard";

import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePostHog } from "posthog-js/react";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
// @ts-ignore
import logo from "../../assets/logo.svg";
// @ts-ignore
import googleIcon from "../../assets/ai-logos/google-g-icon.svg";
// @ts-ignore
import openrouterLogo from "../../assets/ai-logos/openrouter-logo.png";
import { SetupDyadProButton } from "./ProBanner";

export function SetupBanner({
  variant = "inline",
}: {
  variant?: "inline" | "dialog";
}) {
  const { t } = useTranslation("home");
  const posthog = usePostHog();
  const navigate = useNavigate();
  const hasPendingPrompt = useAtomValue(pendingFirstPromptAtom);
  const { isAnyProviderSetup, isLoading: loading } =
    useLanguageModelProviders();

  const settingsScrollAndNavigateTo = useScrollAndNavigateTo("/settings", {
    behavior: "smooth",
    block: "start",
  });

  const handleGoogleSetupClick = () => {
    posthog.capture("setup-flow:ai-provider-setup:google:click");
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: "google" },
    });
  };

  const handleOpenRouterSetupClick = () => {
    posthog.capture("setup-flow:ai-provider-setup:openrouter:click");
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: "openrouter" },
    });
  };
  const handleDyadProSetupClick = () => {
    posthog.capture("setup-flow:ai-provider-setup:dyad:click");
    ipc.system.openExternalUrl(
      "https://academy.dyad.sh/redirect-to-checkout?trialCode=1PRO30&utm_source=dyad-app&utm_medium=app&utm_campaign=setup-dialog-v2",
    );
  };

  const handleOtherProvidersClick = () => {
    posthog.capture("setup-flow:ai-provider-setup:other:click");
    settingsScrollAndNavigateTo(SECTION_IDS.providers);
  };

  const itemsNeedAction: string[] = [];
  if (!isAnyProviderSetup() && !loading) {
    itemsNeedAction.push("ai-setup");
  }

  if (itemsNeedAction.length === 0) {
    if (variant === "dialog") {
      return null;
    }

    return (
      <h1 className="text-center text-5xl font-bold mb-8 bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-gray-100 dark:to-gray-400 tracking-tight">
        {t("setup.buildNewApp")}
      </h1>
    );
  }

  return (
    <>
      <div
        className={cn(
          "w-full rounded-lg bg-background px-5 py-5",
          variant === "inline" && "mb-6 border border-border shadow-sm",
        )}
      >
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {variant === "dialog"
              ? "You're almost ready to build"
              : "Connect AI to start building"}
          </h2>
          {variant === "dialog" && hasPendingPrompt ? (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm leading-6 text-muted-foreground">
              <CircleCheck
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              Your prompt is saved — it'll send as soon as you're connected.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Dyad uses AI to build your app.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleDyadProSetupClick}
          className="mt-5 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg border border-primary/45 bg-primary/8 p-4 text-left transition-colors hover:bg-primary/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:bg-primary/15 dark:hover:bg-primary/20"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <img src={logo} alt="Dyad Logo" className="size-6" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-primary">
                Start free Dyad Pro trial
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                No API keys. Access leading models instantly.
              </p>
            </div>
          </div>
          <Button as="span" size="sm" className="shrink-0">
            Start
          </Button>
        </button>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            Or use your own API key
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <ProviderOptionButton
              label="Google"
              chip="Free"
              onClick={handleGoogleSetupClick}
              icon={<img src={googleIcon} alt="Google" className="size-4" />}
            />
            <ProviderOptionButton
              label="OpenRouter"
              chip="Free"
              onClick={handleOpenRouterSetupClick}
              icon={
                <img
                  src={openrouterLogo}
                  alt="OpenRouter"
                  className="size-4 dark:invert"
                />
              }
            />
            <ProviderOptionButton
              label="Other providers"
              onClick={handleOtherProvidersClick}
              icon={<Settings className="size-4 text-muted-foreground" />}
            />
          </div>
        </div>

        <div className="mt-4 flex w-full flex-col items-center justify-around gap-2 text-xs sm:flex-row">
          <SetupDyadProButton />
          <button
            type="button"
            onClick={() => {
              ipc.system.openExternalUrl(
                "https://www.youtube.com/watch?v=rgdNoHLaRN4",
              );
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-muted-foreground transition-colors hover:text-primary hover:underline"
          >
            <span className="inline-flex h-3.5 w-4 items-center justify-center rounded-[3px] bg-red-600 text-white">
              <Play
                aria-hidden="true"
                className="ml-0.5 size-2 fill-current stroke-current"
              />
            </span>
            Watch the walkthrough
          </button>
        </div>
      </div>
    </>
  );
}

function ProviderOptionButton({
  label,
  icon,
  chip,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  chip?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-(--background-lighter) px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {chip ? (
        <span className="shrink-0 rounded-full border border-emerald-600/25 bg-emerald-500/10 px-1.5 py-px text-[11px] font-semibold text-emerald-700 dark:border-emerald-400/25 dark:text-emerald-300">
          {chip}
        </span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

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
        <img
          src={openrouterLogo}
          alt="OpenRouter"
          className="w-4 h-4 dark:invert"
        />
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
