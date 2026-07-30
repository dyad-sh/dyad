import type { Role } from "@/lib/roles";

export type Status = "open" | "in_progress" | "resolved" | "closed";

export const STATUSES: Status[] = ["open", "in_progress", "resolved", "closed"];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

/** Who may perform a transition. */
type Actor = "assigned_agent" | "admin" | "requester";

type Rule = {
  from: Status;
  to: Status;
  allowed: Actor[];
  requiresAssignee?: boolean;
};

export const TRANSITIONS: Rule[] = [
  {
    from: "open",
    to: "in_progress",
    allowed: ["assigned_agent", "admin"],
    requiresAssignee: true,
  },
  { from: "in_progress", to: "resolved", allowed: ["assigned_agent", "admin"] },
  { from: "in_progress", to: "open", allowed: ["assigned_agent", "admin"] },
  { from: "resolved", to: "closed", allowed: ["requester", "admin"] },
  { from: "resolved", to: "open", allowed: ["requester", "admin"] },
  { from: "closed", to: "open", allowed: ["admin"] },
];

export type TransitionContext = {
  role: Role;
  userId: string;
  creatorId: string;
  assigneeId: string | null;
};

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: "illegal"; message: string }
  | { ok: false; reason: "forbidden"; message: string };

export function checkTransition(
  from: Status,
  to: Status,
  ctx: TransitionContext,
): TransitionCheck {
  const rule = TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) {
    return {
      ok: false,
      reason: "illegal",
      message: `Cannot move a ticket from ${from} to ${to}.`,
    };
  }

  const isAdmin = ctx.role === "admin";
  const isAssignedAgent =
    ctx.role === "agent" && !!ctx.assigneeId && ctx.assigneeId === ctx.userId;
  const isRequester = ctx.creatorId === ctx.userId;

  const permitted =
    (rule.allowed.includes("admin") && isAdmin) ||
    (rule.allowed.includes("assigned_agent") && isAssignedAgent) ||
    (rule.allowed.includes("requester") && isRequester);

  if (!permitted) {
    return {
      ok: false,
      reason: "forbidden",
      message: "You are not allowed to perform this transition.",
    };
  }

  if (rule.requiresAssignee && !ctx.assigneeId) {
    return {
      ok: false,
      reason: "illegal",
      message: "An assignee must be set first.",
    };
  }

  return { ok: true };
}

/** Statuses the given viewer may move this ticket to right now. */
export function allowedTransitions(
  from: Status,
  ctx: TransitionContext,
): Status[] {
  return TRANSITIONS.filter((r) => r.from === from)
    .filter((r) => checkTransition(from, r.to, ctx).ok)
    .map((r) => r.to);
}
