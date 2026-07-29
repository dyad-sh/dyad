export type Company = {
  id: string;
  name: string;
  domain: string | null;
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
};

export type Membership = {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
};

export type Me = {
  id: string;
  email: string;
  name: string;
  activeWorkspaceId: string | null;
  memberships: Membership[];
};

export type Workspace = {
  id: string;
  name: string;
};

export type WorkspaceMember = {
  id: string;
  userId: string;
  email: string;
  role: string;
};

export type WorkspaceInvite = {
  id: string;
  email: string;
  role: string;
  workspaceId: string;
  workspaceName: string;
};

export type DealStage = "lead" | "qualified" | "proposal" | "won" | "lost";

export type Deal = {
  id: string;
  title: string;
  amount: number;
  stage: DealStage;
  contactId: string | null;
  contactName: string | null;
};

export type ActivityType = "created" | "updated" | "stage_change" | "note";

export type ContactActivity = {
  id: string;
  type: ActivityType;
  body: string;
  actorUserId: string;
  actorEmail: string | null;
  createdAt: string;
};
