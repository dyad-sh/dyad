import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Bot,
  Camera,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Server,
  Sparkles,
  Trash2,
  Upload,
  RotateCcw,
} from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAgentOsAgents } from "@/hooks/useAgentOsAgents";
import type { Agent } from "./data";
import type { CreateAgentOsAgent, UpdateAgentOsAgent } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { useSettings } from "@/hooks/useSettings";
import {
  closeHermesWorkspaceTab,
  openHermesWorkspaceTab,
} from "@/lib/hermes_workspace_tabs";
import { showError, showSuccess } from "@/lib/toast";
import { HermesAgentChat } from "./HermesAgentChat";
import { LovableWebDevChat } from "./LovableWebDevChat";
import {
  LOVABLE_WEB_DEV_AGENT,
  LOVABLE_WEB_DEV_AGENT_ID,
} from "@/lib/lovable_web_dev";
import { lovableWebDevAvatarAtom } from "@/atoms/chatAgentAtoms";
import {
  activeAgentWorkspaceTabAtom,
  agentWorkspaceTabsAtom,
} from "@/atoms/chatAgentAtoms";
import { useAtom } from "jotai";

const MAX_AVATAR_FILE_SIZE = 25 * 1024 * 1024;
const AVATAR_SIZE = 512;

function isAvatarImage(value: string) {
  return value.startsWith("data:image/");
}

function agentInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "H";
}

async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file for the avatar.");
  }
  if (file.size > MAX_AVATAR_FILE_SIZE) {
    throw new Error("Avatar images must be smaller than 25 MB.");
  }

  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Could not read the avatar image."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Could not decode the avatar."));
    element.src = source;
  });

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the avatar.");

  const scale = Math.max(AVATAR_SIZE / image.width, AVATAR_SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(
    image,
    (AVATAR_SIZE - width) / 2,
    (AVATAR_SIZE - height) / 2,
    width,
    height,
  );
  return canvas.toDataURL("image/jpeg", 0.86);
}

// Exported so the Agents index can show the same avatar the dashboard shows,
// rather than growing a second one that drifts from it.
export function AgentAvatar({
  agent,
  className,
}: {
  agent: Pick<Agent, "name" | "icon">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/20 to-violet-500/15 text-xl font-semibold text-cyan-100 shadow-[0_0_24px_rgba(0,229,255,0.12)]",
        className,
      )}
    >
      {isAvatarImage(agent.icon) ? (
        <img
          src={agent.icon}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <span aria-hidden>{agent.icon || agentInitial(agent.name)}</span>
      )}
    </span>
  );
}

type HermesAgentFormProps = {
  open: boolean;
  editing: Agent | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: CreateAgentOsAgent) => Promise<unknown>;
  onUpdate: (params: UpdateAgentOsAgent) => Promise<unknown>;
};

