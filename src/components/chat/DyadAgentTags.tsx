import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  Compass,
  FileText,
  Flag,
  ListChecks,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
  Timer,
  Loader2,
} from "lucide-react";
import type { ReactNode } from "react";

type AgentAnalysis = {
  goals?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
  risks?: string[];
  clarifications?: string[];
  dyadTagRefs?: string[];
};

type AgentPlanTodo = {
  todoId: string;
  title: string;
  description?: string;
  owner?: string;
  inputs?: string[];
  outputs?: string[];
  completionCriteria?: string;
  status?: string;
  dyadTagRefs?: string[];
};

type AgentPlan = {
  todos?: AgentPlanTodo[];
  version?: number;
  dyadTagRefs?: string[];
  dyadTagContext?: string[];
};

type AgentLogType =
  | "analysis"
  | "plan"
  | "execution"
  | "review"
  | "command"
  | "validation"
  | "system";

type AgentLog = {
  todoId?: string | null;
  todoKey?: string | null;
  logType: AgentLogType;
  content: string;
  dyadTagRefs?: string[];
  metadata?: Record<string, unknown>;
};

function parseJsonContent<T>(raw: string): T | null {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn("Failed to parse agent tag JSON", error);
    return null;
  }
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/80 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function PillList({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge
          key={item}
          variant="secondary"
          className="border-border bg-muted/60 text-xs font-medium"
        >
          {item}
        </Badge>
      ))}
    </div>
  );
}

