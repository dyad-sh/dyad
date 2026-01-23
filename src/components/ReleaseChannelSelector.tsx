import { useSettings } from "@/hooks/useSettings";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { IpcClient } from "@/ipc/ipc_client";
import type { ReleaseChannel } from "@/lib/schemas";

export function ReleaseChannelSelector() {
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  const handleReleaseChannelChange = (value: ReleaseChannel) => {
    updateSettings({ releaseChannel: value });
    if (value === "stable") {
      toast("Using Stable release channel", {
        description:
          "You'll stay on your current version until a newer stable release is available, or you can manually downgrade now.",
        action: {
          label: "Download Stable",
          onClick: () => {
            IpcClient.getInstance().openExternalUrl("https://dyad.sh/download");
          },
        },
      });
    } else {
      toast("Using Beta release channel", {
        description:
          "You will need to restart Dyad for your settings to take effect.",
        action: {
          label: "Restart Dyad",
          onClick: () => {
            IpcClient.getInstance().restartDyad();
          },
        },
      });
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <label
          htmlFor="release-channel"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Release Channel
        </label>
        <Select
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
        >
          <SelectTrigger className="w-32" id="release-channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stable">Stable</SelectItem>
            <SelectItem value="beta">Beta</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        <p>Stable is recommended for most users. </p>
        <p>Beta receives more frequent updates but may have more bugs.</p>
      </div>
    </div>
  );
}
