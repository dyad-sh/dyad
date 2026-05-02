/**
 * VoiceMcpSettings
 *
 * Per-voice-assistant MCP tool allow-list. Voice-originated turns honor
 * this list when invoking the LLM (`joy_assistant_service.chat(..., "voice")`).
 *
 *  - `undefined` (initial / never edited): all enabled MCP tools are exposed.
 *  - `[]`        (explicit empty array)  : MCP is disabled for voice turns.
 *  - non-empty array                     : only those qualified tool names are
 *                                          exposed.
 *
 * Persisted via the existing `voice:update-config` IPC handler, which also
 * writes `voiceMcpToolsAllow` to user-settings.json so the selection
 * survives an app restart.
 */

import { useState } from "react";
import { Plug, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { McpToolPicker } from "@/components/mcp/McpToolPicker";
import { VoiceAssistantClient as voiceAssistantClient } from "@/ipc/voice_assistant_client";
import { showError, showSuccess } from "@/lib/toast";

const VOICE_CONFIG_KEY = ["voice", "config"] as const;

interface VoiceMcpAllowList {
  /**
   * `null` here is the wire representation of "unset / use all tools".
   * The picker UI works with `Set<string> | undefined`; we coerce at the
   * boundary to keep the React-Query cache JSON-friendly.
   */
  allow: string[] | null;
}

export function VoiceMcpSettings() {
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);

  // ----- Read: hydrate the current allow-list from main-process config.
  const configQuery = useQuery<VoiceMcpAllowList, Error>({
    queryKey: VOICE_CONFIG_KEY,
    queryFn: async () => {
      const cfg = await voiceAssistantClient.getConfig();
      const list = cfg.mcpToolsAllow;
      return { allow: Array.isArray(list) ? list : null };
    },
    meta: { showErrorToast: true },
  });

  // ----- Write: persist a new allow-list, then invalidate so the cache
  //              reflects whatever the main process actually stored.
  //              On failure we DO NOT optimistically mutate the local
  //              state, so the badge/picker can never drift away from
  //              the persisted value.
  const updateMutation = useMutation<
    VoiceMcpAllowList,
    Error,
    string[] | null
  >({
    mutationFn: async (next) => {
      const cfg = await voiceAssistantClient.updateConfig({
        mcpToolsAllow: next === null ? undefined : next,
      });
      const list = cfg.mcpToolsAllow;
      return { allow: Array.isArray(list) ? list : null };
    },
    onSuccess: async (result) => {
      // Trust the server's view of the world.
      queryClient.setQueryData<VoiceMcpAllowList>(VOICE_CONFIG_KEY, result);
      await queryClient.invalidateQueries({ queryKey: VOICE_CONFIG_KEY });
      showSuccess("Voice MCP settings saved");
    },
    onError: (err) => {
      showError(
        `Failed to save voice MCP settings: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    },
  });

  const loading = configQuery.isLoading;
  const saving = updateMutation.isPending;
  const allow = configQuery.data?.allow ?? null;
  const allowSet = allow === null ? undefined : new Set(allow);
  const count = allow === null ? null : allow.length;

  const handleChange = (next: Set<string>) => {
    updateMutation.mutate(Array.from(next));
  };

  const handleResetToAll = () => {
    updateMutation.mutate(null);
  };

  return (
    <Card id="voice-mcp-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-4 w-4" /> Voice Assistant MCP Tools
          {count !== null && (
            <Badge variant="secondary" className="ml-1 h-5">
              {count === 0 ? "disabled" : count}
            </Badge>
          )}
          {count === null && (
            <Badge variant="outline" className="ml-1 h-5">
              all tools
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Restrict which MCP tools the voice assistant may invoke. Leave
          unset to expose every enabled MCP server&rsquo;s tools.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                // If currently "all tools", flip to an explicit empty
                // allow-list so the picker has something concrete to
                // mutate. We persist this intent immediately so refreshing
                // the page doesn't quietly revert to "all tools".
                if (allow === null) {
                  updateMutation.mutate([]);
                }
                setPickerOpen(true);
              }}
              disabled={saving}
            >
              <Plug className="h-4 w-4 mr-2" />
              {count === null
                ? "Customise MCP Tools"
                : count === 0
                  ? "Enable MCP Tools"
                  : "Manage MCP Tools"}
            </Button>
            {count !== null && (
              <Button
                variant="ghost"
                onClick={handleResetToAll}
                disabled={saving}
              >
                Use all enabled tools
              </Button>
            )}
            {saving && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </>
        )}

        <McpToolPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          selected={allowSet ?? new Set<string>()}
          onChange={handleChange}
          scopeLabel="voice assistant turns"
        />
      </CardContent>
    </Card>
  );
}

export default VoiceMcpSettings;
