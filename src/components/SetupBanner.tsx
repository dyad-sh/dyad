import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  GiftIcon,
  Sparkles,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  Settings,
  GlobeIcon,
} from "lucide-react";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";

import SetupProviderCard from "@/components/SetupProviderCard";

import { useState, useEffect, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NodeSystemInfo } from "@/ipc/ipc_types";
import { usePostHog } from "posthog-js/react";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
// @ts-ignore
import logo from "../../assets/logo.svg";

type NodeInstallStep =
  | "install"
  | "waiting-for-continue"
  | "continue-processing"
  | "finished-checking";

export function SetupBanner() {
  const posthog = usePostHog();
  const navigate = useNavigate();
  const { isAnyProviderSetup, isLoading: loading } =
    useLanguageModelProviders();
  const [nodeSystemInfo, setNodeSystemInfo] = useState<NodeSystemInfo | null>(
    null,
  );
  const [nodeCheckError, setNodeCheckError] = useState<boolean>(false);
  const [nodeInstallStep, setNodeInstallStep] =
    useState<NodeInstallStep>("install");
  const checkNode = useCallback(async () => {
    try {
      setNodeCheckError(false);
      const status = await IpcClient.getInstance().getNodejsStatus();
      setNodeSystemInfo(status);
    } catch (error) {
      console.error("Failed to check Node.js status:", error);
      setNodeSystemInfo(null);
      setNodeCheckError(true);
    }
  }, [setNodeSystemInfo, setNodeCheckError]);

  useEffect(() => {
    checkNode();
  }, [checkNode]);

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
    IpcClient.getInstance().openExternalUrl(
      "https://www.dyad.sh/pro?utm_source=dyad-app&utm_medium=app&utm_campaign=setup-banner",
    );
  };

  const handleOtherProvidersClick = () => {
    posthog.capture("setup-flow:ai-provider-setup:other:click");
    settingsScrollAndNavigateTo("provider-settings");
  };

  const handleNodeInstallClick = useCallback(async () => {
    posthog.capture("setup-flow:start-node-install-click");
    setNodeInstallStep("waiting-for-continue");
    IpcClient.getInstance().openExternalUrl(nodeSystemInfo!.nodeDownloadUrl);
  }, [nodeSystemInfo, setNodeInstallStep]);

  const finishNodeInstall = useCallback(async () => {
    posthog.capture("setup-flow:continue-node-install-click");
    setNodeInstallStep("continue-processing");
    await IpcClient.getInstance().reloadEnvPath();
    await checkNode();
    setNodeInstallStep("finished-checking");
  }, [checkNode, setNodeInstallStep]);

  // We only check for node version because pnpm is not required for the app to run.
  const isNodeSetupComplete = Boolean(nodeSystemInfo?.nodeVersion);

  const itemsNeedAction: string[] = [];
  if (!isNodeSetupComplete && nodeSystemInfo) {
    itemsNeedAction.push("node-setup");
  }
  if (!isAnyProviderSetup() && !loading) {
    itemsNeedAction.push("ai-setup");
  }

  if (itemsNeedAction.length === 0) {
    return (
      <h1 className="text-center text-5xl font-bold mb-8 bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600 dark:from-gray-100 dark:to-gray-400 tracking-tight">
        Build your dream app
      </h1>
    );
  }

  const bannerClasses = cn(
    "w-full mb-6 border rounded-xl shadow-sm overflow-hidden",
    "border-zinc-200 dark:border-zinc-700",
  );

  const getStatusIcon = (isComplete: boolean, hasError: boolean = false) => {
    if (hasError) {
      return <XCircle className="w-5 h-5 text-red-500" />;
    }
    return isComplete ? (
      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500" />
    ) : (
      <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
    );
  };

  return (
    <>
      <p className="text-xl text-zinc-700 dark:text-zinc-300 p-4">Setup Dyad</p>
      <div className={bannerClasses}>
        <Accordion
          type="multiple"
          className="w-full"
          defaultValue={itemsNeedAction}
        >
          <AccordionItem
            value="node-setup"
            className={cn(
              nodeCheckError
                ? "bg-red-50 dark:bg-red-900/30"
                : isNodeSetupComplete
                  ? "bg-green-50 dark:bg-green-900/30"
                  : "bg-yellow-50 dark:bg-yellow-900/30",
            )}
          >
            <AccordionTrigger className="px-4 py-3 transition-colors w-full hover:no-underline">
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  {getStatusIcon(isNodeSetupComplete, nodeCheckError)}
                  <span className="font-medium text-sm">
                    1. Install Node.js (App Runtime)
                  </span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pt-2 pb-4 bg-white dark:bg-zinc-900 border-t border-inherit">
              {nodeCheckError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  Error checking Node.js status. Try installing Node.js.
                </p>
              )}
              {isNodeSetupComplete ? (
                <p className="text-sm">
                  Node.js ({nodeSystemInfo!.nodeVersion}) installed.{" "}
                  {nodeSystemInfo!.pnpmVersion && (
                    <span className="text-xs text-gray-500">
                      {" "}
                      (optional) pnpm ({nodeSystemInfo!.pnpmVersion}) installed.
                    </span>
                  )}
                </p>
              ) : (
                <div className="text-sm">
                  <p>Node.js is required to run apps locally.</p>
                  {nodeInstallStep === "waiting-for-continue" && (
                    <p className="mt-1">
                      After you have installed Node.js, click "Continue". If the
                      installer didn't work, try{" "}
                      <a
                        className="text-blue-500 dark:text-blue-400 hover:underline"
                        onClick={() => {
                          IpcClient.getInstance().openExternalUrl(
                            "https://nodejs.org/en/download",
                          );
                        }}
                      >
                        more download options
                      </a>
                      .
                    </p>
                  )}
                  <NodeInstallButton
                    nodeInstallStep={nodeInstallStep}
                    handleNodeInstallClick={handleNodeInstallClick}
                    finishNodeInstall={finishNodeInstall}
                  />
                </div>
              )}
              <NodeJsHelpCallout />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="ai-setup"
            className={cn(
              isAnyProviderSetup()
                ? "bg-green-50 dark:bg-green-900/30"
                : "bg-yellow-50 dark:bg-yellow-900/30",
            )}
          >
            <AccordionTrigger
              className={cn(
                "px-4 py-3 transition-colors w-full hover:no-underline",
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  {getStatusIcon(isAnyProviderSetup())}
                  <span className="font-medium text-sm">
                    2. Setup AI Model Access
                  </span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pt-2 pb-4 bg-white dark:bg-zinc-900 border-t border-inherit">
              <p className="text-sm mb-3">
                Connect your preferred AI provider to start generating code.
              </p>
              <SetupProviderCard
                variant="google"
                onClick={handleGoogleSetupClick}
                tabIndex={isNodeSetupComplete ? 0 : -1}
                leadingIcon={
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                }
                title="Setup Google Gemini API Key"
                subtitle={
                  <>
                    <GiftIcon className="w-3 h-3" />
                    Use Google Gemini for free
                  </>
                }
              />

              <SetupProviderCard
                className="mt-2"
                variant="openrouter"
                onClick={handleOpenRouterSetupClick}
                tabIndex={isNodeSetupComplete ? 0 : -1}
                leadingIcon={
                  <Sparkles className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                }
                title="Setup OpenRouter API Key"
                subtitle={
                  <>
                    <GiftIcon className="w-3 h-3" />
                    Free models available
                  </>
                }
              />

              <SetupProviderCard
                className="mt-2"
                variant="dyad"
                onClick={handleDyadProSetupClick}
                tabIndex={isNodeSetupComplete ? 0 : -1}
                leadingIcon={
                  <img src={logo} alt="Dyad Logo" className="w-6 h-6 mr-0.5" />
                }
                title="Setup Dyad Pro"
                subtitle={
                  <>
                    <GlobeIcon className="w-3 h-3" />
                    Access all AI models with one plan
                  </>
                }
              />

              <div
                className="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
                onClick={handleOtherProvidersClick}
                role="button"
                tabIndex={isNodeSetupComplete ? 0 : -1}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded-full">
                      <Settings className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm text-gray-800 dark:text-gray-300">
                        Setup other AI providers
                      </h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        OpenAI, Anthropic, OpenRouter and more
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </>
  );
}

