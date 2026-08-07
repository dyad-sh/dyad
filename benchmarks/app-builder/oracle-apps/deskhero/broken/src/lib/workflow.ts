import type { TicketStatus } from "@/lib/tickets";

/**
 * Ticket status workflow — Milestone 2/3 rules (specs/deskhero/m2.md).
 *
 * This is the single source of truth for *both* the server check and the
 * buttons the detail page renders, so "a viewer sees buttons only for
 * transitions they may perform" cannot drift from what the server enforces.
 *
 * | From        | To          | Allowed for                                     |
 * | ----------- | ----------- | ----------------------------------------------- |
 * | open        | in_progress | assigned agent, admin (an assignee must be set) |
 * | in_progress | resolved    | assigned agent, admin                           |
 * | in_progress | open        | assigned agent, admin                           |
 * | resolved    | closed      | ticket requester, admin                         |
 * | resolved    | open        | ticket requester, admin                         |
 * | closed      | open        | admin only                                      |
 */

export type WorkflowRole = "admin" | "agent" | "requester";

export type Actor = {
  role: WorkflowRole;
  /** The caller filed this ticket. */
  isOwner: boolean;
  /** The caller is the ticket's current assignee. */
  isAssignee: boolean;
};

export type StatusControl = {
  /** `data-testid` of the button that performs this transition. */
  testId: string;
  to: TicketStatus;
  label: string;
};

/**
 * `illegal` — the transition itself is not in the matrix (422).
 * `forbidden` — a real transition, but not for this caller (403).
 */
export type TransitionVerdict = "ok" | "illegal" | "forbidden";

const ALL_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

export function checkTransition(
  from: TicketStatus,
  to: TicketStatus,
  hasAssignee: boolean,
  actor: Actor,
): TransitionVerdict {
  const inMatrix =
    (from === "open" && to === "in_progress" && hasAssignee) ||
    (from === "in_progress" && (to === "resolved" || to === "open")) ||
    (from === "resolved" && (to === "closed" || to === "open")) ||
    (from === "closed" && to === "open");
  if (!inMatrix) return "illegal";

  const isAdmin = actor.role === "admin";
  const isAssignedAgent = actor.role === "agent" && actor.isAssignee;
  const allowed =
    from === "open" || from === "in_progress"
      ? isAdmin || isAssignedAgent
      : from === "resolved"
        ? isAdmin || actor.isOwner
        : isAdmin;
  return allowed ? "ok" : "forbidden";
}

/** The status buttons this actor may see on the ticket detail page. */
export function statusControls(
  status: TicketStatus,
  hasAssignee: boolean,
  actor: Actor,
): StatusControl[] {
  return ALL_STATUSES.filter(
    (to) =>
      to !== status && checkTransition(status, to, hasAssignee, actor) === "ok",
  ).map((to) => ({ testId: `transition-${to}`, to, label: `Mark ${to}` }));
}
