export type MembershipRole = "owner" | "member" | "viewer";

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";

export const DEAL_STAGES: DealStage[] = [
  "lead",
  "qualified",
  "proposal",
  "won",
  "lost",
];

export const INVITE_ROLES: Array<"member" | "viewer"> = ["member", "viewer"];

export type Workspace = {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
};

export type Membership = {
  workspaceId: string;
  workspaceName: string;
  membershipId: string;
  role: MembershipRole;
};

export type Company = {
  id: string;
  name: string;
  domain: string;
  workspace_id?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string | null;
  company_name?: string | null;
  workspace_id?: string;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type Deal = {
  id: string;
  title: string;
  amount: number;
  stage: DealStage;
  contact_id: string | null;
  contact_name?: string | null;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ActivityType =
  | "note"
  | "contact_created"
  | "contact_updated"
  | "deal_stage_changed";

export type ContactActivity = {
  id: string;
  type: ActivityType;
  body: string;
  actor_user_id?: string;
  actor_email: string;
  actor_name: string;
  created_at: string;
};