function NodeJsHelpCallout() {
  return (
    <div className="mt-3 p-3 bg-(--background-lighter) border rounded-lg text-sm">
      <p>
        If you run into issues, read our{" "}
        <a
          onClick={() => {
            IpcClient.getInstance().openExternalUrl(
              "https://www.dyad.sh/docs/help/nodejs",
            );
          }}
          className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          Node.js troubleshooting guide
        </a>
        .{" "}
      </p>
      <p className="mt-2">
        Still stuck? Click the <b>Help</b> button in the bottom-left corner and
        then <b>Report a Bug</b>.
      </p>
    </div>
  );
}

function NodeInstallButton({
  nodeInstallStep,
  handleNodeInstallClick,
  finishNodeInstall,
}: {
  nodeInstallStep: NodeInstallStep;
  handleNodeInstallClick: () => void;
  finishNodeInstall: () => void;
}) {
  switch (nodeInstallStep) {
    case "install":
      return (
        <Button className="mt-3" onClick={handleNodeInstallClick}>
          Install Node.js Runtime
        </Button>
      );
    case "continue-processing":
      return (
        <Button className="mt-3" onClick={finishNodeInstall} disabled>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking Node.js setup...
          </div>
        </Button>
      );
    case "waiting-for-continue":
      return (
        <Button className="mt-3" onClick={finishNodeInstall}>
          <div className="flex items-center gap-2">
            Continue | I installed Node.js
          </div>
        </Button>
      );
    case "finished-checking":
      return (
        <div className="mt-3 text-sm text-red-600 dark:text-red-400">
          Node.js not detected. Closing and re-opening Dyad usually fixes this.
        </div>
      );
    default:
      const _exhaustiveCheck: never = nodeInstallStep;
  }
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
        <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
      }
      title="Setup OpenRouter API Key"
      subtitle={
        <>
          <GiftIcon className="w-3 h-3" />
          Free models available
        </>
      }
    />
  );
};
