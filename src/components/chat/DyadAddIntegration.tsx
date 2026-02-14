import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue } from "jotai";
import { showError } from "@/lib/toast";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useStreamChat } from "@/hooks/useStreamChat";
import { CheckCircle2, Plug } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";

interface DyadAddIntegrationProps {
  node: {
    properties: {
      provider: string;
    };
  };
  children: React.ReactNode;
}

export const DyadAddIntegration: React.FC<DyadAddIntegrationProps> = ({
  node,
  children,
}) => {
  const navigate = useNavigate();
  const { streamMessage, isStreaming } = useStreamChat();

  const { provider } = node.properties;
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const { app, refreshApp } = useLoadApp(appId);
  const hasConvexIntegration =
    provider === "convex" &&
    !!app?.files?.some(
      (filePath) => filePath === "convex" || filePath.startsWith("convex/"),
    );
  const isIntegrationComplete =
    provider === "supabase" ? !!app?.supabaseProjectName : hasConvexIntegration;

  const handleKeepGoingClick = () => {
    if (chatId === null) {
      showError("No chat found");
      return;
    }
    const continuePrompt =
      provider === "convex"
        ? "Continue. I have completed the Convex integration."
        : "Continue. I have completed the Supabase integration.";
    streamMessage({
      prompt: continuePrompt,
      chatId,
    });
  };

  const handleSetupClick = async () => {
    if (!appId) {
      showError("No app ID found");
      return;
    }

    if (provider === "convex") {
      try {
        await ipc.app.setupConvex({ appId });
        await refreshApp();
        toast.success("Convex backend initialized.");
      } catch (error) {
        showError(error);
      }
      return;
    }

    navigate({ to: "/app-details", search: { appId } });
  };

  if (isIntegrationComplete) {
    const integrationName = provider === "convex" ? "Convex" : "Supabase";
    return (
      <DyadCard accentColor="green" state="finished">
        <DyadCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <DyadBadge color="green">Integration Complete</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {integrationName} integration complete
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3">
          {provider === "supabase" ? (
            <p className="text-sm text-muted-foreground mb-2">
              This app is connected to Supabase project:{" "}
              <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
                {app?.supabaseProjectName}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mb-2">
              Convex backend files were added to this app.
            </p>
          )}
          <Button
            onClick={handleKeepGoingClick}
            variant="default"
            disabled={isStreaming}
            size="sm"
          >
            Continue
          </Button>
        </div>
      </DyadCard>
    );
  }

  return (
    <DyadCard accentColor="blue">
      <DyadCardHeader icon={<Plug size={15} />} accentColor="blue">
        <DyadBadge color="blue">Integration</DyadBadge>
        <span className="text-sm font-medium text-foreground">
          Integrate with {provider}?
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3">
        <div className="text-xs text-muted-foreground mb-3">{children}</div>
        <Button onClick={handleSetupClick} className="w-full" size="sm">
          Set up {provider}
        </Button>
      </div>
    </DyadCard>
  );
};
