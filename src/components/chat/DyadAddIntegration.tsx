import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue, atom, useAtom } from "jotai";
import { showError } from "@/lib/toast";
import { useStreamChat } from "@/hooks/useStreamChat";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

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
  const selectedChatId = useAtomValue(selectedChatIdAtom);

  const handleSetupClick = () => {
    if (!appId) {
      showError("No app ID found");
      return;
    }
    navigate({ to: "/app-details", search: { appId } });
    setIsSetup(true);
  };

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