export function DyadAgentAnalysis({ content }: { content: string }) {
  const data = parseJsonContent<AgentAnalysis>(content) ?? {};

  return (
    <div className="my-3 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Compass className="h-4 w-4" /> Agent Analysis
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Goals" icon={<Flag className="h-3.5 w-3.5" />}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {(data.goals ?? []).map((goal, index) => (
              <li key={`goal-${index}`}>{goal}</li>
            ))}
          </ul>
        </Section>
        <Section title="Constraints" icon={<ShieldHalf className="h-3.5 w-3.5" />}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {(data.constraints ?? []).map((constraint, index) => (
              <li key={`constraint-${index}`}>{constraint}</li>
            ))}
          </ul>
        </Section>
        <Section
          title="Acceptance Criteria"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        >
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {(data.acceptanceCriteria ?? []).map((criterion, index) => (
              <li key={`criteria-${index}`}>{criterion}</li>
            ))}
          </ul>
        </Section>
        <Section title="Risks" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {(data.risks ?? []).map((risk, index) => (
              <li key={`risk-${index}`}>{risk}</li>
            ))}
          </ul>
        </Section>
      </div>
      {data.clarifications?.length ? (
        <Section title="Clarifications" icon={<ClipboardList className="h-3.5 w-3.5" />}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {data.clarifications.map((item, index) => (
              <li key={`clar-${index}`}>{item}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <PillList items={data.dyadTagRefs} />
    </div>
  );
}

const statusBadgeMap: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline"; icon: ReactNode } | undefined> = {
  completed: {
    label: "Completed",
    tone: "default",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  in_progress: {
    label: "In Progress",
    tone: "outline",
    icon: <PlayCircle className="h-3 w-3" />,
  },
  blocked: {
    label: "Blocked",
    tone: "destructive",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  revising: {
    label: "Revising",
    tone: "secondary",
    icon: <ShieldHalf className="h-3 w-3" />,
  },
  ready: {
    label: "Ready",
    tone: "secondary",
    icon: <CircleDot className="h-3 w-3 text-primary" />,
  },
  pending: {
    label: "Pending",
    tone: "secondary",
    icon: <Circle className="h-3 w-3" />,
  },
};

function TodoRow({ todo }: { todo: AgentPlanTodo }) {
  const status = todo.status?.toLowerCase?.() ?? "pending";
  const badge = statusBadgeMap[status];

  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground flex-1 min-w-0">
        <CircleDot className="h-4 w-4 text-blue-500" />
                <span className="whitespace-normal break-words">{todo.title}</span>
      </div>
      {badge ? (
        <Badge variant={badge.tone} className="text-[10px] uppercase">
          {badge.label}
        </Badge>
      ) : null}
    </div>
  );
}

export function DyadAgentPlan({
  content,
  inProgress = false,
}: {
  content: string;
  inProgress?: boolean;
}) {
  const data = parseJsonContent<AgentPlan>(content) ?? {};
  const todos = data.todos ?? [];

  return (
    <div className="my-3 space-y-2 rounded-lg border border-blue-300/40 bg-blue-500/5 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-300">
        <ListChecks className="h-4 w-4" /> Agent Plan
        {data.version ? (
          <Badge variant="outline" className="text-[10px] uppercase">
            v{data.version}
          </Badge>
        ) : null}
        {inProgress ? (
          <Badge variant="secondary" className="flex items-center gap-1 text-[10px] uppercase">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating
          </Badge>
        ) : null}
      </div>
      <div className="space-y-2">
        {todos.length ? (
          todos.map((todo) => <TodoRow key={todo.todoId} todo={todo} />)
        ) : (
          <p className="text-xs text-muted-foreground">Plan details will appear here once generated.</p>
        )}
      </div>
    </div>
  );
}

const logIconMap: Record<AgentLogType, ReactNode> = {
  analysis: <Compass className="h-3.5 w-3.5 text-primary" />,
  plan: <ListChecks className="h-3.5 w-3.5 text-blue-500" />,
  execution: <PlayCircle className="h-3.5 w-3.5 text-green-500" />,
  review: <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />,
  command: <Sparkles className="h-3.5 w-3.5 text-purple-500" />,
  validation: <ShieldHalf className="h-3.5 w-3.5 text-orange-500" />,
  system: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
};

export function DyadAgentLog({
  content,
  attributes,
}: {
  content: string;
  attributes: Record<string, string>;
}) {
  const log: AgentLog = {
    todoId: attributes.todoid ?? attributes.todoId ?? undefined,
    todoKey: attributes.todokey ?? attributes.todoKey ?? undefined,
    logType: (attributes.type ?? attributes.logtype ?? "execution") as AgentLogType,
    content,
    dyadTagRefs: attributes.dyadtagrefs
      ? attributes.dyadtagrefs.split(/[\s,]+/).filter(Boolean)
      : undefined,
  };

  const icon = logIconMap[log.logType] ?? <FileText className="h-3.5 w-3.5" />;

  return (
    <div className="my-3 space-y-2 rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {log.logType} log
          </span>
        </div>
        {log.todoId ? (
          <Badge variant="outline" className="text-[11px]">
            {log.todoId}
          </Badge>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{log.content}</p>
      <PillList items={log.dyadTagRefs} />
    </div>
  );
}

export function DyadAgentTodoUpdate({
  attributes,
  content,
}: {
  attributes: Record<string, string>;
  content: string;
}) {
  const status = (attributes.status ?? "updated").toLowerCase();
  const todoId = attributes.todoid ?? attributes.todoId;
  const refs = attributes.dyadtagrefs
    ? attributes.dyadtagrefs.split(/[\s,]+/).filter(Boolean)
    : undefined;

  const badge = statusBadgeMap[status];

  return (
    <div className="my-3 space-y-2 rounded-md border border-emerald-300/40 bg-emerald-500/5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          TODO update
        </span>
        {todoId ? (
          <Badge variant="outline" className="text-[11px]">
            {todoId}
          </Badge>
        ) : null}
        {badge ? (
          <Badge variant={badge.tone} className="flex items-center gap-1 text-[11px]">
            {badge.icon}
            {badge.label}
          </Badge>
        ) : null}
      </div>
      {content?.trim() ? (
        <p className="text-xs text-muted-foreground">{content.trim()}</p>
      ) : null}
      <PillList items={refs} />
    </div>
  );
}

const statusLabelMap: Record<string, { label: string; icon: ReactNode }> = {
  idle: { label: "Idle", icon: <Circle className="h-4 w-4" /> },
  analysis: { label: "Analyzing", icon: <Compass className="h-4 w-4" /> },
  plan_ready: { label: "Plan ready", icon: <ListChecks className="h-4 w-4" /> },
  executing: { label: "Executing", icon: <PlayCircle className="h-4 w-4" /> },
  awaiting_user: { label: "Awaiting review", icon: <PauseCircle className="h-4 w-4" /> },
  reviewing: { label: "Reviewing", icon: <ShieldCheck className="h-4 w-4" /> },
  revising: { label: "Revising", icon: <ShieldHalf className="h-4 w-4" /> },
  completed: { label: "Completed", icon: <CheckCircle2 className="h-4 w-4" /> },
  error: { label: "Attention needed", icon: <AlertTriangle className="h-4 w-4" /> },
};

export function DyadAgentStatus({
  attributes,
}: {
  attributes: Record<string, string>;
}) {
  const state = (attributes.state ?? attributes.value ?? "updated").toLowerCase();
  const info = statusLabelMap[state];

  return (
    <div className="my-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
      {info?.icon ?? <Activity className="h-4 w-4" />}
      <span className="font-semibold text-foreground">
        Workflow status ? {info?.label ?? state}
      </span>
    </div>
  );
}

export function DyadAgentFocus({ attributes }: { attributes: Record<string, string> }) {
  const todoId = attributes.todoid ?? attributes.todoId ?? "";
  const note = attributes.note ?? attributes.reason ?? "";
  return (
    <div className="my-3 flex items-center gap-2 rounded-md border border-purple-300/60 bg-purple-500/5 px-3 py-2 text-xs">
      <Sparkles className="h-4 w-4 text-purple-500" />
      <span className="font-semibold text-foreground">Focus shifted to {todoId}</span>
      {note ? <span className="text-muted-foreground">? {note}</span> : null}
    </div>
  );
}

export function DyadAgentAuto({ attributes }: { attributes: Record<string, string> }) {
  const enabledRaw = attributes.enabled ?? attributes.value ?? "false";
  const enabled = /^(true|1|yes)$/i.test(enabledRaw);
  return (
    <div className="my-3 flex items-center gap-2 rounded-md border border-teal-300/60 bg-teal-500/5 px-3 py-2 text-xs">
      <Timer className="h-4 w-4 text-teal-500" />
      <span className="font-semibold text-foreground">
        Auto-advance {enabled ? "enabled" : "disabled"}
      </span>
    </div>
  );
}












