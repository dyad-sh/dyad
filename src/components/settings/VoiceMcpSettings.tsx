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
 * Persisted via the existing `voice:update-config` IPC handler.
 */

import { useEffect, useState } from "react";
import { Plug, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { McpToolPicker } from "@/components/mcp/McpToolPicker";
import { VoiceAssistantClient as voiceAssistantClient } from "@/ipc/voice_assistant_client";
import { showError, showSuccess } from "@/lib/toast";

export function VoiceMcpSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // `undefined` = "all tools". `Set` (possibly empty) = explicit allow-list.
  const [allow, setAllow] = useState<Set<string> | undefined>(undefined);

  // Load the current voice config on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await voiceAssistantClient.getConfig();
        if (cancelled) return;
        const list = cfg.mcpToolsAllow;
        setAllow(Array.isArray(list) ? new Set(list) : undefined);
      } catch (err) {
        if (!cancelled) {
          showError(
            `Failed to load voice MCP settings: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: Set<string> | undefined) => {
    setSaving(true);
    try {
      await voiceAssistantClient.updateConfig({
        mcpToolsAllow: next ? Array.from(next) : undefined,
      });
      showSuccess("Voice MCP settings saved");
    } catch (err) {
      showError(
        `Failed to save voice MCP settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (next: Set<string>) => {
    setAllow(next);
    void persist(next);
  };

  const handleResetToAll = () => {
    setAllow(undefined);
    void persist(undefined);
  };

  const count = allow ? allow.size : null;

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
                // If currently "all tools", initialise with an empty Set so
                // the picker has something to mutate.
                if (!allow) setAllow(new Set<string>());
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
          selected={allow ?? new Set<string>()}
          onChange={handleChange}
          scopeLabel="voice assistant turns"
        />
      </CardContent>
    </Card>
  );
}

export default VoiceMcpSettings;
