/**
 * useAgentCreationPipeline
 *
 * React hook that connects the NLP → Agent Creation pipeline to the UI.
 * Listens for agent blueprint events from the chat stream and provides
 * state for rendering the AgentCreationWizard inline.
 */

import { useState, useEffect, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type { AgentBlueprint } from "@/lib/agent_blueprint_generator";
import type { AgentCreationIntent } from "@/lib/agent_intent_parser";

export interface AgentBlueprintEvent {
  chatId: number;
  blueprint: AgentBlueprint;
  intent: AgentCreationIntent;
}

/**
 * Hook that subscribes to agent blueprint events for a specific chat.
 * Returns the active blueprint (if any) and controls for the wizard.
 */
export function useAgentCreationPipeline(chatId?: number) {
  const [activeBlueprint, setActiveBlueprint] = useState<AgentBlueprint | null>(null);
  const [activeIntent, setActiveIntent] = useState<AgentCreationIntent | null>(null);
  const [isWizardVisible, setIsWizardVisible] = useState(false);

  // Subscribe to blueprint events
  useEffect(() => {
    const ipc = IpcClient.getInstance();
    const unsubscribe = ipc.onAgentBlueprint((data) => {
      if (chatId && data.chatId === chatId) {
        setActiveBlueprint(data.blueprint);
        setActiveIntent(data.intent);
        setIsWizardVisible(true);
      }
    });

    return unsubscribe;
  }, [chatId]);

  // Dismiss the wizard
  const dismissWizard = useCallback(() => {
    setIsWizardVisible(false);
    setActiveBlueprint(null);
    setActiveIntent(null);
  }, []);

  // Update the blueprint (from wizard edits)
  const updateBlueprint = useCallback((blueprint: AgentBlueprint) => {
    setActiveBlueprint(blueprint);
  }, []);

  // Manually trigger intent detection for a message
  const detectIntent = useCallback(
    async (message: string, useLLM = false) => {
      const ipc = IpcClient.getInstance();
      const result = await ipc.detectAndGenerateAgent(message, useLLM);
      if (result.detected && result.blueprint) {
        setActiveBlueprint(result.blueprint);
        setActiveIntent(result.intent);
        setIsWizardVisible(true);
      }
      return result;
    },
    [],
  );

  return {
    activeBlueprint,
    activeIntent,
    isWizardVisible,
    dismissWizard,
    updateBlueprint,
    detectIntent,
  };
}
