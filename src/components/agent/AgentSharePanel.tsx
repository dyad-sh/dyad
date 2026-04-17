/**
 * AgentSharePanel — Share tab for the Agent Editor.
 * Lets users configure backend, customise widget appearance,
 * and copy share codes in 5 formats: widget, SDK, link, embed, iframe.
 */

import { useState } from "react";
import {
  Copy,
  Check,
  ExternalLink,
  Globe,
  Code,
  FrameIcon,
  Link2,
  Palette,
  Server,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import {
  useAgentShareConfig,
  useAgentShareCodes,
  useCreateShareConfig,
  useUpdateShareConfig,
} from "@/hooks/useAgentSharing";
import type {
  AgentShareBackendConfig,
  AgentShareWidgetConfig,
  ShareFormat,
} from "@/types/agent_builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FORMAT_META: Record<
  ShareFormat,
  { label: string; icon: React.ElementType; description: string }
> = {
  widget: {
    label: "Widget",
    icon: Globe,
    description: "Floating chat bubble — paste one script tag into any page.",
  },
  sdk: {
    label: "SDK",
    icon: Code,
    description:
      "JavaScript module you can import in Node.js or the browser.",
  },
  link: {
    label: "Link",
    icon: Link2,
    description: "Direct URL anyone can open to chat with your agent.",
  },
  embed: {
    label: "Embed",
    icon: FrameIcon,
    description: "Inline div + script — renders the chat inside your page.",
  },
  iframe: {
    label: "Iframe",
    icon: ExternalLink,
    description: "Raw <iframe> tag. Drop it anywhere.",
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="mr-1 h-3 w-3" /> Copy
        </>
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface AgentSharePanelProps {
  agentId: number;
  agentName: string;
}

export default function AgentSharePanel({
  agentId,
  agentName,
}: AgentSharePanelProps) {
  const { data: shareConfig, isLoading: configLoading } =
    useAgentShareConfig(agentId);
  const { data: shareCodes, isLoading: codesLoading } =
    useAgentShareCodes(shareConfig ? agentId : undefined);

  const createMut = useCreateShareConfig();
  const updateMut = useUpdateShareConfig(agentId);

  // Local state for the backend config form
  const [bc, setBc] = useState<AgentShareBackendConfig>({
    providerBaseUrl: "https://api.openai.com/v1",
    modelId: "",
    apiEndpoint: "",
    authMode: "api-key",
    port: 3001,
  });
  const [wc, setWc] = useState<AgentShareWidgetConfig>({
    primaryColor: "#6366f1",
    position: "bottom-right",
    width: 400,
    height: 600,
    welcomeMessage: "",
    showBranding: true,
  });

  // Seed local state from server when config loads
  const [seeded, setSeeded] = useState(false);
  if (shareConfig && !seeded) {
    if (shareConfig.backendConfig)
      setBc((prev) => ({ ...prev, ...shareConfig.backendConfig }));
    if (shareConfig.widgetConfig)
      setWc((prev) => ({ ...prev, ...shareConfig.widgetConfig }));
    setSeeded(true);
  }

  // -----------------------------------------------------------------------
  // Create share config if none exists
  // -----------------------------------------------------------------------

  if (configLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading share settings…
      </div>
    );
  }

  if (!shareConfig) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Share &ldquo;{agentName}&rdquo;</CardTitle>
          <CardDescription>
            Set up sharing to let others interact with your agent via a widget,
            SDK, direct link, embed, or iframe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() =>
              createMut.mutate({ agentId, title: agentName })
            }
            disabled={createMut.isPending}
          >
            {createMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Enable Sharing
          </Button>
        </CardContent>
      </Card>
    );
  }

  // -----------------------------------------------------------------------
  // Save helpers
  // -----------------------------------------------------------------------

  const saveBackend = () =>
    updateMut.mutate({
      id: shareConfig.id,
      backendConfig: bc,
    });

  const saveWidget = () =>
    updateMut.mutate({
      id: shareConfig.id,
      widgetConfig: wc,
    });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Status badge */}
      <div className="flex items-center gap-3">
        <Badge variant={shareConfig.enabled ? "default" : "secondary"}>
          {shareConfig.enabled ? "Sharing Active" : "Sharing Disabled"}
        </Badge>
        <Switch
          checked={shareConfig.enabled ?? true}
          onCheckedChange={(enabled) =>
            updateMut.mutate({ id: shareConfig.id, enabled })
          }
        />
      </div>

      <Tabs defaultValue="backend">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="backend">
            <Server className="mr-1 h-3.5 w-3.5" /> Backend
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette className="mr-1 h-3.5 w-3.5" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="codes">
            <Code className="mr-1 h-3.5 w-3.5" /> Share Codes
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        {/* Backend Configuration                                            */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="backend" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Backend Configuration</CardTitle>
              <CardDescription>
                Configure the AI provider and server settings to bring your
                agent live.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Provider Base URL</Label>
                  <Input
                    value={bc.providerBaseUrl ?? ""}
                    onChange={(e) =>
                      setBc((p) => ({ ...p, providerBaseUrl: e.target.value }))
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Model ID</Label>
                  <Input
                    value={bc.modelId ?? ""}
                    onChange={(e) =>
                      setBc((p) => ({ ...p, modelId: e.target.value }))
                    }
                    placeholder="gpt-5-mini"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>API Endpoint</Label>
                  <Input
                    value={bc.apiEndpoint ?? ""}
                    onChange={(e) =>
                      setBc((p) => ({ ...p, apiEndpoint: e.target.value }))
                    }
                    placeholder="https://your-server.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={bc.port ?? 3001}
                    onChange={(e) =>
                      setBc((p) => ({
                        ...p,
                        port: parseInt(e.target.value, 10) || 3001,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Auth Mode</Label>
                  <Select
                    value={bc.authMode ?? "api-key"}
                    onValueChange={(v) =>
                      setBc((p) => ({
                        ...p,
                        authMode: v as "none" | "api-key" | "oauth",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="api-key">API Key</SelectItem>
                      <SelectItem value="oauth">OAuth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={saveBackend}
                  disabled={updateMut.isPending}
                  size="sm"
                >
                  Save Backend Config
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Live URL */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Live URL</CardTitle>
              <CardDescription>
                Once deployed, paste the public URL here. Share codes will use
                this URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                value={shareConfig.liveUrl ?? ""}
                onChange={() => {}}
                placeholder="https://my-agent.example.com"
                onBlur={(e) =>
                  updateMut.mutate({
                    id: shareConfig.id,
                    liveUrl: e.target.value || undefined,
                  })
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* Widget Appearance                                                */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="appearance" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Widget Appearance</CardTitle>
              <CardDescription>
                Customise colours, size and position of the chat widget.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Primary Colour</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={wc.primaryColor ?? "#6366f1"}
                      onChange={(e) =>
                        setWc((p) => ({ ...p, primaryColor: e.target.value }))
                      }
                      className="h-9 w-12 p-1"
                    />
                    <Input
                      value={wc.primaryColor ?? "#6366f1"}
                      onChange={(e) =>
                        setWc((p) => ({ ...p, primaryColor: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Position</Label>
                  <Select
                    value={wc.position ?? "bottom-right"}
                    onValueChange={(v) =>
                      setWc((p) => ({
                        ...p,
                        position: v as AgentShareWidgetConfig["position"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bottom-right">Bottom Right</SelectItem>
                      <SelectItem value="bottom-left">Bottom Left</SelectItem>
                      <SelectItem value="top-right">Top Right</SelectItem>
                      <SelectItem value="top-left">Top Left</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Width (px)</Label>
                  <Input
                    type="number"
                    value={wc.width ?? 400}
                    onChange={(e) =>
                      setWc((p) => ({
                        ...p,
                        width: parseInt(e.target.value, 10) || 400,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Height (px)</Label>
                  <Input
                    type="number"
                    value={wc.height ?? 600}
                    onChange={(e) =>
                      setWc((p) => ({
                        ...p,
                        height: parseInt(e.target.value, 10) || 600,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Welcome Message</Label>
                <Textarea
                  value={wc.welcomeMessage ?? ""}
                  onChange={(e) =>
                    setWc((p) => ({ ...p, welcomeMessage: e.target.value }))
                  }
                  placeholder="Hi! How can I help you today?"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={wc.showBranding ?? true}
                  onCheckedChange={(v) =>
                    setWc((p) => ({ ...p, showBranding: v }))
                  }
                />
                <Label>Show &ldquo;Powered by JoyCreate&rdquo;</Label>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <Label>Custom CSS (optional)</Label>
                <Textarea
                  value={wc.customCss ?? ""}
                  onChange={(e) =>
                    setWc((p) => ({ ...p, customCss: e.target.value }))
                  }
                  placeholder=".chat-header { background: #1a1a2e; }"
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={saveWidget}
                  disabled={updateMut.isPending}
                  size="sm"
                >
                  Save Appearance
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        {/* Share Codes                                                      */}
        {/* ---------------------------------------------------------------- */}
        <TabsContent value="codes" className="space-y-4 pt-4">
          {codesLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating share codes…
            </div>
          ) : shareCodes ? (
            (Object.keys(FORMAT_META) as ShareFormat[]).map((fmt) => {
              const meta = FORMAT_META[fmt];
              const Icon = meta.icon;
              const code = shareCodes[fmt];
              return (
                <Card key={fmt}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm">{meta.label}</CardTitle>
                      </div>
                      <CopyButton text={code} />
                    </div>
                    <CardDescription className="text-xs">
                      {meta.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                      <code>{code}</code>
                    </pre>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              Save your backend configuration first to generate share codes.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
