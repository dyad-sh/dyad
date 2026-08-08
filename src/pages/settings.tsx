import { useEffect, useState } from "react";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { ipc } from "@/ipc/types";
import { showSuccess, showError } from "@/lib/toast";
import { useAppVersion } from "@/hooks/useAppVersion";
import { Button } from "@/components/ui/button";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";
import { SettingsTabbedContent } from "@/components/settings/SettingsTabbedContent";
import { SettingsDraftProvider } from "@/contexts/SettingsDraftContext";
import { ParticleBackground } from "@/components/home/ParticleBackground";

export { SystemSettings } from "@/components/settings/GeneralSettingsSections";

export default function SettingsPage() {
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const appVersion = useAppVersion();
  const router = useRouter();
  const setActiveSettingsSection = useSetAtom(activeSettingsSectionAtom);

  useEffect(() => {
    setActiveSettingsSection(SECTION_IDS.providers);
  }, [setActiveSettingsSection]);

  const handleResetEverything = async () => {
    setIsResetting(true);
    try {
      await ipc.system.resetAll();
      showSuccess("Successfully reset everything. Restart the application.");
    } catch (error) {
      console.error("Error resetting:", error);
      showError(
        error instanceof Error ? error.message : "An unknown error occurred",
      );
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  return (
    <div className="settings-jarvis home-jarvis no-app-region-drag relative flex min-h-full w-full flex-1 flex-col overflow-x-hidden">
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <Button
            onClick={() => router.history.back()}
            variant="outline"
            size="sm"
            className="mb-6 flex items-center gap-2 border-cyan-500/20 bg-cyan-500/5 py-5 text-cyan-100/90 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>

          <header className="mb-8 space-y-2">
            <div className="flex items-center gap-2 text-cyan-400/80">
              <SlidersHorizontal className="size-4" />
              <span className="font-jarvis-ui text-xs uppercase tracking-[0.2em]">
                System Configuration
              </span>
            </div>
            <h1 className="font-jarvis-display text-3xl font-semibold tracking-wide text-[#e8f8fa] sm:text-4xl">
              Settings
            </h1>
          </header>

          <SettingsDraftProvider>
            <SettingsTabbedContent
              appVersion={appVersion}
              isResetting={isResetting}
              onOpenResetDialog={() => setIsResetDialogOpen(true)}
            />
          </SettingsDraftProvider>

          <ConfirmationDialog
            isOpen={isResetDialogOpen}
            title="Reset Everything"
            message="Are you sure you want to reset everything? This will delete all your apps, chats, and settings. This action cannot be undone."
            confirmText={isResetting ? "Resetting..." : "Reset Everything"}
            cancelText="Cancel"
            confirmDisabled={isResetting}
            onConfirm={handleResetEverything}
            onCancel={() => setIsResetDialogOpen(false)}
          />
        </div>
      </div>
    </div>
  );
}
