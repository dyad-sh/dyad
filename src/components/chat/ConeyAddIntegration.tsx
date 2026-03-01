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
import { ConeyCard, ConeyCardHeader, ConeyBadge } from "./ConeyCardPrimitives";

interface ConeyAddIntegrationProps {
  node: {
    properties: {
      provider: string;
    };
  };
  children: React.ReactNode;
}

export const ConeyAddIntegration: React.FC<ConeyAddIntegrationProps> = ({
  node,
  children,
}) => {
  const navigate = useNavigate();
  const { streamMessage, isStreaming } = useStreamChat();

  const { provider } = node.properties;
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const { app } = useLoadApp(appId);

  const handleKeepGoingClick = () => {
    if (chatId === null) {
      showError("No chat found");
      return;
    }
    streamMessage({
      prompt: "Continue. I have completed the Supabase integration.",
      chatId,
    });
  };

  const handleSetupClick = () => {
    if (!appId) {
      showError("No app ID found");
      return;
    }
    navigate({ to: "/app-details", search: { appId } });
  };

  if (app?.supabaseProjectName) {
    return (
      <ConeyCard accentColor="green" state="finished">
        <ConeyCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <ConeyBadge color="green">Integration Complete</ConeyBadge>
          <span className="text-sm font-medium text-foreground">
            Supabase integration complete
          </span>
        </ConeyCardHeader>
        <div className="px-3 pb-3">
          <p className="text-sm text-muted-foreground mb-2">
            This app is connected to Supabase project:{" "}
            <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
              {app.supabaseProjectName}
            </span>
          </p>
          <Button
            onClick={handleKeepGoingClick}
            variant="default"
            disabled={isStreaming}
            size="sm"
          >
            Continue
          </Button>
        </div>
      </ConeyCard>
    );
  }

  return (
    <ConeyCard accentColor="blue">
      <ConeyCardHeader icon={<Plug size={15} />} accentColor="blue">
        <ConeyBadge color="blue">Integration</ConeyBadge>
        <span className="text-sm font-medium text-foreground">
          Integrate with {provider}?
        </span>
      </ConeyCardHeader>
      <div className="px-3 pb-3">
        <div className="text-xs text-muted-foreground mb-3">{children}</div>
        <Button onClick={handleSetupClick} className="w-full" size="sm">
          Set up {provider}
        </Button>
      </div>
    </ConeyCard>
  );
};
