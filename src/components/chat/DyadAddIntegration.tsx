import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue } from "jotai";
import { showError } from "@/lib/toast";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useNeon } from "@/hooks/useNeon";
import { CheckCircle2, Database } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";

interface DyadAddIntegrationProps {
  children: React.ReactNode;
}

const PROVIDER_OPTIONS = [
  {
    id: "supabase" as const,
    name: "Supabase",
    features: [
      "Auth & row-level security",
      "Realtime subscriptions",
      "Storage & edge functions",
    ],
  },
  {
    id: "neon" as const,
    name: "Neon",
    features: ["Serverless Postgres", "Database branching", "Autoscaling"],
  },
];

export const DyadAddIntegration: React.FC<DyadAddIntegrationProps> = ({
  children,
}) => {
  const navigate = useNavigate();
  const { streamMessage, isStreaming } = useStreamChat();
  const [selectedProvider, setSelectedProvider] = useState<
    "neon" | "supabase" | null
  >(null);
  const appId = useAtomValue(selectedAppIdAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const { app } = useLoadApp(appId);
  const { projectInfo } = useNeon(appId);

  const completedProvider = app?.supabaseProjectName
    ? "supabase"
    : app?.neonProjectId && app?.neonActiveBranchId
      ? "neon"
      : null;

  const handleKeepGoingClick = () => {
    if (chatId === null) {
      showError("No chat found");
      return;
    }
    streamMessage({
      prompt: `Continue. I have completed the ${completedProvider} integration.`,
      chatId,
    });
  };

  const handleSetupClick = (provider: "neon" | "supabase") => {
    if (!appId) {
      showError("No app ID found");
      return;
    }
    navigate({ to: "/app-details", search: { appId, provider } });
  };

  const integrationLabel =
    completedProvider === "supabase" && app?.supabaseProjectName
      ? app.supabaseProjectName
      : completedProvider === "neon" && app?.neonProjectId
        ? (projectInfo?.projectName ?? app.neonProjectId)
        : null;

  if (completedProvider) {
    return (
      <DyadCard accentColor="green" state="finished">
        <DyadCardHeader icon={<CheckCircle2 size={15} />} accentColor="green">
          <DyadBadge color="green">Integration Complete</DyadBadge>
          <span className="text-sm font-medium text-foreground">
            {completedProvider === "supabase" ? "Supabase" : "Neon"} integration
            complete
          </span>
        </DyadCardHeader>
        <div className="px-3 pb-3">
          <p className="text-sm text-muted-foreground mb-2">
            This app is connected to{" "}
            {completedProvider === "supabase" ? "Supabase" : "Neon"} project:{" "}
            <span className="font-mono font-medium px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200">
              {integrationLabel}
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
      </DyadCard>
    );
  }

  return (
    <DyadCard accentColor="blue">
      <DyadCardHeader icon={<Database size={15} />} accentColor="blue">
        <DyadBadge color="blue">Integration</DyadBadge>
        <span className="text-sm font-medium text-foreground">
          Choose a database provider
        </span>
      </DyadCardHeader>
      <div className="px-3 pb-3">
        {children && (
          <div className="text-xs text-muted-foreground mb-3">{children}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {PROVIDER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelectedProvider(option.id)}
              className={`flex flex-col items-start gap-2 rounded-lg border-2 p-3 text-left transition-colors ${
                selectedProvider === option.id
                  ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                  : "border-border hover:border-blue-400"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {option.name}
                </span>
              </div>
              <ul className="space-y-0.5">
                {option.features.map((feature) => (
                  <li
                    key={feature}
                    className="text-xs text-muted-foreground flex items-start gap-1.5"
                  >
                    <span className="text-blue-500 mt-0.5 leading-none">
                      &#x2022;
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <Button
          onClick={() => selectedProvider && handleSetupClick(selectedProvider)}
          disabled={!selectedProvider}
          className="w-full mt-3"
          size="sm"
        >
          Set up{" "}
          {selectedProvider
            ? selectedProvider === "supabase"
              ? "Supabase"
              : "Neon"
            : "database"}
        </Button>
      </div>
    </DyadCard>
  );
};
