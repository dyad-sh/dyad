/**
 * useVoiceCommand Hook
 *
 * Connects voice input (Whisper STT) to the voice command engine
 * and routes detected intents to JoyCreate actions.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom, useAtomValue } from "jotai";
import { toast } from "sonner";
import { IpcClient } from "@/ipc/ipc_client";
import { AutonomousClient } from "@/ipc/openclaw_autonomous_client";
import VoiceAssistantClient from "@/ipc/voice_assistant_client";
import { detectVoiceIntent, getIntentLabel } from "@/lib/voice_command_engine";
import type { VoiceCommandResult } from "@/lib/voice_command_engine";
import { generateCuteAppName } from "@/lib/utils";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { assistantPanelOpenAtom } from "@/hooks/useJoyAssistant";

// ── Types ───────────────────────────────────────────────────────────────────

export type VoiceCommandState =
  | "idle"
  | "listening"
  | "processing"
  | "executing"
  | "feedback";

export interface UseVoiceCommandReturn {
  state: VoiceCommandState;
  transcript: string;
  lastResult: VoiceCommandResult | null;
  feedbackMessage: string;
  startCommand: () => Promise<void>;
  stopCommand: () => Promise<void>;
  cancelCommand: () => void;
  executeTextCommand: (text: string) => Promise<void>;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useVoiceCommand(): UseVoiceCommandReturn {
  const navigate = useNavigate();
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const setAssistantOpen = useSetAtom(assistantPanelOpenAtom);

  const [state, setState] = useState<VoiceCommandState>("idle");
  const [transcript, setTranscript] = useState("");
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const cancelledRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timers
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = useCallback((message: string, durationMs = 3000) => {
    setFeedbackMessage(message);
    setState("feedback");
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setState("idle");
      setFeedbackMessage("");
      setTranscript("");
      setLastResult(null);
    }, durationMs);
  }, []);

  const speakFeedback = useCallback(async (text: string) => {
    try {
      await VoiceAssistantClient.speak({ text });
    } catch {
      // TTS failure is non-critical
    }
  }, []);

  // ── Action Executors ────────────────────────────────────────────────────

  const executeIntent = useCallback(
    async (result: VoiceCommandResult) => {
      setState("executing");
      setLastResult(result);

      try {
        switch (result.intent) {
          // ── Navigate ──────────────────────────────────────────────────
          case "navigate": {
            if (result.route) {
              navigate({ to: result.route });
              showFeedback(`Opened ${result.route}`);
              speakFeedback(`Navigated to ${result.description}`);
            } else {
              showFeedback("I couldn't find that page");
            }
            break;
          }

          // ── Build App ─────────────────────────────────────────────────
          case "build_app": {
            const appName = generateCuteAppName();
            showFeedback(`Creating "${appName}"...`);
            speakFeedback("Building your app now");

            const createResult = await IpcClient.getInstance().createApp({
              name: appName,
            });

            // Stream the voice command as the initial prompt
            IpcClient.getInstance().streamMessage(result.rawText, {
              chatId: createResult.chatId,
              onUpdate: () => {},
              onEnd: () => {},
              onError: (err) => console.error("Voice command stream error:", err),
            });

            setSelectedAppId(createResult.app.id);
            // Short delay for stream to start
            await new Promise((r) => setTimeout(r, 1500));
            navigate({ to: "/chat", search: { id: createResult.chatId } });
            showFeedback(`App "${appName}" created! AI is building it now.`);
            break;
          }

          // ── Create Workflow ───────────────────────────────────────────
          case "create_workflow": {
            showFeedback("Creating workflow...");
            speakFeedback("Setting up your workflow");

            const execution = await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });

            if (execution.status === "completed") {
              showFeedback("Workflow created successfully!");
              navigate({ to: "/workflows" });
            } else {
              showFeedback("Workflow is being set up...");
              navigate({ to: "/workflows" });
            }
            break;
          }

          // ── Create Agent ──────────────────────────────────────────────
          case "create_agent": {
            showFeedback("Creating agent...");
            speakFeedback("Creating your agent");

            const execution = await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });

            if (execution.status === "completed") {
              showFeedback("Agent created!");
              navigate({ to: "/agents" });
            } else {
              showFeedback("Agent is being configured...");
              navigate({ to: "/agents" });
            }
            break;
          }

          // ── Manage Email ──────────────────────────────────────────────
          case "manage_email": {
            showFeedback("Opening email management...");
            speakFeedback("Opening your email hub");
            navigate({ to: "/email-hub" });

            // Also kick off an autonomous task if it's more than just "open email"
            if (result.rawText.split(/\s+/).length > 4) {
              await AutonomousClient.execute({
                input: result.rawText,
                requireApproval: false,
              });
            }
            showFeedback("Email hub opened");
            break;
          }

          // ── Manage Marketing ──────────────────────────────────────────
          case "manage_marketing": {
            showFeedback("Setting up marketing automation...");
            speakFeedback("Setting up your marketing");

            const execution = await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });

            if (execution.status === "completed") {
              showFeedback("Marketing task completed!");
            } else {
              showFeedback("Marketing automation is running...");
            }
            break;
          }

          // ── Generate Image ────────────────────────────────────────────
          case "generate_image": {
            showFeedback("Generating image...");
            speakFeedback("Creating your image");
            navigate({ to: "/asset-studio" });

            await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });
            showFeedback("Image generated!");
            break;
          }

          // ── Generate Video ────────────────────────────────────────────
          case "generate_video": {
            showFeedback("Generating video...");
            speakFeedback("Creating your video");
            navigate({ to: "/asset-studio" });

            await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });
            showFeedback("Video generated!");
            break;
          }

          // ── Deploy ────────────────────────────────────────────────────
          case "deploy": {
            showFeedback("Deploying...");
            speakFeedback("Starting deployment");

            await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });
            showFeedback("Deployment initiated!");
            break;
          }

          // ── Run App ───────────────────────────────────────────────────
          case "run_app": {
            showFeedback("Running app...");
            speakFeedback("Starting the app");
            // The run action is typically handled per-app context
            await AutonomousClient.execute({
              input: "Run the current app preview",
              requireApproval: false,
            });
            showFeedback("App is running!");
            break;
          }

          // ── Stop App ──────────────────────────────────────────────────
          case "stop_app": {
            showFeedback("Stopping app...");
            speakFeedback("Stopping the app");
            await AutonomousClient.execute({
              input: "Stop the current app preview",
              requireApproval: false,
            });
            showFeedback("App stopped");
            break;
          }

          // ── Search ────────────────────────────────────────────────────
          case "search": {
            // Try to extract search query
            const query = result.rawText.replace(
              /^(search|find|look)\s+(for\s+)?/i,
              ""
            );
            if (query) {
              showFeedback(`Searching for "${query}"...`);
              // Click global search if available
              const searchEl = document.querySelector<HTMLElement>(
                '[data-joy-assist="global-search"]'
              );
              if (searchEl) {
                searchEl.click();
                // Try to fill the search input
                const input = searchEl.querySelector("input") || searchEl;
                if (input instanceof HTMLInputElement) {
                  const nativeSetter = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value"
                  )?.set;
                  nativeSetter?.call(input, query);
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }
            }
            showFeedback(`Searched for "${query}"`);
            break;
          }

          // ── System ────────────────────────────────────────────────────
          case "system": {
            showFeedback("Running system command...");
            await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });
            showFeedback("System command executed");
            break;
          }

          // ── Autonomous Task (general) ─────────────────────────────────
          case "autonomous_task": {
            showFeedback("Working on it...");
            speakFeedback("On it. Let me handle that for you.");

            const execution = await AutonomousClient.execute({
              input: result.rawText,
              requireApproval: false,
            });

            if (execution.status === "completed") {
              showFeedback("Done!");
              speakFeedback("Task completed successfully");
            } else if (execution.status === "failed") {
              showFeedback("Task couldn't be completed");
              speakFeedback("Sorry, I couldn't complete that task");
            } else {
              showFeedback("Task is in progress...");
            }
            break;
          }

          // ── Chat (fallback) ───────────────────────────────────────────
          case "chat": {
            // Open the Joy Assistant and send the message there
            setAssistantOpen(true);
            showFeedback("Sent to Joy Assistant");
            speakFeedback(result.rawText.length > 50 ? "I'll think about that" : "Let me help with that");
            break;
          }

          // ── Skill Creation ────────────────────────────────────────────
          case "create_skill": {
            showFeedback("Generating skill...");
            speakFeedback("Let me create that skill for you");
            navigate({ to: "/skills" });
            // Trigger generation via IPC
            try {
              const ipc = IpcClient.getInstance();
              const gen = await ipc.generateSkill({ description: result.rawText });
              const skill = await ipc.createSkill(gen.skill);
              showFeedback(`Skill "${skill.name}" created!`);
              speakFeedback(`Skill ${skill.name} has been created`);
            } catch (skillErr) {
              showFeedback("Skill creation failed");
              toast.error("Skill generation failed", { description: (skillErr as Error).message });
            }
            break;
          }

          default:
            showFeedback("I'm not sure how to do that");
            break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Something went wrong";
        showFeedback(`Error: ${msg}`);
        toast.error("Voice command failed", { description: msg });
      }
    },
    [navigate, setSelectedAppId, setAssistantOpen, showFeedback, speakFeedback]
  );

  // ── Start Voice Command ─────────────────────────────────────────────────

  const startCommand = useCallback(async () => {
    if (state !== "idle") return;
    cancelledRef.current = false;

    try {
      setState("listening");
      setTranscript("");
      setLastResult(null);
      setFeedbackMessage("");

      // Initialize voice if needed
      try {
        await VoiceAssistantClient.initialize();
      } catch {
        // Already initialized
      }

      await VoiceAssistantClient.startListening();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Microphone error";
      showFeedback(`Error: ${msg}`);
      toast.error("Voice input failed", { description: msg });
    }
  }, [state, showFeedback]);

  // ── Stop & Process ──────────────────────────────────────────────────────

  const stopCommand = useCallback(async () => {
    if (state !== "listening") return;

    try {
      setState("processing");
      const result = await VoiceAssistantClient.stopListening();

      if (cancelledRef.current) {
        setState("idle");
        return;
      }

      if (!result?.text?.trim()) {
        showFeedback("I didn't hear anything");
        return;
      }

      setTranscript(result.text);

      // Detect intent
      const commandResult = detectVoiceIntent(result.text);
      toast.info(`${getIntentLabel(commandResult.intent)}: "${result.text}"`, {
        duration: 2000,
      });

      // Execute the intent
      await executeIntent(commandResult);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Processing error";
      showFeedback(`Error: ${msg}`);
    }
  }, [state, executeIntent, showFeedback]);

  // ── Cancel ────────────────────────────────────────────────────────────

  const cancelCommand = useCallback(() => {
    cancelledRef.current = true;
    setState("idle");
    setTranscript("");
    setFeedbackMessage("");
    try {
      VoiceAssistantClient.stopListening();
    } catch {
      // ignore
    }
  }, []);

  // ── Text-based command (for testing or keyboard input) ──────────────

  const executeTextCommand = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setTranscript(text);
      setState("processing");

      const commandResult = detectVoiceIntent(text);
      toast.info(`${getIntentLabel(commandResult.intent)}: "${text}"`, {
        duration: 2000,
      });

      await executeIntent(commandResult);
    },
    [executeIntent]
  );

  return {
    state,
    transcript,
    lastResult,
    feedbackMessage,
    startCommand,
    stopCommand,
    cancelCommand,
    executeTextCommand,
  };
}
