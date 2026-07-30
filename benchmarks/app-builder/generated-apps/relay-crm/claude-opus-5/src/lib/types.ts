export const DEAL_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const WORKSPACE_ROLES = ["owner", "member", "viewer"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Roles that may create, edit or delete workspace records. */
export const canWrite = (role: string): boolean =>
  role === "owner" || role === "member";

/** Only owners manage members and invites. */
export const canManageMembers = (role: string): boolean => role === "owner";

export type Activity = {
  id: string;
  workspace_id: string;
  contact_id: string;
  type: "note" | "system";
  body: string;
  actor_id: string;
  actor_email: string;
  created_at: string;
};

export type Company = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  domain: string | null;
  created_at: string;
};

export type Contact = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_id: string | null;
  created_at: string;
};

export type ContactWithCompany = Contact & { company_name: string | null };

export type Deal = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  amount: number;
  stage: DealStage;
  contact_id: string | null;
  created_at: string;
};

export type DealWithContact = Deal & { contact_name: string | null };
