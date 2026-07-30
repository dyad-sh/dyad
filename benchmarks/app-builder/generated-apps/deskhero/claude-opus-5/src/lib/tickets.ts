import type { Status } from "@/lib/workflow";

export type Priority = "low" | "medium" | "high";

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: Priority;
  status: Status;
  creator_id: string;
  creator_name: string | null;
  creator_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  created_at: string;
  sla_due_at: string | null;
};

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const priorityClasses: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-red-50 text-red-700 border-red-200",
};

export const statusClasses: Record<Status, string> = {
  open: "bg-emerald-50 text-emerald-700 border-emerald-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-indigo-50 text-indigo-700 border-indigo-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

export const statusLabels: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};
