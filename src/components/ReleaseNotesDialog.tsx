import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";

import { useAppVersion } from "@/hooks/useAppVersion";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/contexts/ThemeContext";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Track whether we've already checked release notes this session.
let hasCheckedReleaseNotes = false;

export function ReleaseNotesDialog() {
  const { t } = useTranslation("home");
  const appVersion = useAppVersion();
  const { settings, updateSettings } = useSettings();
  const { theme } = useTheme();
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState("");

  useEffect(() => {
    const checkReleaseNotes = async () => {
      if (
        hasCheckedReleaseNotes ||
        !appVersion ||
        !settings ||
        settings.lastShownReleaseNotesVersion === appVersion
      ) {
        return;
      }
      hasCheckedReleaseNotes = true;

      const shouldShowReleaseNotes = !!settings.lastShownReleaseNotesVersion;

      // It feels spammy to show release notes if it's the user's very first time.
      if (!shouldShowReleaseNotes) {
        await updateSettings({
          lastShownReleaseNotesVersion: appVersion,
        });
        return;
      }

      try {
        const result = await ipc.system.doesReleaseNoteExist({
          version: appVersion,
        });

        if (result.exists && result.url) {
          setReleaseUrl(`${result.url}?hideHeader=true&theme=${theme}`);
          setReleaseNotesOpen(true);
          await updateSettings({
            lastShownReleaseNotesVersion: appVersion,
          });
        }
      } catch (err) {
        console.warn(
          "Unable to check if release note exists for: " + appVersion,
          err,
        );
      }
    };
    checkReleaseNotes();
  }, [appVersion, settings, updateSettings, theme]);

  return (
    <Dialog open={releaseNotesOpen} onOpenChange={setReleaseNotesOpen}>
      <DialogContent className="max-w-4xl bg-(--docs-bg) pr-0 pt-4 pl-4 gap-1">
        <DialogHeader>
          <DialogTitle>{t("whatsNew", { version: appVersion })}</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-10 top-2 focus-visible:ring-0 focus-visible:ring-offset-0"
            onClick={() =>
              window.open(
                releaseUrl.replace(`?hideHeader=true&theme=${theme}`, ""),
                "_blank",
              )
            }
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
        </DialogHeader>
        <div className="overflow-auto h-[70vh] flex flex-col ">
          {releaseUrl && (
            <div className="flex-1">
              <iframe
                src={releaseUrl}
                className="w-full h-full border-0 rounded-lg"
                title={t("releaseNotesTitle", { version: appVersion })}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
