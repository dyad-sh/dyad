import React from "react";
import { FolderOpen } from "lucide-react";
import { useAtomValue } from "jotai";
import { currentAppAtom } from "@/atoms/appAtoms";
import { useAgentTools, type AgentToolName } from "@/hooks/useAgentTools";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SANDBOX_SCRIPT_TIMEOUT_MS,
  MAX_SANDBOX_SCRIPT_TIMEOUT_MS,
} from "@/constants/settings_constants";
import { ipc } from "@/ipc/types";
import type { AgentToolConsent } from "@/lib/schemas";

const timeoutOptions = [
  { value: "default", label: "Default (2s)" },
  { value: "5000", label: "5s" },
  { value: "10000", label: "10s" },
];

function getMediaPath(appPath: string | undefined): string | null {
  if (!appPath) {
    return null;
  }
  const separator = appPath.includes("\\") ? "\\" : "/";
  return `${appPath.replace(/[\\/]+$/, "")}${separator}.dyad${separator}media`;
}

export function SandboxScriptSettings() {
  const { settings, updateSettings } = useSettings();
  const { tools, setConsent } = useAgentTools();
  const currentApp = useAtomValue(currentAppAtom);
  const mediaPath = getMediaPath(currentApp?.resolvedPath ?? currentApp?.path);
  const scriptTool = tools?.find(
    (tool) => tool.name === "execute_sandbox_script",
  );
  const timeoutMs = settings?.sandboxScriptTimeoutMs;
  const currentValue =
    timeoutMs == null || timeoutMs === DEFAULT_SANDBOX_SCRIPT_TIMEOUT_MS
      ? "default"
      : String(Math.min(timeoutMs, MAX_SANDBOX_SCRIPT_TIMEOUT_MS));

  const handleTimeoutChange = (value: string | null) => {
    if (!value) {
      return;
    }
    updateSettings({
      sandboxScriptTimeoutMs:
        value === "default" ? undefined : Number.parseInt(value, 10),
    });
  };

  return (
    <div className="space-y-3">
      {scriptTool && (
        <div className="flex items-center gap-4">
          <label
            htmlFor="sandbox-script-consent"
            className="text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Script approval
          </label>
          <Select
            value={scriptTool.consent}
            onValueChange={(value) => {
              if (!value) {
                return;
              }
              setConsent({
                toolName: "execute_sandbox_script" as AgentToolName,
                consent: value as AgentToolConsent,
              });
            }}
          >
            <SelectTrigger className="w-[160px]" id="sandbox-script-consent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ask">Ask</SelectItem>
              <SelectItem value="always">Always allow</SelectItem>
              <SelectItem value="never">Never allow</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {!scriptTool && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Script approval is available in local-agent mode on supported
          platforms.
        </div>
      )}

      {scriptTool && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-4">
              <label
                htmlFor="sandbox-script-timeout"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Script timeout
              </label>
              <Select value={currentValue} onValueChange={handleTimeoutChange}>
                <SelectTrigger
                  className="w-[160px]"
                  id="sandbox-script-timeout"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeoutOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Limits read-only attachment scripts in local-agent mode.
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!mediaPath}
            onClick={() => {
              if (mediaPath) {
                ipc.system.showItemInFolder(mediaPath);
              }
            }}
          >
            <FolderOpen className="size-4 mr-2" />
            Open .dyad/media/
          </Button>
        </div>
      )}
    </div>
  );
}
