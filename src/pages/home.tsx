import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { homeChatInputValueAtom } from "../atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { generateCuteAppName } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useSettings } from "@/hooks/useSettings";
import { SetupBanner } from "@/components/SetupBanner";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { useState, useEffect, useCallback } from "react";
import { useStreamChat } from "@/hooks/useStreamChat";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { usePostHog } from "posthog-js/react";
import { PrivacyBanner } from "@/components/TelemetryBanner";
import { INSPIRATION_PROMPTS } from "@/prompts/inspiration_prompts";

export default function HomePage() {
  const [inputValue, setInputValue] = useAtom(homeChatInputValueAtom);
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { refreshApps } = useLoadApps();
  const { settings, isAnyProviderSetup } = useSettings();
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const [isLoading, setIsLoading] = useState(false);
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const posthog = usePostHog();
  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  // State for random prompts
  const [randomPrompts, setRandomPrompts] = useState<
    typeof INSPIRATION_PROMPTS
  >([]);

  // Function to get random prompts
  const getRandomPrompts = useCallback(() => {
    const shuffled = [...INSPIRATION_PROMPTS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  }, []);

  // Initialize random prompts
  useEffect(() => {
    setRandomPrompts(getRandomPrompts());
  }, [getRandomPrompts]);

  // Redirect to app details page if appId is present
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId } });
    }
  }, [appId, navigate]);

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;

    try {
      setIsLoading(true);
      // Create the chat and navigate
      const result = await IpcClient.getInstance().createApp({
        name: generateCuteAppName(),
      });

      // Stream the message
      streamMessage({ prompt: inputValue, chatId: result.chatId });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setInputValue("");
      setSelectedAppId(result.app.id);
      setIsPreviewOpen(false);
      await refreshApps(); // Ensure refreshApps is awaited if it's async
      posthog.capture("home:chat-submit");
      navigate({ to: "/chat", search: { id: result.chatId } });
    } catch (error) {
      console.error("Failed to create chat:", error);
      setIsLoading(false); // Ensure loading state is reset on error
    }
    // No finally block needed for setIsLoading(false) here if navigation happens on success
  };

  // Loading overlay for app creation
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
        <div className="w-full flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-8 border-t-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
            Building your app
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            We're setting up your app with AI magic. <br />
            This might take a moment...
          </p>
        </div>
      </div>
    );
  }

  // Main Home Page Content
  return (
    <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
      <SetupBanner />

      <div className="w-full">
        <HomeChatInput onSubmit={handleSubmit} />

        <div className="flex flex-col gap-4 mt-4">
          <div className="flex flex-wrap gap-4 justify-center">
            {randomPrompts.map((item, index) => (
              <button
                type="button"
                key={index}
                onClick={() => setInputValue(`Build me a ${item.label}`)}
                className="flex items-center gap-3 px-4 py-2 rounded-xl border border-gray-200
                           bg-white/50 backdrop-blur-sm
                           transition-all duration-200
                           hover:bg-white hover:shadow-md hover:border-gray-300
                           active:scale-[0.98]
                           dark:bg-gray-800/50 dark:border-gray-700
                           dark:hover:bg-gray-800 dark:hover:border-gray-600"
              >
                <span className="text-gray-700 dark:text-gray-300">
                  {item.icon}
                </span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setRandomPrompts(getRandomPrompts())}
            className="self-center flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200
                       bg-white/50 backdrop-blur-sm
                       transition-all duration-200
                       hover:bg-white hover:shadow-md hover:border-gray-300
                       active:scale-[0.98]
                       dark:bg-gray-800/50 dark:border-gray-700
                       dark:hover:bg-gray-800 dark:hover:border-gray-600"
          >
            <svg
              className="w-5 h-5 text-gray-700 dark:text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              More ideas
            </span>
          </button>
        </div>
      </div>
      <PrivacyBanner />
    </div>
  );
}
