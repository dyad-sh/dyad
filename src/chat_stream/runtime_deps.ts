import type { QueryClient } from "@tanstack/react-query";
import type { createStore } from "jotai";
import type { PostHog } from "posthog-js";

import type {
  PreviewReloadRequestFacade,
  ScreenshotRequestFacade,
} from "@/app_wiring/cross_machine_facades";
import type { UserSettings } from "@/lib/schemas";
import type { PackageManagerWarningSource } from "@/package_manager_warnings/store";

type JotaiStore = ReturnType<typeof createStore>;

/** Renderer services used only to materialize main-owned stream projections. */
export interface ChatStreamRuntimeDeps {
  store: JotaiStore;
  queryClient: QueryClient;
  getSettings: () => UserSettings | null | undefined;
  getPosthog: () => PostHog | null;
  requestPreviewReload: PreviewReloadRequestFacade["requestManualReload"];
  requestCapture: ScreenshotRequestFacade["requestCapture"];
  setPackageManagerWarning?: PackageManagerWarningSource["setWarning"];
  getIsStreaming(chatId: number): boolean;
}
