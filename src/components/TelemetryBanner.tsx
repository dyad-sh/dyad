import { IpcClient } from "@/ipc/ipc_client";
import React from "react";
import { Button } from "./ui/button";
import { atom, useAtom } from "jotai";
import { useSettings } from "@/hooks/useSettings";

const hideBannerAtom = atom(false);

export function PrivacyBanner() {
  const [hideBanner, setHideBanner] = useAtom(hideBannerAtom);
  const { settings, updateSettings } = useSettings();
  // TODO: Implement state management for banner visibility and user choice
  // TODO: Implement functionality for Accept, Reject, Ask me later buttons
  // TODO: Add state to hide/show banner based on user choice
  if (hideBanner) {
    return null;
  }
  if (settings?.telemetryConsent !== "unset") {
    return null;
  }
  return (
    <div className="fixed bg-(--background)/90 bottom-4 right-4  backdrop-blur-md border border-gray-200 dark:border-gray-700 p-4 rounded-lg shadow-lg z-50 max-w-md">
      <div className="flex flex-col gap-3">
        <div>
          <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Share anonymous data?
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Help improve Dyad with anonymous usage data.
            <em className="block italic mt-0.5">
              Note: this does not log your code or messages.
            </em>
            <a
              onClick={() => {
                IpcClient.getInstance().openExternalUrl(
                  "https://dyad.sh/docs/policies/privacy-policy",
                );
              }}
              className="cursor-pointer text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Learn more
            </a>
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="default"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_in" });
            }}
            data-testid="telemetry-accept-button"
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              updateSettings({ telemetryConsent: "opted_out" });
            }}
            data-testid="telemetry-reject-button"
          >
            Reject
          </Button>
          <Button
            variant="ghost"
            onClick={() => setHideBanner(true)}
            data-testid="telemetry-later-button"
          >
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}
