import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue, atom, useAtom } from "jotai";
import { showError } from "@/lib/toast";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";

interface DyadAddIntegrationProps {
  node: {
    properties: {
      provider: string;
    };
  };
  children: React.ReactNode;
}

const isSetupAtom = atom(false);

export const DyadAddIntegration: React.FC<DyadAddIntegrationProps> = ({
  node,
  children,
}) => {
  const { streamMessage } = useStreamChat();
  const [isSetup, setIsSetup] = useAtom(isSetupAtom);
  const navigate = useNavigate();

  const { provider } = node.properties;
  const appId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(appId);
  const selectedChatId = useAtomValue(selectedChatIdAtom);

  const handleSetupClick = () => {
    if (!appId) {
      showError("No app ID found");
      return;
    }
    navigate({ to: "/app-details", search: { appId } });
    setIsSetup(true);
  };

  if (app?.supabaseProjectName) {
    return (
      <div className="flex flex-col  my-2 p-3 border border-green-300 rounded-lg bg-green-50 shadow-sm">
        <div className="flex items-center space-x-2">
          <svg
            className="w-5 h-5 text-green-600"
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
              fill="#bbf7d0"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4"
            />
          </svg>
          <span className="font-semibold text-green-800">
            Supabase integration complete
          </span>
        </div>
        <div className="text-sm text-green-900">
          This app is connected to Supabase project:{" "}
          <span className="font-mono font-medium bg-green-100 px-1 py-0.5 rounded">
            {app.supabaseProjectName}
          </span>
        </div>
      </div>
    );
  }

  if (isSetup) {
    return (
      <Button
        onClick={() => {
          setIsSetup(false);
          if (!selectedChatId) {
            showError("No chat ID found");
            return;
          }
          streamMessage({
            prompt: "OK, I've setup Supabase. Continue",
            chatId: selectedChatId,
          });
        }}
        className="my-1"
      >
        Continue | I've setup {provider}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 my-2 p-3 border rounded-md bg-secondary/10">
      <div className="text-sm">
        <div className="font-medium">Integrate with {provider}?</div>
        <div className="text-muted-foreground text-xs">{children}</div>
      </div>
      <Button onClick={handleSetupClick} className="self-start w-full">
        Set up {provider}
      </Button>
    </div>
  );
};
