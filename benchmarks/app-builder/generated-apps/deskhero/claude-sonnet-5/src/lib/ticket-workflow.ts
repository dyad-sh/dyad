import type { Role } from "@/lib/current-user";

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type TransitionContext = {
  role: Role;
  userId: string;
  ownerId: string;
  assigneeId: string | null;
};

type TransitionRule = {
  from: TicketStatus;
  to: TicketStatus;
  isAllowed: (ctx: TransitionContext) => boolean;
};

const isAssignedAgentOrAdmin = (ctx: TransitionContext) =>
  ctx.role === "admin" ||
  (ctx.role === "agent" && !!ctx.assigneeId && ctx.assigneeId === ctx.userId);

const isRequesterOrAdmin = (ctx: TransitionContext) =>
  ctx.role === "admin" || ctx.ownerId === ctx.userId;

export const TRANSITION_RULES: TransitionRule[] = [
  {
    from: "open",
    to: "in_progress",
    isAllowed: (ctx) => !!ctx.assigneeId && isAssignedAgentOrAdmin(ctx),
  },
  {
    from: "in_progress",
    to: "resolved",
    isAllowed: isAssignedAgentOrAdmin,
  },
  {
    from: "in_progress",
    to: "open",
    isAllowed: isAssignedAgentOrAdmin,
  },
  {
    from: "resolved",
    to: "closed",
    isAllowed: isRequesterOrAdmin,
  },
  {
    from: "resolved",
    to: "open",
    isAllowed: isRequesterOrAdmin,
  },
  {
    from: "closed",
    to: "open",
    isAllowed: (ctx) => ctx.role === "admin",
  },
];

export function findTransitionRule(from: TicketStatus, to: TicketStatus) {
  return TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to);
}

export function getAllowedTransitions(
  current: TicketStatus,
  ctx: TransitionContext,
): TicketStatus[] {
  return TRANSITION_RULES.filter(
    (rule) => rule.from === current && rule.isAllowed(ctx),
  ).map((rule) => rule.to);
}
