import { useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  Clock,
  Filter,
  FolderOpen,
  ListChecks,
  Loader2,
  ScrollText,
  Search,
  Send,
  Square,
  Workflow,
  Wrench,
} from "lucide-react";

import type { Agent, LogLevel } from "../data";
import { usesMainChatStyle } from "../data";
import { useAgentChat } from "../useAgentChat";
import { MainStyleChat } from "./MainStyleChat";
import {
  AreaChart,
  Donut,
  EmptyState,
  GlassCard,
  MiniBars,
  SectionLabel,
} from "../ui";

/* ----------------------------------- Tasks ---------------------------------- */

export function TasksView({ agents }: { agents: Agent[] }) {
  return (
    <EmptyState
      icon={ListChecks}
      title="No tasks yet"
      hint={
        agents.length === 0
          ? "Register an agent, then dispatch tasks from the Command Center to see them tracked here."
          : "Dispatch a task from the dashboard Command Center and its run history will appear here."
      }
    />
  );
}

/* ------------------------------------ Chat ---------------------------------- */

export function ChatView({ agents }: { agents: Agent[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const activeId = agents.some((a) => a.id === agentId)
    ? agentId
    : (agents[0]?.id ?? "");
  const chat = useAgentChat(activeId);

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents to chat with"
        hint="Add an agent from the Agents tab to start a conversation. Configure its HTTP endpoint + API key and you can message it for real here."
      />
    );
  }

  const agent = agents.find((a) => a.id === activeId);

  // Hermes & OpenClaw agents mirror the app's main chat UI (matched by type or
  // name, e.g. "Hermes Phantom").
  if (agent && usesMainChatStyle(agent)) {
    return (
      <MainStyleChat
        agents={agents}
        activeId={activeId}
        agent={agent}
        onSelectAgent={setAgentId}
        chat={chat}
      />
    );
  }

  // MCP / Custom keep the compact holographic bubble style.
  const { messages, input, setInput, streaming, streamingText, send, stop } =
    chat;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="size-4 text-cyan-300" />
        <select
          value={activeId}
          onChange={(e) => setAgentId(e.target.value)}
          disabled={streaming}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white/80 outline-none disabled:opacity-60"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#0a1628]">
              {a.icon} {a.name}
            </option>
          ))}
        </select>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-white/35">
          <span
            className={
              agent?.endpoint
                ? "size-1.5 rounded-full bg-emerald-400"
                : "size-1.5 rounded-full bg-amber-400"
            }
          />
          {agent?.endpoint
            ? agent.hasApiKey
              ? "endpoint + key set"
              : "endpoint set · no key"
            : "no endpoint configured"}
        </span>
      </div>

      <GlassCard className="flex min-h-0 flex-1 flex-col p-4">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 && !streaming ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/35">
              Send a message to {agent?.name ?? "the agent"} to begin. Replies
              stream live from its endpoint.
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user" ? "flex justify-end" : "flex gap-3"
                }
              >
                {m.role === "assistant" && (
                  <span
                    className={
                      m.error
                        ? "grid size-8 shrink-0 place-items-center rounded-lg border border-rose-400/30 bg-rose-500/15 text-rose-200"
                        : "grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-cyan-500/15 text-cyan-200"
                    }
                  >
                    <Bot className="size-4" />
                  </span>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-cyan-500/30 to-emerald-500/20 px-3.5 py-2 text-sm text-white"
                      : m.error
                        ? "max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-rose-400/30 bg-rose-500/10 px-3.5 py-2 text-sm text-rose-200"
                        : "max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white/85"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {streaming && (
            <div className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-cyan-500/15 text-cyan-200">
                <Bot className="size-4" />
              </span>
              <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white/85">
                {streamingText ? (
                  <>
                    {streamingText}
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-cyan-400 align-middle" />
                  </>
                ) : (
                  <span className="inline-flex items-center gap-2 text-white/55">
                    <Loader2 className="size-3.5 animate-spin text-cyan-300" />
                    {agent?.name ?? "Agent"} is thinking…
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              streaming ? "Streaming response…" : "Message the agent…"
            }
            disabled={streaming}
            className="flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-white/30 disabled:opacity-60"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="grid size-8 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
              aria-label="Stop"
              title="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!input.trim()}
              className="grid size-8 place-items-center rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 text-white disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

/* --------------------------------- Workflows -------------------------------- */

export function WorkflowsView() {
  return (
    <EmptyState
      icon={Workflow}
      title="No workflows yet"
      hint="Chain agents, tools and decision nodes into automated pipelines. The visual workflow builder is coming soon."
    />
  );
}

/* ---------------------------------- Memory ---------------------------------- */

export function MemoryView({ agents }: { agents: Agent[] }) {
  const [store, setStore] = useState<"long" | "short">("long");
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-white/10 p-0.5">
          <button
            type="button"
            onClick={() => setStore("long")}
            className={
              store === "long"
                ? "rounded-md bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-200"
                : "px-3 py-1.5 text-xs text-white/55"
            }
          >
            Long-Term
          </button>
          <button
            type="button"
            onClick={() => setStore("short")}
            className={
              store === "short"
                ? "rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200"
                : "px-3 py-1.5 text-xs text-white/55"
            }
          >
            Short-Term
          </button>
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories…"
            className="rounded-lg border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
      </div>

      <EmptyState
        icon={BrainCircuit}
        title={`No ${store}-term memories`}
        hint={
          agents.length === 0
            ? "Memories are written by agents as they work. Register an agent to get started."
            : "As your agents run, the facts and context they store will appear here."
        }
      />
    </div>
  );
}

/* ----------------------------------- Tools ---------------------------------- */

export function ToolsView() {
  return (
    <EmptyState
      icon={Wrench}
      title="No tools connected"
      hint="Give your agents capabilities — web search, code execution, database access and more. Tool integrations are coming soon."
    />
  );
}

/* ----------------------------------- Files ---------------------------------- */

export function FilesView() {
  return (
    <EmptyState
      icon={FolderOpen}
      title="No files yet"
      hint="Files produced by your agents — images, documents, exports — will be collected here."
    />
  );
}

/* --------------------------------- Cron Jobs -------------------------------- */

export function CronView() {
  return (
    <EmptyState
      icon={Clock}
      title="No scheduled jobs"
      hint="Schedule agents to run on a recurring cadence. Cron scheduling is coming soon."
    />
  );
}

/* --------------------------------- Analytics -------------------------------- */

const TYPE_ORDER = ["Hermes", "OpenClaw", "MCP", "Custom"] as const;

export function AnalyticsView({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No analytics yet"
        hint="Register agents and run tasks to see usage, throughput and fleet composition charts here."
      />
    );
  }

  const enabled = agents.filter((a) => a.enabled).length;
  const online = agents.filter((a) => a.status === "online").length;
  const connected = agents.filter((a) => a.hasApiKey).length;
  const typeCounts = TYPE_ORDER.map(
    (t) => agents.filter((a) => a.type === t).length,
  );
  const enabledRate = agents.length ? enabled / agents.length : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassCard className="p-5">
        <SectionLabel>Fleet Composition</SectionLabel>
        <p className="mt-1 text-2xl font-semibold text-white">
          {agents.length} agents
        </p>
        <div className="mt-3 h-32">
          <MiniBars data={typeCounts.map((n) => n || 0.001)} color="#00e5ff" />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-white/45">
          {TYPE_ORDER.map((t, i) => (
            <span key={t}>
              {t} · {typeCounts[i]}
            </span>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Status Trend</SectionLabel>
        <p className="mt-1 text-2xl font-semibold text-white">
          {online} online
        </p>
        <div className="mt-3 h-32">
          <AreaChart
            data={[
              agents.length,
              enabled,
              connected,
              online,
              Math.max(online, 1),
            ]}
            color="#22c55e"
          />
        </div>
      </GlassCard>

      <GlassCard className="flex items-center gap-5 p-5">
        <Donut
          value={enabledRate}
          color="#22c55e"
          label={`${Math.round(enabledRate * 100)}%`}
          sublabel="enabled"
        />
        <div>
          <SectionLabel>Fleet Health</SectionLabel>
          <div className="mt-2 space-y-1 text-sm text-white/65">
            <div>✅ {enabled} enabled</div>
            <div>🟢 {online} online</div>
            <div>🔑 {connected} with API key</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Summary</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xl font-semibold text-white">
              {agents.length}
            </div>
            <div className="text-[11px] text-white/40">total agents</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xl font-semibold text-white">{online}</div>
            <div className="text-[11px] text-white/40">online</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xl font-semibold text-white">{connected}</div>
            <div className="text-[11px] text-white/40">connected</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-xl font-semibold text-white">{enabled}</div>
            <div className="text-[11px] text-white/40">enabled</div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

/* ------------------------------------ Logs ---------------------------------- */

const LOG_DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

export function LogsView({ agents }: { agents: Agent[] }) {
  const [level, setLevel] = useState<"all" | LogLevel>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [dateRange, setDateRange] = useState("today");
  const agentNames = useMemo(() => agents.map((a) => a.name), [agents]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
          <Filter className="size-3.5" /> Filters
        </span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as "all" | LogLevel)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/75 outline-none"
        >
          <option value="all" className="bg-[#0a1628]">
            All severities
          </option>
          <option value="info" className="bg-[#0a1628]">
            Info
          </option>
          <option value="warning" className="bg-[#0a1628]">
            Warning
          </option>
          <option value="error" className="bg-[#0a1628]">
            Error
          </option>
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/75 outline-none"
        >
          <option value="all" className="bg-[#0a1628]">
            All sources
          </option>
          {agentNames.map((n) => (
            <option key={n} value={n} className="bg-[#0a1628]">
              {n}
            </option>
          ))}
        </select>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/75 outline-none"
        >
          {LOG_DATE_RANGES.map((d) => (
            <option key={d.value} value={d.value} className="bg-[#0a1628]">
              {d.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-white/30">
          0 entries · {agents.length} agents
        </span>
      </div>

      <EmptyState
        icon={ScrollText}
        title="No log entries"
        hint="System and agent events will stream here once your agents start running."
      />
    </div>
  );
}

/* ---------------------------------- Settings -------------------------------- */

export function SettingsView({ agents }: { agents: Agent[] }) {
  const field =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/50";
  const label = "text-xs font-medium uppercase tracking-wide text-white/45";
  return (
    <div className="grid max-w-3xl gap-4">
      <GlassCard className="p-5">
        <SectionLabel>Workspace</SectionLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className={label}>Workspace Name</p>
            <input className={field} defaultValue="Agent OS" />
          </div>
          <div className="space-y-1">
            <p className={label}>Timezone</p>
            <select className={field} defaultValue="utc">
              <option value="utc" className="bg-[#0a1628]">
                UTC
              </option>
              <option value="pst" className="bg-[#0a1628]">
                America/Los_Angeles
              </option>
              <option value="est" className="bg-[#0a1628]">
                America/New_York
              </option>
            </select>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Agent Runtime</SectionLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <p className={label}>Default Agent</p>
            <select
              className={field}
              defaultValue={agents[0]?.id}
              disabled={agents.length === 0}
            >
              {agents.length === 0 ? (
                <option className="bg-[#0a1628]">No agents</option>
              ) : (
                agents.map((a) => (
                  <option key={a.id} value={a.id} className="bg-[#0a1628]">
                    {a.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="space-y-1">
            <p className={label}>Timeout (s)</p>
            <input className={field} type="number" defaultValue={120} />
          </div>
          <div className="space-y-1">
            <p className={label}>Retry Count</p>
            <input className={field} type="number" defaultValue={3} />
          </div>
        </div>
        <p className="mt-3 text-xs text-white/35">
          Runtime preferences apply to dispatched tasks. Agent connection
          details are managed per-agent in the Agents tab.
        </p>
      </GlassCard>
    </div>
  );
}
