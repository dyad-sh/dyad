import { useEffect, useState } from "react";
import { Boxes, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CreateAgentOsAgent, UpdateAgentOsAgent } from "@/ipc/types";
import { resolveImageBaseUrl } from "@/ipc/utils/hermes_image_urls";
import type { Agent, AgentType } from "../data";
import { AGENT_ICONS, AGENT_TYPES, AGENT_TYPE_PRESETS } from "../data";
import { EmptyState, GlassCard, StatusBadge, TypeBadge } from "../ui";

const field =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/50";
const labelCls = "text-xs font-medium uppercase tracking-wide text-white/45";

function AgentFormModal({
  open,
  onOpenChange,
  editing,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Agent | null;
  onCreate: (params: CreateAgentOsAgent) => Promise<unknown>;
  onUpdate: (params: UpdateAgentOsAgent) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AgentType>("Custom");
  const [icon, setIcon] = useState("🤖");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form state whenever the modal opens (for create vs edit).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setApiKey("");
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      setIcon(editing.icon);
      setDescription(editing.description);
      setEndpoint(editing.endpoint);
      setImageBaseUrl(editing.imageBaseUrl);
      setModel(editing.model);
      setCapabilities(editing.capabilities.join(", "));
    } else {
      const preset = AGENT_TYPE_PRESETS.Custom;
      setName("");
      setType("Custom");
      setIcon(preset.icon);
      setDescription("");
      setEndpoint("");
      setImageBaseUrl("");
      setModel("");
      setCapabilities("");
    }
  }, [open, editing]);

  // Shown as the placeholder so it is clear what "blank" resolves to.
  const derivedImageBase = resolveImageBaseUrl(endpoint);

  const onTypeChange = (next: AgentType) => {
    setType(next);
    // In create mode, pre-fill icon/capabilities from the type preset.
    if (!editing) {
      const preset = AGENT_TYPE_PRESETS[next];
      setIcon(preset.icon);
      if (!capabilities.trim()) setCapabilities(preset.capabilities);
    }
  };

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const caps = capabilities
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    try {
      if (editing) {
        await onUpdate({
          id: editing.id,
          name: name.trim(),
          type,
          icon,
          description: description.trim(),
          endpoint: endpoint.trim(),
          imageBaseUrl: imageBaseUrl.trim(),
          model: model.trim(),
          capabilities: caps,
          // Only send apiKey if the user typed one (blank keeps existing).
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
      } else {
        await onCreate({
          name: name.trim(),
          type,
          icon,
          description: description.trim(),
          endpoint: endpoint.trim(),
          imageBaseUrl: imageBaseUrl.trim(),
          model: model.trim(),
          capabilities: caps,
          apiKey: apiKey.trim() || undefined,
        });
      }
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[92vw] max-w-lg overflow-y-auto border-cyan-400/15 bg-[#0a1628] text-white">
        <DialogHeader>
          <DialogTitle className="font-jarvis-display text-white">
            {editing ? "Edit Agent" : "Add Agent"}
          </DialogTitle>
          <DialogDescription className="text-white/45">
            {editing
              ? "Update this agent's connection details."
              : "Register a real agent. Details are stored locally on this machine."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="space-y-1">
            <p className={labelCls}>Agent Name</p>
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hermes Prime"
              data-testid="agent-os-add-name"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className={labelCls}>Type</p>
              <select
                className={field}
                value={type}
                onChange={(e) => onTypeChange(e.target.value as AgentType)}
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-[#0a1628]">
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className={labelCls}>Model</p>
              <input
                className={field}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="model id"
              />
            </div>
          </div>

          <div className="space-y-1">
            <p className={labelCls}>Icon</p>
            <div className="flex flex-wrap gap-1.5">
              {AGENT_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg border text-base transition-colors",
                    icon === ic
                      ? "border-cyan-400/60 bg-cyan-500/20"
                      : "border-white/10 bg-white/5 hover:bg-white/10",
                  )}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className={labelCls}>Description</p>
            <input
              className={field}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
            />
          </div>

          <div className="space-y-1">
            <p className={labelCls}>Endpoint</p>
            <input
              className={field}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://host/openai/v1 or mcp://…"
              data-testid="agent-os-add-endpoint"
            />
            <p className="text-[11px] text-white/35">
              The OpenAI-compatible base URL. “/chat/completions” is appended
              automatically.
            </p>
          </div>

          <div className="space-y-1">
            <p className={labelCls}>Image Base URL</p>
            <input
              className={field}
              value={imageBaseUrl}
              onChange={(e) => setImageBaseUrl(e.target.value)}
              placeholder={derivedImageBase ?? "https://host/images"}
              data-testid="agent-os-add-image-base"
            />
            <p className="text-[11px] text-white/35">
              {derivedImageBase && !imageBaseUrl.trim()
                ? `Blank uses ${derivedImageBase}, where Hermes serves its image cache. Images the agent writes to disk are fetched from there instead of showing a file path.`
                : "Where this agent serves images it generated. Leave blank to derive it from the endpoint."}
            </p>
          </div>

          <div className="space-y-1">
            <p className={labelCls}>API Key</p>
            <input
              className={field}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                editing?.hasApiKey
                  ? "•••••••• (leave blank to keep current)"
                  : "stored locally on this machine"
              }
            />
          </div>

          <div className="space-y-1">
            <p className={labelCls}>Capabilities (comma separated)</p>
            <input
              className={field}
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="reasoning, tools, memory"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-white/70 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="agent-os-add-submit"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save Changes" : "Add Agent"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmModal({
  agent,
  onOpenChange,
  onConfirm,
}: {
  agent: Agent | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<unknown> | void;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-sm border-rose-400/20 bg-[#0a1628] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Delete agent?</DialogTitle>
          <DialogDescription className="text-white/50">
            {agent ? (
              <>
                <span className="text-white/80">{agent.name}</span> will be
                permanently removed. This cannot be undone.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-white/10 px-3.5 py-2 text-sm text-white/70 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (!agent) return;
              setDeleting(true);
              try {
                await onConfirm(agent.id);
                onOpenChange(false);
              } finally {
                setDeleting(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/90 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            data-testid="agent-os-delete-confirm"
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentsView({
  agents,
  isLoading,
  onCreate,
  onUpdate,
  onToggle,
  onDelete,
}: {
  agents: Agent[];
  isLoading: boolean;
  onCreate: (params: CreateAgentOsAgent) => Promise<unknown>;
  onUpdate: (params: UpdateAgentOsAgent) => Promise<unknown>;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => Promise<unknown> | void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (a: Agent) => {
    setEditing(a);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/45">
          {isLoading
            ? "Loading agents…"
            : agents.length === 0
              ? "No agents registered yet"
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} registered`}
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-sm font-medium text-white shadow-[0_0_18px_rgba(0,229,255,0.3)] hover:opacity-90"
          data-testid="agent-os-add-agent"
        >
          <Plus className="size-4" />
          Add Agent
        </button>
      </div>

      {!isLoading && agents.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No agents yet"
          hint="Register your first agent to start building your fleet. Add its type, endpoint, model and API key — everything is stored locally."
          action={
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3.5 py-2 text-sm font-medium text-white hover:opacity-90"
              data-testid="agent-os-empty-add"
            >
              <Plus className="size-4" />
              Add your first agent
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <GlassCard key={a.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-11 place-items-center rounded-xl border border-white/10 bg-white/5 text-xl">
                  {a.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-white">
                      {a.name}
                    </h3>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/40">
                    {a.description || "No description"}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <TypeBadge type={a.type} />
                <span className="truncate font-mono text-[11px] text-white/35">
                  {a.endpoint || "no endpoint"}
                </span>
              </div>

              {a.capabilities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/55"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-[11px] text-white/35">
                <span>Last active {a.lastActivity}</span>
                <span className="inline-flex items-center gap-2">
                  {a.hasApiKey && (
                    <span className="rounded border border-emerald-400/25 bg-emerald-500/10 px-1 text-emerald-300/80">
                      key set
                    </span>
                  )}
                  {a.model || "no model"}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-1.5 border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => onToggle(a.id, !a.enabled)}
                  className={
                    a.enabled
                      ? "inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                      : "inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/50 hover:bg-white/5"
                  }
                >
                  <Power className="size-3.5" />
                  {a.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(a)}
                  className="ml-auto grid size-7 place-items-center rounded-lg border border-white/10 text-white/50 hover:bg-white/5"
                  aria-label="Edit agent"
                  data-testid={`agent-os-edit-${a.id}`}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(a)}
                  className="grid size-7 place-items-center rounded-lg border border-white/10 text-rose-300/80 hover:bg-rose-500/10"
                  aria-label="Delete agent"
                  data-testid={`agent-os-delete-${a.id}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <AgentFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />
      <DeleteConfirmModal
        agent={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={onDelete}
      />
    </div>
  );
}
