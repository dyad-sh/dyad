// @ts-ignore
import openAiLogo from "../../assets/ai-logos/openai-logo.svg";
// @ts-ignore
import googleLogo from "../../assets/ai-logos/google-logo.svg";
// @ts-ignore
import anthropicLogo from "../../assets/ai-logos/anthropic-logo.svg";
import { IpcClient } from "@/ipc/ipc_client";
import { useState } from "react";

import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";

export function ProBanner() {
  const { settings } = useSettings();
  const { userBudget } = useUserBudgetInfo();

  const [selectedBanner] = useState<"ai" | "smart" | "turbo">(() => {
    const options = ["ai", "smart", "turbo"] as const;
    return options[Math.floor(Math.random() * options.length)];
  });

  if (settings?.enableDyadPro || userBudget) {
    return null;
  }

  return (
    <div className="mt-6 max-w-2xl mx-auto">
      {selectedBanner === "ai" ? (
        <AiAccessBanner />
      ) : selectedBanner === "smart" ? (
        <SmartContextBanner />
      ) : (
        <TurboBanner />
      )}
    </div>
  );
}

export function AiAccessBanner() {
  return (
    <div
      className="w-full py-2 sm:py-2.5 md:py-3 rounded-lg bg-gradient-to-br from-white via-indigo-50 to-sky-100 dark:from-indigo-700 dark:via-indigo-700 dark:to-indigo-900 flex items-center justify-center relative overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/10 shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
      onClick={() => {
        IpcClient.getInstance().openExternalUrl(
          "https://www.dyad.sh/pro#ai?utm_source=dyad-app&utm_medium=app&utm_campaign=in-app-banner-ai-access",
        );
      }}
    >
      <div
        className="absolute inset-0 z-0 bg-gradient-to-tr from-white/60 via-transparent to-transparent pointer-events-none dark:from-white/10"
        aria-hidden="true"
      />
      <div className="absolute inset-0 z-0 pointer-events-none dark:hidden">
        <div className="absolute -top-8 -left-6 h-40 w-40 rounded-full blur-2xl bg-violet-200/40" />
        <div className="absolute -bottom-10 -right-6 h-48 w-48 rounded-full blur-3xl bg-sky-200/40" />
      </div>
      <div className="relative z-10 text-center flex flex-col items-center gap-0.5 sm:gap-1 md:gap-1.5 px-4 md:px-6 pr-6 md:pr-8">
        <div className="mt-0.5 sm:mt-1 flex items-center gap-2 sm:gap-3 justify-center">
          <div className="text-xl font-semibold tracking-tight text-indigo-900 dark:text-indigo-100">
            Access leading AI models with one plan
          </div>
          <button
            type="button"
            aria-label="Subscribe to Dyad Pro"
            className="inline-flex items-center rounded-md bg-white/90 text-indigo-800 hover:bg-white shadow px-3 py-1.5 text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            Get Dyad Pro
          </button>
        </div>

        <div className="mt-1.5 sm:mt-2 grid grid-cols-3 gap-6 md:gap-8 items-center justify-items-center opacity-90">
          <div className="flex items-center justify-center">
            <img
              src={openAiLogo}
              alt="OpenAI"
              width={96}
              height={28}
              className="h-4 md:h-5 w-auto dark:invert"
            />
          </div>
          <div className="flex items-center justify-center">
            <img
              src={googleLogo}
              alt="Google"
              width={110}
              height={30}
              className="h-4 md:h-5 w-auto"
            />
          </div>
          <div className="flex items-center justify-center">
            <img
              src={anthropicLogo}
              alt="Anthropic"
              width={110}
              height={30}
              className="h-3 w-auto dark:invert"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SmartContextBanner() {
  return (
    <div
      className="w-full py-2 sm:py-2.5 md:py-3 rounded-lg bg-gradient-to-br from-emerald-50 via-emerald-100 to-emerald-200 dark:from-emerald-700 dark:via-emerald-700 dark:to-emerald-900 flex items-center justify-center relative overflow-hidden ring-1 ring-inset ring-emerald-900/10 dark:ring-white/10 shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
      onClick={() => {
        IpcClient.getInstance().openExternalUrl(
          "https://www.dyad.sh/pro#ai?utm_source=dyad-app&utm_medium=app&utm_campaign=in-app-banner-smart-context",
        );
      }}
    >
      <div
        className="absolute inset-0 z-0 bg-gradient-to-tr from-white/60 via-transparent to-transparent pointer-events-none dark:from-white/10"
        aria-hidden="true"
      />
      <div className="absolute inset-0 z-0 pointer-events-none dark:hidden">
        <div className="absolute -top-10 -left-8 h-44 w-44 rounded-full blur-2xl bg-emerald-200/50" />
        <div className="absolute -bottom-12 -right-8 h-56 w-56 rounded-full blur-3xl bg-teal-200/50" />
      </div>
      <div className="relative z-10 px-4 md:px-6 pr-6 md:pr-8">
        <div className="mt-0.5 sm:mt-1 flex items-center gap-2 sm:gap-3 justify-center">
          <div className="flex flex-col items-center text-center">
            <div className="text-xl font-semibold tracking-tight text-emerald-900 dark:text-emerald-100">
              Up to 5x cheaper
            </div>
            <div className="text-sm sm:text-base mt-1 text-emerald-700 dark:text-emerald-200/80">
              by using Smart Context
            </div>
          </div>
          <button
            type="button"
            aria-label="Get Dyad Pro"
            className="inline-flex items-center rounded-md bg-white/90 text-emerald-800 hover:bg-white shadow px-3 py-1.5 text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            Get Dyad Pro
          </button>
        </div>
      </div>
    </div>
  );
}

export function TurboBanner() {
  return (
    <div
      className="w-full py-2 sm:py-2.5 md:py-3 rounded-lg bg-gradient-to-br from-rose-50 via-rose-100 to-rose-200 dark:from-rose-800 dark:via-fuchsia-800 dark:to-rose-800 flex items-center justify-center relative overflow-hidden ring-1 ring-inset ring-rose-900/10 dark:ring-white/5 shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-[1px]"
      onClick={() => {
        IpcClient.getInstance().openExternalUrl(
          "https://www.dyad.sh/pro#ai?utm_source=dyad-app&utm_medium=app&utm_campaign=in-app-banner-turbo",
        );
      }}
    >
      <div
        className="absolute inset-0 z-0 bg-gradient-to-tr from-white/60 via-transparent to-transparent pointer-events-none dark:from-white/10"
        aria-hidden="true"
      />
      <div className="absolute inset-0 z-0 pointer-events-none dark:hidden">
        <div className="absolute -top-10 -left-8 h-44 w-44 rounded-full blur-2xl bg-rose-200/50" />
        <div className="absolute -bottom-12 -right-8 h-56 w-56 rounded-full blur-3xl bg-fuchsia-200/50" />
      </div>
      <div className="relative z-10 px-4 md:px-6 pr-6 md:pr-8">
        <div className="mt-0.5 sm:mt-1 flex items-center gap-2 sm:gap-3 justify-center">
          <div className="flex flex-col items-center text-center">
            <div className="text-xl font-semibold tracking-tight text-rose-900 dark:text-rose-100">
              Generate code 4–10x faster
            </div>
            <div className="text-sm sm:text-base mt-1 text-rose-700 dark:text-rose-200/80">
              with Turbo Models & Turbo Edits
            </div>
          </div>
          <button
            type="button"
            aria-label="Get Dyad Pro"
            className="inline-flex items-center rounded-md bg-white/90 text-rose-800 hover:bg-white shadow px-3 py-1.5 text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            Get Dyad Pro
          </button>
        </div>
      </div>
    </div>
  );
}