function HermesAgentForm({
  open,
  editing,
  onOpenChange,
  onCreate,
  onUpdate,
}: HermesAgentFormProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("hermes");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [processingAvatar, setProcessingAvatar] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setAvatar(editing?.icon ?? "");
    setDescription(editing?.description ?? "");
    setEndpoint(editing?.endpoint ?? "");
    setModel(editing?.model || "hermes");
    setApiKey("");
    setSubmitting(false);
    setProcessingAvatar(false);
  }, [editing, open]);

  const chooseAvatar = async (file?: File) => {
    if (!file) return;
    setProcessingAvatar(true);
    try {
      setAvatar(await resizeAvatar(file));
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Could not use that avatar.",
      );
    } finally {
      setProcessingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!name.trim() || submitting || processingAvatar) return;
    setSubmitting(true);
    try {
      const shared = {
        name: name.trim(),
        type: "Hermes" as const,
        icon: avatar || "🪽",
        description: description.trim(),
        endpoint: endpoint.trim(),
        model: model.trim() || "hermes",
        capabilities: ["chat", "tools", "memory"],
      };
      if (editing) {
        await onUpdate({
          id: editing.id,
          ...shared,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
        showSuccess(`${shared.name} updated`);
      } else {
        await onCreate({
          ...shared,
          apiKey: apiKey.trim() || undefined,
        });
        showSuccess(`${shared.name} added`);
      }
      onOpenChange(false);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Could not save this agent.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const previewAgent = { name, icon: avatar || "🪽" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto border-cyan-400/20 bg-[#061225] text-white shadow-[0_0_60px_rgba(0,229,255,0.14)]">
        <DialogHeader>
          <DialogTitle className="font-jarvis-display text-xl text-white">
            {editing ? "Edit Hermes Agent" : "Add Hermes Agent"}
          </DialogTitle>
          <DialogDescription className="text-cyan-100/45">
            Give your agent a name, avatar, and Hermes connection details.
            Everything is stored on this device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl border border-cyan-500/12 bg-cyan-950/20 p-4">
            <AgentAvatar agent={previewAgent} className="size-20" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-cyan-50">Agent avatar</p>
              <p className="mt-0.5 text-xs text-cyan-100/35">
                JPG, PNG or WebP up to 25 MB
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={processingAvatar}
                  className="border-cyan-400/20 bg-cyan-500/8 text-cyan-50"
                >
                  {processingAvatar ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  Choose image
                </Button>
                {isAvatarImage(avatar) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setAvatar("")}
                    className="text-cyan-100/45"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => void chooseAvatar(event.target.files?.[0])}
                data-testid="hermes-agent-avatar-input"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hermes-agent-name">Agent name</Label>
            <Input
              id="hermes-agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Hermes Prime"
              autoFocus
              data-testid="agent-os-add-name"
              className="border-cyan-500/15 bg-cyan-950/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hermes-agent-description">Description</Label>
            <Input
              id="hermes-agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Research, planning, development…"
              className="border-cyan-500/15 bg-cyan-950/20"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hermes-agent-endpoint">Hermes server URL</Label>
            <Input
              id="hermes-agent-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="http://192.168.1.20:8642/v1"
              className="border-cyan-500/15 bg-cyan-950/20 font-mono"
            />
            <p className="text-[11px] text-cyan-100/30">
              OpenAI-compatible base URL or full `/chat/completions` endpoint.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hermes-agent-model">Model</Label>
              <Input
                id="hermes-agent-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="hermes"
                className="border-cyan-500/15 bg-cyan-950/20 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hermes-agent-api-key">API key</Label>
              <Input
                id="hermes-agent-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  editing?.hasApiKey ? "Leave blank to keep key" : "Optional"
                }
                className="border-cyan-500/15 bg-cyan-950/20"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || submitting || processingAvatar}
            data-testid="agent-os-add-submit"
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {editing ? "Save Agent" : "Add Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Makes this agent the brain behind the JARVIS voice assistant. Exactly one
 * agent holds the role, so switching it on here takes it off whichever agent
 * had it. ElevenLabs still supplies only the audio pipeline and voice — this
 * chooses what actually thinks.
 */
function VoiceBrainToggle({ agent }: { agent: Agent }) {
  const { settings, updateSettings } = useSettings();
  const isBrain = settings?.jarvis?.brainAgentId === agent.id;
  const hasHttpEndpoint = /^https?:\/\//i.test(agent.endpoint?.trim() ?? "");
  // JARVIS streams chat completions, so an MCP-only agent (no
  // /chat/completions API) cannot serve as the brain.
  const isChatCapable = agent.type !== "MCP";
  const canSelect = hasHttpEndpoint && isChatCapable && agent.enabled;
  const toggleId = `voice-brain-${agent.id}`;

  const hint = !isChatCapable
    ? "MCP-only agents cannot drive JARVIS"
    : !hasHttpEndpoint
      ? "Needs an HTTP endpoint to drive JARVIS"
      : !agent.enabled
        ? "Enable this agent to let it drive JARVIS"
        : isBrain
          ? "Answers every JARVIS voice turn"
          : "Use as the JARVIS voice brain";

  return (
    <div
      className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] px-3 py-2.5"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <div className="min-w-0">
        <label
          htmlFor={toggleId}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium",
            canSelect ? "text-cyan-100/85" : "text-cyan-100/35",
          )}
        >
          <AudioLines className="size-3.5 shrink-0" />
          JARVIS voice brain
        </label>
        <p className="mt-0.5 text-[11px] leading-4 text-cyan-100/40">{hint}</p>
      </div>
      <Switch
        id={toggleId}
        checked={isBrain}
        disabled={!canSelect}
        aria-label={`Use ${agent.name} as the JARVIS voice brain`}
        data-testid={`agent-os-voice-brain-${agent.id}`}
        onCheckedChange={(checked) => {
          // Only the fields being changed: a whole-object write from here
          // would clobber voice settings saved on the Settings page.
          void updateSettings({
            jarvis: {
              // Clearing falls back to the configured model roles.
              brainAgentId: checked ? agent.id : undefined,
              modelMode: checked ? "agent" : settings?.jarvis?.modelMode,
            },
          });
        }}
      />
    </div>
  );
}

export default function AgentOsPage() {
  const {
    agents,
    isLoading,
    createAgent,
    updateAgent,
    toggleAgent,
    deleteAgent,
  } = useAgentOsAgents();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);
  const [openWorkspaceTabs, setOpenWorkspaceTabs] = useAtom(
    agentWorkspaceTabsAtom,
  );
  const [activeTab, setActiveTab] = useAtom(activeAgentWorkspaceTabAtom);
  const [webDevAvatar, setWebDevAvatar] = useAtom(lovableWebDevAvatarAtom);
  const webDevAvatarInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingWebDevAvatar, setIsProcessingWebDevAvatar] =
    useState(false);
  const webDevAgent = useMemo(
    () => ({ ...LOVABLE_WEB_DEV_AGENT, icon: webDevAvatar || "🌐" }),
    [webDevAvatar],
  );

  const hermesAgents = useMemo(
    () => agents.filter((agent) => agent.type === "Hermes"),
    [agents],
  );
  const dashboardAgents = useMemo(
    () =>
      [webDevAgent, ...hermesAgents].filter(
        (agent) =>
          !search.trim() ||
          `${agent.name} ${agent.description} ${agent.endpoint}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [hermesAgents, search, webDevAgent],
  );

  const chooseWebDevAvatar = async (file?: File) => {
    if (!file) return;
    setIsProcessingWebDevAvatar(true);
    try {
      setWebDevAvatar(await resizeAvatar(file));
      showSuccess("Web Dev avatar updated");
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Could not update the Web Dev avatar.",
      );
    } finally {
      setIsProcessingWebDevAvatar(false);
      if (webDevAvatarInputRef.current) {
        webDevAvatarInputRef.current.value = "";
      }
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openAgentChat = (agent: Agent) => {
    setOpenWorkspaceTabs((current) =>
      openHermesWorkspaceTab(current, {
        id: agent.id,
        name: agent.name,
        icon: agent.icon || "🪽",
      }),
    );
    setActiveTab(agent.id);
  };

  const closeAgentChat = (agentId: string) => {
    const openAgentIds = openWorkspaceTabs.map((tab) => tab.id);
    const next = closeHermesWorkspaceTab(openAgentIds, agentId, activeTab);
    setOpenWorkspaceTabs((current) =>
      current.filter((tab) => tab.id !== agentId),
    );
    setActiveTab(next.activeTab);
  };

  const openAgents = openWorkspaceTabs
    .map((tab) => tab.id)
    .map((id) =>
      id === LOVABLE_WEB_DEV_AGENT_ID
        ? webDevAgent
        : agents.find((agent) => agent.id === id),
    )
    .filter((agent): agent is Agent => Boolean(agent));

  return (
    <div
      className="home-jarvis no-app-region-drag relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#020916]"
      data-testid="agent-os-page"
    >
      <div className="relative min-h-0 flex-1">
        <section
          className={cn(
            "agent-os home-jarvis absolute inset-0 flex min-h-0 flex-col overflow-hidden",
            activeTab !== "dashboard" && "hidden",
          )}
          data-testid="agent-os-dashboard"
        >
          <ParticleBackground className="z-0" />

          <header className="relative z-10 border-b border-cyan-400/10 bg-[rgba(3,10,22,0.58)] px-5 py-5 backdrop-blur-xl sm:px-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 text-cyan-200 shadow-[0_0_30px_rgba(0,229,255,0.15)]">
                  <Bot className="size-6" />
                </span>
                <div>
                  <h1 className="font-jarvis-display text-2xl font-semibold tracking-wide text-white">
                    Hermes Agents
                  </h1>
                  <p className="mt-0.5 text-sm text-cyan-100/40">
                    Built-in specialists and your connected Hermes assistants
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={openCreate}
                data-testid="agent-os-add-agent"
                className="border-cyan-400/20 bg-cyan-500/6 text-cyan-100/80 hover:border-cyan-400/40 hover:bg-cyan-500/12 hover:text-cyan-50"
              >
                <Plus className="size-4" />
                Add Hermes Agent
              </Button>
            </div>
          </header>

          <main className="scrollbar-on-hover relative z-10 min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
            <div className="mx-auto max-w-6xl">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-cyan-50/85">
                    {isLoading
                      ? "Loading your agents…"
                      : `${dashboardAgents.length} agent${dashboardAgents.length === 1 ? "" : "s"}`}
                  </p>
                  <p className="mt-0.5 text-xs text-cyan-100/35">
                    Add an avatar and connection details for each assistant.
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cyan-100/30" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search Hermes agents"
                    className="border-cyan-500/15 bg-cyan-950/25 pl-9"
                  />
                </div>
              </div>

              {isLoading ? (
                <div className="grid min-h-64 place-items-center">
                  <Loader2 className="size-7 animate-spin text-cyan-300" />
                </div>
              ) : dashboardAgents.length === 0 ? (
                <section className="grid min-h-[26rem] place-items-center rounded-3xl border border-dashed border-cyan-400/20 bg-[rgba(6,18,34,0.55)] p-8 text-center">
                  <div className="max-w-md">
                    <span className="mx-auto grid size-20 place-items-center rounded-3xl border border-cyan-400/20 bg-cyan-500/8 text-cyan-200 shadow-[0_0_40px_rgba(0,229,255,0.12)]">
                      <Camera className="size-9" />
                    </span>
                    <h2 className="mt-5 font-jarvis-display text-xl font-semibold text-white">
                      {search
                        ? "No matching agents"
                        : "Add your first Hermes agent"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-cyan-100/40">
                      {search
                        ? "Try a different name or server address."
                        : "Create a personal agent card with its name, avatar image, Hermes server, model, and API key."}
                    </p>
                    {!search && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={openCreate}
                        className="mt-5 border-cyan-400/20 bg-cyan-500/6 text-cyan-100/80 hover:border-cyan-400/40 hover:bg-cyan-500/12 hover:text-cyan-50"
                        data-testid="agent-os-empty-add"
                      >
                        <Plus className="size-4" />
                        Add Hermes Agent
                      </Button>
                    )}
                  </div>
                </section>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {dashboardAgents.map((agent) => {
                    const isWebDev = agent.id === LOVABLE_WEB_DEV_AGENT_ID;
                    return (
                      <article
                        key={agent.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openAgentChat(agent)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openAgentChat(agent);
                          }
                        }}
                        className="group overflow-hidden rounded-2xl border border-cyan-400/15 bg-[rgba(6,18,34,0.78)] shadow-[0_0_28px_rgba(0,229,255,0.05)] transition hover:border-cyan-400/30 hover:shadow-[0_0_32px_rgba(0,229,255,0.1)]"
                      >
                        <div className="h-14 border-b border-cyan-500/8 bg-cyan-950/20" />
                        <div className="-mt-7 px-4 pb-4">
                          <div className="flex items-end justify-between gap-3">
                            <AgentAvatar
                              agent={agent}
                              className="size-14 text-base"
                            />
                            <div className="mb-1 flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-wide",
                                  isWebDev
                                    ? "border-amber-400/20 bg-amber-500/8 text-amber-300"
                                    : agent.enabled
                                      ? "border-emerald-400/20 bg-emerald-500/8 text-emerald-300"
                                      : "border-slate-400/15 bg-slate-500/8 text-slate-400",
                                )}
                              >
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    isWebDev
                                      ? "bg-amber-400"
                                      : agent.enabled
                                        ? "bg-emerald-400"
                                        : "bg-slate-500",
                                  )}
                                />
                                {isWebDev
                                  ? "MCP only"
                                  : agent.enabled
                                    ? "Enabled"
                                    : "Disabled"}
                              </span>
                              {!isWebDev && (
                                <span
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  <Switch
                                    checked={agent.enabled}
                                    onCheckedChange={(enabled) =>
                                      void toggleAgent({
                                        id: agent.id,
                                        enabled,
                                      })
                                    }
                                    aria-label={`Enable ${agent.name}`}
                                  />
                                </span>
                              )}
                            </div>
                          </div>

                          <h2 className="mt-3 truncate font-jarvis-display text-base font-semibold text-white">
                            {agent.name}
                          </h2>
                          <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-cyan-100/40">
                            {agent.description || "Personal Hermes assistant"}
                          </p>

                          <div className="mt-3 space-y-1.5 rounded-xl border border-cyan-500/10 bg-cyan-950/20 p-2.5">
                            <div className="flex min-w-0 items-center gap-2 text-xs">
                              <Server className="size-3.5 shrink-0 text-cyan-300/70" />
                              <span className="truncate font-mono text-cyan-100/50">
                                {agent.endpoint || "Server not configured"}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-center gap-2 text-xs">
                              <Sparkles className="size-3.5 shrink-0 text-violet-300/70" />
                              <span className="truncate font-mono text-cyan-100/50">
                                {agent.model || "hermes"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <KeyRound className="size-3.5 text-emerald-300/70" />
                              <span className="text-cyan-100/50">
                                {isWebDev
                                  ? "Lovable OAuth required"
                                  : agent.hasApiKey
                                    ? "API key configured"
                                    : "No API key"}
                              </span>
                            </div>
                          </div>

                          <VoiceBrainToggle agent={agent} />

                          <div className="mt-3 flex items-center gap-2 border-t border-cyan-500/10 pt-3">
                            {isWebDev ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    webDevAvatarInputRef.current?.click();
                                  }}
                                  disabled={isProcessingWebDevAvatar}
                                  className="flex-1 border-cyan-400/15 bg-cyan-500/5 text-cyan-50"
                                  data-testid="web-dev-change-avatar"
                                >
                                  {isProcessingWebDevAvatar ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Camera className="size-3.5" />
                                  )}
                                  Change avatar
                                </Button>
                                {webDevAvatar !== "🌐" && (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setWebDevAvatar("🌐");
                                      showSuccess(
                                        "Web Dev avatar reset to default",
                                      );
                                    }}
                                    aria-label="Reset Web Dev avatar"
                                    className="size-8 text-cyan-100/55 hover:bg-cyan-500/10 hover:text-cyan-50"
                                    data-testid="web-dev-reset-avatar"
                                  >
                                    <RotateCcw className="size-4" />
                                  </Button>
                                )}
                                <span
                                  className="sr-only"
                                  title="Built-in agent · cannot be removed"
                                >
                                  <LockKeyhole className="size-3.5" />
                                  Built-in agent · cannot be removed
                                </span>
                              </>
                            ) : (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditing(agent);
                                    setFormOpen(true);
                                  }}
                                  className="flex-1 border-cyan-400/15 bg-cyan-500/5 text-cyan-50"
                                  data-testid={`agent-os-edit-${agent.id}`}
                                >
                                  <Pencil className="size-3.5" />
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteTarget(agent);
                                  }}
                                  aria-label={`Delete ${agent.name}`}
                                  className="size-8 text-rose-300/65 hover:bg-rose-500/10 hover:text-rose-300"
                                  data-testid={`agent-os-delete-${agent.id}`}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </main>

          <HermesAgentForm
            open={formOpen}
            editing={editing}
            onOpenChange={(open) => {
              setFormOpen(open);
              if (!open) setEditing(null);
            }}
            onCreate={createAgent}
            onUpdate={updateAgent}
          />

          <input
            ref={webDevAvatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="Choose Web Dev avatar image"
            onChange={(event) =>
              void chooseWebDevAvatar(event.target.files?.[0])
            }
          />

          <Dialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
          >
            <DialogContent className="max-w-sm border-rose-400/20 bg-[#061225] text-white">
              <DialogHeader>
                <DialogTitle>Remove Hermes agent?</DialogTitle>
                <DialogDescription className="text-cyan-100/45">
                  {deleteTarget?.name} will be removed from this dashboard.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!deleteTarget) return;
                    try {
                      await deleteAgent(deleteTarget.id);
                      closeAgentChat(deleteTarget.id);
                      showSuccess(`${deleteTarget.name} removed`);
                      setDeleteTarget(null);
                    } catch (error) {
                      showError(
                        error instanceof Error
                          ? error.message
                          : "Could not remove this agent.",
                      );
                    }
                  }}
                  data-testid="agent-os-delete-confirm"
                >
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>

        {openAgents.map((agent) => (
          <section
            key={agent.id}
            className={cn(
              "absolute inset-0 flex min-h-0",
              activeTab !== agent.id && "hidden",
            )}
            aria-hidden={activeTab !== agent.id}
          >
            {agent.id === LOVABLE_WEB_DEV_AGENT_ID ? (
              <LovableWebDevChat
                avatar={agent.icon}
                onBack={() => setActiveTab("dashboard")}
              />
            ) : (
              <HermesAgentChat
                agent={agent}
                isActive={activeTab === agent.id}
                onBack={() => setActiveTab("dashboard")}
              />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
