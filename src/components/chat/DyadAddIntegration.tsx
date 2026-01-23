import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue } from "jotai";
import { showError } from "@/lib/toast";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useStreamChat } from "@/hooks/useStreamChat";

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
      <div className="flex flex-col my-2 p-3 border border-green-300 dark:border-green-800/50 rounded-lg bg-green-50 dark:bg-green-900/20 shadow-sm">
        <div className="flex items-center space-x-2">
          <svg
            className="w-5 h-5 text-green-600 dark:text-green-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              fill="currentColor"
              className="opacity-20"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4"
            />
          </svg>
          <span className="font-semibold text-green-800 dark:text-green-300">
            Supabase integration complete
          </span>
        </div>
        <div className="text-sm text-green-900 dark:text-green-100">
          <p>
            This app is connected to Supabase project:{" "}
            <span className="font-mono font-medium bg-green-100 dark:bg-green-900/40 px-1 py-0.5 rounded">
              {app.supabaseProjectName}
            </span>
          </p>
        </div>
        <Button
          onClick={handleKeepGoingClick}
          className="self-start mt-2"
          variant="default"
          disabled={isStreaming}
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 my-2 p-3 border rounded-md bg-secondary/10 dark:bg-secondary/20">
      <div className="text-sm">
        <div className="font-medium text-foreground">
          Integrate with {provider}?
        </div>
        <div className="text-muted-foreground text-xs">{children}</div>
      </div>
      <Button onClick={handleSetupClick} className="self-start w-full">
        Set up {provider}
      </Button>
    </div>
  );
};
