import { Request, Response } from "express";

// State to control whether the account is soft-blocked
let mockSoftBlock: {
  blockedAt: number;
  reason: string;
  blockedDueToOverageType?: string;
} | null = null;

// Mock Vercel user data
const mockUser = {
  id: "test-user-id",
  email: "test@example.com",
  name: "Test User",
  username: "testuser",
  avatar: null,
  defaultTeamId: "team-123",
  createdAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
  billing: null,
  resourceConfig: {},
  stagingPrefix: "test",
  hasTrialAvailable: false,
  softBlock: null as typeof mockSoftBlock,
};

// Mock Vercel team data
const mockTeam = {
  id: "team-123",
  slug: "test-team",
  name: "Test Team",
  creatorId: "test-user-id",
  createdAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
  updatedAt: Date.now(),
};

// Mock Vercel projects
const mockProjects = [
  {
    id: "prj-123",
    name: "test-project",
    framework: "nextjs",
    targets: {
      production: {
        url: "test-project.vercel.app",
      },
    },
  },
  {
    id: "prj-456",
    name: "another-project",
    framework: "vite",
    targets: {
      production: {
        url: "another-project.vercel.app",
      },
    },
  },
];

// Mock Vercel deployments
const mockDeployments = [
  {
    uid: "dpl-123",
    url: "test-project-abc123.vercel.app",
    state: "READY",
    createdAt: Date.now() - 60 * 60 * 1000,
    target: "production",
    readyState: "READY",
  },
  {
    uid: "dpl-456",
    url: "test-project-def456.vercel.app",
    state: "READY",
    createdAt: Date.now() - 24 * 60 * 60 * 1000,
    target: "production",
    readyState: "READY",
  },
];

// Handler for GET /vercel/api/v2/user
export function handleGetUser(req: Request, res: Response) {
  console.log("* Vercel: Getting user info");

  // Update softBlock from current state
  const user = { ...mockUser, softBlock: mockSoftBlock };

  res.json({ user });
}

// Handler for GET /vercel/api/v2/teams
export function handleGetTeams(req: Request, res: Response) {
  console.log("* Vercel: Getting teams");
  res.json({
    teams: [mockTeam],
    pagination: {
      count: 1,
      next: null,
      prev: null,
    },
  });
}

// Handler for GET /vercel/api/v9/projects
export function handleGetProjects(req: Request, res: Response) {
  const search = req.query.search as string | undefined;
  console.log(`* Vercel: Getting projects (search: ${search || "none"})`);

  let projects = mockProjects;
  if (search) {
    projects = mockProjects.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()),
    );
  }

  res.json({
    projects,
    pagination: {
      count: projects.length,
      next: null,
      prev: null,
    },
  });
}

// Handler for POST /vercel/api/v10/projects (create project)
export function handleCreateProject(req: Request, res: Response) {
  const { name, gitRepository, framework } = req.body;
  console.log(`* Vercel: Creating project: ${name}`);

  const newProject = {
    id: `prj-${Date.now()}`,
    name,
    framework: framework || "nextjs",
    gitRepository,
    targets: {
      production: {
        url: `${name}.vercel.app`,
      },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  res.json(newProject);
}

// Handler for GET /vercel/api/v9/projects/:projectId/domains
export function handleGetProjectDomains(req: Request, res: Response) {
  const { projectId } = req.params;
  console.log(`* Vercel: Getting domains for project: ${projectId}`);

  res.json({
    domains: [
      {
        name: `${projectId.replace("prj-", "")}.vercel.app`,
        apexName: "vercel.app",
        projectId,
        redirect: null,
        redirectStatusCode: null,
        gitBranch: null,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        verified: true,
        verification: [],
      },
    ],
    pagination: {
      count: 1,
      next: null,
      prev: null,
    },
  });
}

// Handler for GET /vercel/api/v6/deployments
export function handleGetDeployments(req: Request, res: Response) {
  const projectId = req.query.projectId as string | undefined;
  console.log(
    `* Vercel: Getting deployments (projectId: ${projectId || "all"})`,
  );

  res.json({
    deployments: mockDeployments,
    pagination: {
      count: mockDeployments.length,
      next: null,
      prev: null,
    },
  });
}

// Handler for POST /vercel/api/v13/deployments (create deployment)
export function handleCreateDeployment(req: Request, res: Response) {
  const { name, project, target } = req.body;
  console.log(`* Vercel: Creating deployment for project: ${project}`);

  const newDeployment = {
    id: `dpl-${Date.now()}`,
    uid: `dpl-${Date.now()}`,
    url: `${name}-${Date.now().toString(36)}.vercel.app`,
    name,
    meta: {},
    version: 2,
    regions: ["sfo1"],
    routes: null,
    plan: "hobby",
    public: false,
    ownerId: "test-user-id",
    readyState: "BUILDING",
    createdAt: Date.now(),
    createdIn: "sfo1",
    buildingAt: Date.now(),
    creator: {
      uid: "test-user-id",
    },
    target: target || "production",
  };

  res.json(newDeployment);
}

// Test endpoint to set soft block state
export function handleSetSoftBlock(req: Request, res: Response) {
  const { reason, blockedDueToOverageType } = req.body;
  console.log(`* Vercel Test: Setting soft block: ${reason || "none"}`);

  if (reason) {
    mockSoftBlock = {
      blockedAt: Date.now(),
      reason,
      blockedDueToOverageType,
    };
  } else {
    mockSoftBlock = null;
  }

  res.json({ success: true, softBlock: mockSoftBlock });
}

// Test endpoint to clear soft block state
export function handleClearSoftBlock(req: Request, res: Response) {
  console.log("* Vercel Test: Clearing soft block");
  mockSoftBlock = null;
  res.json({ success: true });
}

// Test endpoint to get current soft block state
export function handleGetSoftBlock(req: Request, res: Response) {
  res.json({ softBlock: mockSoftBlock });
}
