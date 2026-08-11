import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { ChevronLeft, AudioLines } from "lucide-react";

import { activeSettingsTabAtom } from "@/atoms/viewAtoms";
import { SettingsTabbedContent } from "@/components/settings/SettingsTabbedContent";
import { SettingsDraftProvider } from "@/contexts/SettingsDraftContext";
import { useAppVersion } from "@/hooks/useAppVersion";

/**
 * JARVIS voice settings, on the JARVIS screen rather than in System.
 *
 * The same tab the settings rail has always rendered, with the rail hidden.
 * Nothing about the controls changed; what changed is that they now sit with
 * the thing they configure instead of a list of technical destinations.
 */
export default function JarvisSettingsPage() {
  const navigate = useNavigate();
  const appVersion = useAppVersion();
  const setSettingsTab = useSetAtom(activeSettingsTabAtom);

  useEffect(() => {
    setSettingsTab("jarvis");
  }, [setSettingsTab]);

  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-y-auto bg-background">
      <div className="system-subheader">
        <button
          type="button"
          onClick={() => void navigate({ to: "/jarvis" })}
          className="system-back"
          data-testid="jarvis-settings-back"
        >
          <ChevronLeft className="size-4" />
          JARVIS
        </button>
        <span className="system-crumb">
          <AudioLines className="size-3.5" />
          Voice Assistant
        </span>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <SettingsDraftProvider>
          <SettingsTabbedContent
            hideTabList
            appVersion={appVersion}
            isResetting={false}
            onOpenResetDialog={() => void navigate({ to: "/system" })}
          />
        </SettingsDraftProvider>
      </div>
    </div>
  );
}
