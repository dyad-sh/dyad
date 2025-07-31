import { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const gitHttpMiddlewareFactory = require("git-http-mock-server/middleware");

// Push event tracking for tests
interface PushEvent {
  timestamp: Date;
  repo: string;
  branch: string;
  operation: "push" | "create" | "delete";
  commitSha?: string;
}

const pushEvents: PushEvent[] = [];

// Mock data for testing
const mockAccessToken = "fake_access_token_12345";
const mockDeviceCode = "fake_device_code_12345";
const mockUserCode = "FAKE-CODE";
const mockUser = {
  login: "testuser",
  id: 12345,
  email: "testuser@example.com",
};

const mockRepos = [
  {
    id: 1,
    name: "test-repo-1",
    full_name: "testuser/test-repo-1",
    private: false,
    owner: { login: "testuser" },
    default_branch: "main",
  },
  {
    id: 2,
    name: "test-repo-2",
    full_name: "testuser/test-repo-2",
    private: true,
    owner: { login: "testuser" },
    default_branch: "main",
  },
  {
    id: 3,
    name: "existing-app",
    full_name: "testuser/existing-app",
    private: false,
    owner: { login: "testuser" },
    default_branch: "main",
  },
];

const mockBranches = [
  { name: "main", commit: { sha: "abc123" } },
  { name: "develop", commit: { sha: "def456" } },
  { name: "feature/test", commit: { sha: "ghi789" } },
];

// Store device flow state
let deviceFlowState = {
  deviceCode: mockDeviceCode,
  userCode: mockUserCode,
  authorized: false,
  pollCount: 0,
};

// GitHub Device Flow - Step 1: Get device code
export function handleDeviceCode(req: Request, res: Response) {
  console.log("* GitHub Device Code requested");

  // Reset state for new flow
  deviceFlowState = {
    deviceCode: mockDeviceCode,
    userCode: mockUserCode,
    authorized: false,
    pollCount: 0,
  };

  res.json({
    device_code: mockDeviceCode,
    user_code: mockUserCode,
    verification_uri: "https://github.com/login/device",
    verification_uri_complete: `https://github.com/login/device?user_code=${mockUserCode}`,
    expires_in: 900,
    interval: 1, // Short interval for testing
  });
}

// GitHub Device Flow - Step 2: Poll for access token
export function handleAccessToken(req: Request, res: Response) {
  console.log("* GitHub Access Token polling", {
    pollCount: deviceFlowState.pollCount,
  });

  const { device_code } = req.body;

  if (device_code !== mockDeviceCode) {
    return res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid device code",
    });
  }

  deviceFlowState.pollCount++;

  // Simulate authorization after 3 polls (for testing)
  if (deviceFlowState.pollCount >= 3) {
    deviceFlowState.authorized = true;
    return res.json({
      access_token: mockAccessToken,
      token_type: "bearer",
      scope: "repo,user,workflow",
    });
  }

  // Return pending status
  res.status(400).json({
    error: "authorization_pending",
    error_description: "The authorization request is still pending",
  });
}

// Get authenticated user info
export function handleUser(req: Request, res: Response) {
  console.log("* GitHub User info requested");

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  res.json(mockUser);
}

// Get user emails
export function handleUserEmails(req: Request, res: Response) {
  console.log("* GitHub User emails requested");

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  res.json([
    {
      email: "testuser@example.com",
      primary: true,
      verified: true,
      visibility: "public",
    },
  ]);
}

// List user repositories
export function handleUserRepos(req: Request, res: Response) {
  console.log("* GitHub User repos requested");

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  if (req.method === "GET") {
    // List repos
    res.json(mockRepos);
  } else if (req.method === "POST") {
    // Create repo
    const { name, private: isPrivate } = req.body;
    console.log("* Creating repository:", name);

    // Check if repo already exists
    const existingRepo = mockRepos.find((repo) => repo.name === name);
    if (existingRepo) {
      return res.status(422).json({
        message: "Repository creation failed.",
        errors: [
          {
            resource: "Repository",
            code: "already_exists",
            field: "name",
          },
        ],
      });
    }

    // Create new repo
    const newRepo = {
      id: mockRepos.length + 1,
      name,
      full_name: `${mockUser.login}/${name}`,
      private: !!isPrivate,
      owner: { login: mockUser.login },
      default_branch: "main",
    };

    res.status(201).json(newRepo);
  }
}

// Get repository info
export function handleRepo(req: Request, res: Response) {
  console.log("* GitHub Repo info requested");

  const { owner, repo } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  const foundRepo = mockRepos.find((r) => r.full_name === `${owner}/${repo}`);

  if (!foundRepo) {
    return res.status(404).json({
      message: "Not Found",
    });
  }

  res.json(foundRepo);
}

// Get repository branches
export function handleRepoBranches(req: Request, res: Response) {
  console.log("* GitHub Repo branches requested");

  const { owner, repo } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  const foundRepo = mockRepos.find((r) => r.full_name === `${owner}/${repo}`);

  if (!foundRepo) {
    return res.status(404).json({
      message: "Not Found",
    });
  }

  res.json(mockBranches);
}

