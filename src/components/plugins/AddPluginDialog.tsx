import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMcp, type Transport } from "@/hooks/useMcp";
import type { McpServer } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { DEFAULT_OAUTH_CALLBACK_PORT } from "@/ipc/types/mcp";
import { showError, showInfo } from "@/lib/toast";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddMcpServerDeepLinkData } from "@/ipc/deep_link_data";
import { OauthPlaintextStorageAlert } from "./OauthPlaintextStorageAlert";

export function useOauthCallbackPort() {
  // Falls back to the default port on probe failure so the UI
  // doesn't show "…" forever; the OAuth flow uses the same default.
  // The port stays stable while the form is open so the redirect-URI
  // hint matches the value saved on submit -- the user may register it
  // at their provider mid-form. A taken port surfaces on bind instead.
  const callbackPortQuery = useQuery({
    queryKey: ["mcp", "callbackPort"],
    queryFn: () =>
      ipc.mcp
        .probeCallbackPort()
        .then((r) => r.port)
        .catch(() => DEFAULT_OAUTH_CALLBACK_PORT),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return callbackPortQuery.data ?? null;
}

export function useOauthStorageEncrypted() {
  // Assume encrypted on probe failure — a false-positive banner is
  // worse than going silent on a transient IPC hiccup.
  const oauthStorageEncryptedQuery = useQuery({
    queryKey: ["mcp", "isOauthStorageEncrypted"],
    queryFn: () =>
      ipc.mcp
        .isOauthStorageEncrypted()
        .then((r) => r.available)
        .catch(() => true),
    staleTime: 5 * 60 * 1000,
  });
  return oauthStorageEncryptedQuery.data ?? null;
}

export function AddPluginDialog({
  open,
  onOpenChange,
  onServerCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Invoked after a successful create so the caller can kick off the
  // OAuth flow (or a probe) and surface feedback on the new card.
  onServerCreated: (
    created: McpServer,
    opts: { wantsOAuth: boolean; callbackPort: number | null },
  ) => Promise<void>;
}) {
  const { createServer } = useMcp();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState<string>("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [oauthEnabled, setOauthEnabled] = useState(true);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const callbackPort = useOauthCallbackPort();
  const oauthStorageEncrypted = useOauthStorageEncrypted();

  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  useEffect(() => {
    if (lastDeepLink?.type === "add-mcp-server") {
      const deepLink = lastDeepLink as AddMcpServerDeepLinkData;
      const payload = deepLink.payload;
      showInfo(`Prefilled ${payload.name} plugin`);
      setName(payload.name);
      setTransport(payload.config.type);
      if (payload.config.type === "stdio") {
        const [command, ...args] = payload.config.command.split(" ");
        setCommand(command);
        setArgs(args.join(" "));
      } else {
        setUrl(payload.config.url);
      }
      clearLastDeepLink();
    }
  }, [lastDeepLink?.timestamp]);

  const onCreate = async () => {
    if (isAdding) return;
    setIsAdding(true);
    try {
      await runOnCreate();
    } finally {
      setIsAdding(false);
    }
  };

  const runOnCreate = async () => {
    if (transport === "stdio" && !command.trim()) {
      showError("Command is required for stdio MCP servers.");
      return;
    }
    if (transport === "http") {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        showError("URL is required for HTTP MCP servers.");
        return;
      }
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          showError("URL must use http:// or https://");
          return;
        }
      } catch {
        showError(`Invalid URL: "${trimmedUrl}"`);
        return;
      }
    }
    const parsedArgs = (() => {
      const trimmed = args.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("[")) {
        try {
          const arr = JSON.parse(trimmed);
          return Array.isArray(arr) && arr.every((x) => typeof x === "string")
            ? (arr as string[])
            : null;
        } catch {
          // fall through
        }
      }
      return trimmed.split(" ").filter(Boolean);
    })();
    const wantsOAuth = oauthEnabled && transport === "http";
    const created = await createServer({
      name,
      transport,
      command: command || null,
      args: parsedArgs,
      url: url || null,
      enabled,
      oauthEnabled: wantsOAuth,
      // Skip OAuth fields if the user turned the toggle off — no
      // stray client secret in the DB (especially not as plaintext).
      oauthClientId: wantsOAuth ? oauthClientId.trim() || null : null,
      oauthClientSecret: wantsOAuth ? oauthClientSecret.trim() || null : null,
      oauthScope: wantsOAuth ? oauthScope.trim() || null : null,
      oauthCallbackPort:
        wantsOAuth && typeof callbackPort === "number" ? callbackPort : null,
    });
    setName("");
    setTransport("stdio");
    setCommand("");
    setArgs("");
    setUrl("");
    setEnabled(true);
    setOauthEnabled(true);
    setOauthClientId("");
    setOauthClientSecret("");
    setOauthScope("");
    onOpenChange(false);

    if (transport === "http" && created) {
      await onServerCreated(created, {
        wantsOAuth,
        callbackPort: typeof callbackPort === "number" ? callbackPort : null,
      });
    }
  };

  // Surface the no-keyring warning as soon as the user is about to
  // commit an OAuth secret (form has HTTP + OAuth toggle on), not
  // only after a server already exists.
  const willPersistOauthSecret =
    transport === "http" && oauthEnabled && oauthClientSecret.trim().length > 0;
  const showPlaintextBanner =
    oauthStorageEncrypted === false && willPersistOauthSecret;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Plugin</DialogTitle>
          <DialogDescription>
            Connect an MCP server to give the AI new tools.
          </DialogDescription>
        </DialogHeader>
        {showPlaintextBanner && <OauthPlaintextStorageAlert />}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My MCP Server"
              />
            </div>
            <div>
              <Label htmlFor="mcp-transport-select">Transport</Label>
              <select
                id="mcp-transport-select"
                data-testid="mcp-transport-select"
                value={transport}
                onChange={(e) => setTransport(e.target.value as Transport)}
                className="w-full h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </div>
            {transport === "stdio" && (
              <>
                <div>
                  <Label>Command</Label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="node"
                  />
                </div>
                <div>
                  <Label>Args</Label>
                  <Input
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="path/to/mcp-server.js --flag"
                  />
                </div>
              </>
            )}
            {transport === "http" && (
              <>
                <div className="col-span-2">
                  <Label>URL</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                  />
                </div>
                <div className="col-span-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      aria-label="Use OAuth"
                      checked={oauthEnabled}
                      onCheckedChange={setOauthEnabled}
                    />
                    <Label>Use OAuth</Label>
                  </div>
                  <div className="ml-10 mt-1 text-xs text-muted-foreground">
                    Required for most remote servers.
                  </div>
                </div>
                {oauthEnabled && (
                  <div className="col-span-2">
                    <Accordion>
                      <AccordionItem value="advanced">
                        <AccordionTrigger className="py-2 text-sm">
                          Advanced OAuth options
                        </AccordionTrigger>
                        <AccordionContent className="space-y-3">
                          <div className="space-y-1">
                            <Label>OAuth Client ID</Label>
                            <div className="text-xs text-muted-foreground">
                              If the MCP server's setup requires you to register
                              an app, paste the Client ID of your app here.
                              Otherwise leave this blank.
                            </div>
                            <Input
                              value={oauthClientId}
                              onChange={(e) => setOauthClientId(e.target.value)}
                              placeholder="Pre-registered client ID"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>OAuth Client Secret</Label>
                            <div className="text-xs text-muted-foreground">
                              Include this only if the MCP server gave you a
                              secret alongside the Client ID.
                            </div>
                            <Input
                              type="password"
                              value={oauthClientSecret}
                              onChange={(e) =>
                                setOauthClientSecret(e.target.value)
                              }
                              placeholder="Pre-registered client secret"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>OAuth Scope</Label>
                            <div className="text-xs text-muted-foreground">
                              Permissions to request, space-separated. Leave
                              this blank to use the server's default.
                            </div>
                            <Input
                              value={oauthScope}
                              onChange={(e) => setOauthScope(e.target.value)}
                              placeholder=""
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            If you include a Client ID, make sure that you
                            register{" "}
                            <code>
                              http://localhost:
                              {callbackPort ?? "…"}
                              /callback
                            </code>{" "}
                            as a redirect URI for your MCP server. Your MCP
                            server most likely provides a dashboard where you
                            can do this.
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center gap-2">
              <Switch
                aria-label="Enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label>Enabled</Label>
            </div>
          </div>
          <div>
            <Button onClick={onCreate} disabled={!name.trim() || isAdding}>
              {isAdding ? "Adding…" : "Add Plugin"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