// Create repository for organization (not implemented in mock)
export function handleOrgRepos(req: Request, res: Response) {
  console.log("* GitHub Org repos requested");

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.includes(mockAccessToken)) {
    return res.status(401).json({
      message: "Bad credentials",
    });
  }

  // For simplicity, just redirect to user repos for mock
  handleUserRepos(req, res);
}

// Push event management functions for testing
export function handleGetPushEvents(req: Request, res: Response) {
  console.log("* Getting push events");
  const { repo } = req.query;

  const events = repo ? pushEvents.filter((e) => e.repo === repo) : pushEvents;

  res.json(events);
}

export function handleClearPushEvents(req: Request, res: Response) {
  console.log("* Clearing push events");
  pushEvents.length = 0;
  res.json({ cleared: true, timestamp: new Date() });
}

// Handle Git operations (push, pull, clone, etc.) using git-http-mock-server
export function handleGitPush(req: Request, res: Response, next?: Function) {
  console.log("* GitHub Git operation requested:", req.method, req.url);

  // Log request headers to see git operation details
  console.log("* Git Headers:", {
    "git-protocol": req.headers["git-protocol"],
    "content-type": req.headers["content-type"],
    "user-agent": req.headers["user-agent"],
  });

  // Create a unique temporary directory for this request
  const mockReposRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "dyad-git-mock-" + Math.random().toString(36).substring(2, 15),
    ),
  );
  console.error(`* Created temporary git repos directory: ${mockReposRoot}`);

  // Create git middleware instance for this request
  const gitHttpMiddleware = gitHttpMiddlewareFactory({
    root: mockReposRoot,
    route: "/github/git",
    glob: "*.git",
  });

  // Extract repo name from URL path like /github/git/testuser/test-repo.git
  // The middleware expects the repo name as the basename after the route
  const urlPath = req.url;
  const match = urlPath.match(/\/github\/git\/[^/]+\/([^/.]+)\.git/);
  const repoName = match?.[1];

  if (repoName) {
    console.log(`* Git operation for repo: ${repoName}`);

    // Track push events if this is a git-receive-pack (push) operation
    if (req.url.includes("/git-receive-pack") && req.method === "POST") {
      console.log("* Git PUSH operation detected for repo:", repoName);

      // Collect request body to parse git protocol
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          // Parse git pack protocol for branch refs
          // Git protocol sends refs in format: "old-sha new-sha refs/heads/branch-name"
          const lines = body.split("\n");
          lines.forEach((line) => {
            // Look for lines containing refs/heads/
            const refMatch = line.match(
              // eslint-disable-next-line
              /([0-9a-f]{40})\s+([0-9a-f]{40})\s+refs\/heads\/([^\s\u0000]+)/,
            );
            if (refMatch) {
              const [, oldSha, newSha, branchName] = refMatch;
              const isDelete = newSha === "0".repeat(40);
              const isCreate = oldSha === "0".repeat(40);

              let operation: "push" | "create" | "delete" = "push";
              if (isDelete) operation = "delete";
              else if (isCreate) operation = "create";

              pushEvents.push({
                timestamp: new Date(),
                repo: repoName,
                branch: branchName,
                operation,
                commitSha: isDelete ? oldSha : newSha,
              });

              console.log(
                `* Recorded ${operation} to ${repoName}/${branchName}, commit: ${isDelete ? oldSha : newSha}`,
              );
            }
          });
        } catch (error) {
          console.error("* Error parsing git protocol:", error);
        }
      });
    }

    // Ensure the bare git repository exists for this repo
    const bareRepoPath = path.join(mockReposRoot, `${repoName}.git`);
    console.log(`* Creating bare git repository at: ${bareRepoPath}`);
    try {
      fs.mkdirSync(bareRepoPath, { recursive: true });
      // Initialize as bare repository
      const { execSync } = require("child_process");
      execSync(`git init --bare`, { cwd: bareRepoPath });
      console.log(
        `* Successfully created bare git repository: ${repoName}.git`,
      );
    } catch (error) {
      console.error(`* Failed to create bare git repository:`, error);
      return res.status(500).json({
        message: "Failed to initialize git repository",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Rewrite the URL to match what the middleware expects
    // Change /github/git/testuser/test-repo.git/... to /github/git/test-repo.git/...
    const rewrittenUrl = req.url.replace(
      /\/github\/git\/[^/]+\//,
      "/github/git/",
    );
    req.url = rewrittenUrl;
    console.log(`* Rewritten URL from ${urlPath} to ${rewrittenUrl}`);
  }

  // Use git-http-mock-server middleware to handle the actual git operations
  gitHttpMiddleware(
    req,
    res,
    next ||
      (() => {
        // Fallback if middleware doesn't handle the request
        console.log(
          `* Git middleware did not handle request: ${req.method} ${req.url}`,
        );
        res.status(404).json({
          message: "Git operation not supported",
          url: req.url,
          method: req.method,
        });
      }),
  );
}
