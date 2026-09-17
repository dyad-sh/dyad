import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedChoice } from "@/components/SegmentedChoice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipc } from "@/ipc/types";
import type { GitLabStatus } from "@/ipc/types/gitlab";
import { queryKeys } from "@/lib/queryKeys";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useGitLabStatus } from "@/hooks/useGitLabStatus";
import { useGithubOps } from "@/github_ops/useGithubOps";
import { slugifyAppPath } from "@/shared/slugify";
import {
  gitLabInstanceLabel,
  normalizeGitLabInstanceUrl,
} from "@/shared/gitlab_instance_url";
import {
  describeLinkedRemote,
  type LinkedRemote,
} from "@/shared/linked_remote";
import {
  ConnectedGitHubConnector,
  GitHubOperationError,
} from "@/components/GitHubConnector";
import { GitLabCredentialsForm } from "@/components/GitLabCredentialsForm";

/**
 * The GitLab half of the Repository card.
 *
 * Linking, pushing and everything after go through the same github_ops
 * machine GitHub uses; the connected view is shared. What is GitLab's own is
 * the way in (an instance address and a token rather than a device flow) and
 * the link form (a namespace to create in, projects listed from Maintainer
 * up).
 */

interface GitLabConnectorProps {
  appId: number | null;
  folderName: string;
  expanded?: boolean;
}

function sameInstance(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  try {
    return normalizeGitLabInstanceUrl(a) === normalizeGitLabInstanceUrl(b);
  } catch {
    return a === b;
  }
}

export function GitLabConnector({
  appId,
  folderName,
  expanded,
}: GitLabConnectorProps) {
  const { app } = useLoadApp(appId);
  const { status } = useGitLabStatus();
  const linked = describeLinkedRemote(app);
  const linkedGitLab = linked?.provider === "gitlab" ? linked : null;

  if (linkedGitLab && status?.connected && appId) {
    const mismatch = !sameInstance(status.instanceUrl, linkedGitLab.host);
    return (
      <div className="w-full">
        {mismatch && (
          <div
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
            data-testid="gitlab-host-mismatch"
          >
            <p className="font-medium">Connected to a different GitLab</p>
            <p className="mt-1">
              This app is linked to {linkedGitLab.displayPath} on{" "}
              {gitLabInstanceLabel(linkedGitLab.host ?? "")}, but Dyad is
              connected to {gitLabInstanceLabel(status.instanceUrl ?? "")}.
              Enter a token for {gitLabInstanceLabel(linkedGitLab.host ?? "")}{" "}
              to sync it.
            </p>
            {/* The form is here rather than a pointer to Settings: the
                connected row there offers only Disconnect, so following that
                advice led to a dead end — and with the experiment off the
                section disappears the moment the user disconnects. Saving a
                token replaces the connection, so no disconnect is needed. */}
            <div className="mt-3">
              <GitLabCredentialsForm
                key={appId}
                defaultInstanceUrl={linkedGitLab.host}
              />
            </div>
          </div>
        )}
        <ConnectedGitHubConnector appId={appId} app={app} />
      </div>
    );
  }

  return (
    // Keyed on the app: the link form seeds its project name from the folder
    // and this subtree is not remounted when the selected app changes, so
    // without a key the next app would be offered the previous app's name.
    <UnconnectedGitLabConnector
      key={appId ?? "no-app"}
      appId={appId}
      folderName={folderName}
      status={status}
      expanded={expanded}
      linked={linkedGitLab}
    />
  );
}

interface UnconnectedGitLabConnectorProps {
  appId: number | null;
  folderName: string;
  status: GitLabStatus | null;
  expanded?: boolean;
  linked: LinkedRemote | null;
}

export function UnconnectedGitLabConnector({
  appId,
  folderName,
  status,
  expanded,
  linked,
}: UnconnectedGitLabConnectorProps) {
  const { projection, send, connection } = useGithubOps(appId, {
    reconcileOnMount: linked !== null,
  });
  const { canConnectRepository } = projection.capabilities;
  const [isExpanded, setIsExpanded] = useState(expanded || false);
  const [mode, setMode] = useState<"create" | "existing">("create");
  const connected = !!status?.connected;

  // --- Create ---
  const namespaces = useQuery({
    queryKey: queryKeys.gitlab.namespaces,
    queryFn: () => ipc.gitlab.listNamespaces(),
    enabled: connected && mode === "create",
  });
  const [namespaceId, setNamespaceId] = useState<string>("");
  useEffect(() => {
    if (!namespaceId && namespaces.data?.[0]) {
      setNamespaceId(String(namespaces.data[0].id));
    }
  }, [namespaces.data, namespaceId]);
  const selectedNamespace =
    namespaces.data?.find((ns) => String(ns.id) === namespaceId) ?? null;

  const [projectName, setProjectName] = useState(() =>
    slugifyAppPath(folderName),
  );
  const [projectAvailable, setProjectAvailable] = useState<boolean | null>(
    null,
  );
  const [projectCheckError, setProjectCheckError] = useState<string | null>(
    null,
  );
  const [isCheckingProject, setIsCheckingProject] = useState(false);
  const [newBranch, setNewBranch] = useState("main");

  // Every check gets a sequence number and only the newest may write. A
  // lookup against a slow self-hosted instance can outlive the name it was
  // started for, and an older answer landing last would report availability
  // for a name the user has already changed.
  const latestCheckRef = useRef(0);

  const checkAvailability = useCallback(
    async (name: string, namespaceFullPath: string | null) => {
      const checkId = ++latestCheckRef.current;
      const isCurrent = () => latestCheckRef.current === checkId;
      setProjectCheckError(null);
      setProjectAvailable(null);
      if (!name || !namespaceFullPath) return;
      setIsCheckingProject(true);
      try {
        const result = await ipc.gitlab.isProjectAvailable({
          namespaceFullPath,
          path: name,
        });
        if (!isCurrent()) return;
        setProjectAvailable(result.available);
        if (!result.available) {
          setProjectCheckError(
            result.error || "Project name is not available.",
          );
        }
      } catch (err: any) {
        if (!isCurrent()) return;
        setProjectCheckError(
          err?.message || "Failed to check project availability.",
        );
      } finally {
        if (isCurrent()) setIsCheckingProject(false);
      }
    },
    [],
  );

  // A project name is only free within a namespace, so the check has to
  // follow both. Driving it from an effect rather than the name's onChange
  // also covers the name prefilled from the folder — the commonest path is to
  // accept it and press Create, which never used to be checked at all.
  useEffect(() => {
    if (mode !== "create") return;
    const namespaceFullPath = selectedNamespace?.fullPath ?? null;
    if (!projectName || !namespaceFullPath) {
      setProjectAvailable(null);
      setProjectCheckError(null);
      return;
    }
    const timer = setTimeout(() => {
      void checkAvailability(projectName, namespaceFullPath);
    }, 500);
    return () => clearTimeout(timer);
  }, [mode, projectName, selectedNamespace?.fullPath, checkAvailability]);

  // --- Existing ---
  const projects = useQuery({
    queryKey: queryKeys.gitlab.projects,
    queryFn: () => ipc.gitlab.listProjects(),
    enabled: connected && mode === "existing",
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const projectId = selectedProjectId ? Number(selectedProjectId) : null;
  const branches = useQuery({
    queryKey: queryKeys.gitlab.branches({ projectId: projectId ?? -1 }),
    queryFn: () => ipc.gitlab.getProjectBranches({ projectId: projectId! }),
    enabled: connected && mode === "existing" && projectId !== null,
  });
  const [selectedBranch, setSelectedBranch] = useState("main");
  const [branchInputMode, setBranchInputMode] = useState<"select" | "custom">(
    "select",
  );
  const [customBranchName, setCustomBranchName] = useState("");
  useEffect(() => {
    if (!branches.data) return;
    setBranchInputMode("select");
    setCustomBranchName("");
    const preferred =
      branches.data.find((b) => b.name === "main" || b.name === "master") ??
      branches.data[0];
    if (preferred) setSelectedBranch(preferred.name);
  }, [branches.data]);

  const isLinking = projection.runningOperation?.type === "connect-repo";
  const linkError =
    projection.banner?.kind === "error" ? projection.banner.message : null;
  const linkSuccess =
    projection.banner?.kind === "success" ? projection.banner.message : null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!appId) return;
    if (mode === "create") {
      if (!selectedNamespace) return;
      send({
        type: "OP_REQUESTED",
        op: {
          type: "connect-repo",
          provider: "gitlab",
          mode: "create",
          namespaceId: selectedNamespace.id,
          repo: projectName,
          branch: newBranch || "main",
          thenAutoPush: true,
        },
      });
    } else {
      if (projectId === null) return;
      send({
        type: "OP_REQUESTED",
        op: {
          type: "connect-repo",
          provider: "gitlab",
          mode: "existing",
          projectId,
          branch:
            branchInputMode === "custom"
              ? customBranchName.trim()
              : selectedBranch,
          thenAutoPush: true,
        },
      });
    }
  };

  if (!connected) {
    return (
      <div className="mt-1 w-full" data-testid="gitlab-unconnected-repo">
        {linked && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-medium">Reconnect your GitLab account</p>
            <p className="mt-1">
              This app is linked to {linked.displayPath} on{" "}
              {gitLabInstanceLabel(linked.host ?? "")}, but GitLab credentials
              are missing from settings.
            </p>
          </div>
        )}
        {/* Keyed on the app: the prefilled instance comes from the app row,
            and this subtree is not remounted when the selected app changes,
            so without a key the field keeps the previous app's host — and the
            token would be sent to the wrong instance. */}
        <GitLabCredentialsForm
          key={appId}
          defaultInstanceUrl={linked?.host ?? null}
          onConnected={() => setIsExpanded(true)}
        />
      </div>
    );
  }

  const canSubmit =
    canConnectRepository &&
    !isLinking &&
    (mode === "create"
      ? // Waits for a check already in flight rather than letting a fast
        // typist submit the name it was about to flag.
        !isCheckingProject &&
        projectAvailable !== false &&
        !!projectName &&
        !!selectedNamespace
      : projectId !== null &&
        (branchInputMode === "custom"
          ? customBranchName.trim().length > 0
          : !!selectedBranch));

  return (
    <div className="w-full" data-testid="gitlab-setup-repo">
      {connection !== "ready" && (
        <p className="px-4 pt-2 text-sm text-muted-foreground">
          {connection === "connecting"
            ? "Loading GitLab controls…"
            : "GitLab controls are temporarily unavailable."}
        </p>
      )}
      <button
        type="button"
        onClick={!isExpanded ? () => setIsExpanded(true) : undefined}
        className={`w-full p-4 text-left transition-colors rounded-md flex items-center justify-between ${
          !isExpanded
            ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
            : ""
        }`}
      >
        <span className="font-medium">
          Set up your GitLab project
          {status?.instanceUrl && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {gitLabInstanceLabel(status.instanceUrl)}
              {status.username ? ` · ${status.username}` : ""}
            </span>
          )}
        </span>
        {isExpanded ? undefined : (
          <ChevronRight className="h-4 w-4 text-gray-500" />
        )}
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="p-4 pt-0 space-y-4">
          <SegmentedChoice
            ariaLabel="How to link this app to GitLab"
            value={mode}
            onChange={(next) => {
              setMode(next);
              send({ type: "BANNER_DISMISSED" });
            }}
            options={[
              { value: "create", label: "Create new project" },
              { value: "existing", label: "Connect to existing project" },
            ]}
          />

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === "create" ? (
              <>
                <div>
                  <Label className="block text-sm font-medium">Namespace</Label>
                  <Select
                    value={namespaceId}
                    onValueChange={(v) => setNamespaceId(v ?? "")}
                    disabled={namespaces.isLoading}
                  >
                    <SelectTrigger
                      className="w-full mt-1"
                      data-testid="gitlab-namespace-select"
                    >
                      <SelectValue
                        placeholder={
                          namespaces.isLoading
                            ? "Loading namespaces..."
                            : "Select a group or your own namespace"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(namespaces.data ?? []).map((ns) => (
                        <SelectItem key={ns.id} value={String(ns.id)}>
                          {ns.fullPath}
                          {ns.kind === "user" ? " (personal)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {namespaces.error && (
                    <p className="text-xs text-red-600 mt-1">
                      {namespaces.error.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="block text-sm font-medium">
                    Project Name
                  </Label>
                  <Input
                    data-testid="gitlab-create-project-name-input"
                    className="w-full mt-1"
                    value={projectName}
                    onChange={(event) => {
                      setProjectName(event.target.value);
                      setProjectAvailable(null);
                      setProjectCheckError(null);
                    }}
                    disabled={isLinking}
                  />
                  {isCheckingProject && (
                    <p className="text-xs text-gray-500 mt-1">
                      Checking availability...
                    </p>
                  )}
                  {projectAvailable === true && (
                    <p className="text-xs text-green-600 mt-1">
                      Project name is available!
                    </p>
                  )}
                  {projectAvailable === false && (
                    <p className="text-xs text-red-600 mt-1">
                      {projectCheckError}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div>
                <Label className="block text-sm font-medium">
                  Select Project
                </Label>
                <Select
                  value={selectedProjectId}
                  onValueChange={(v) => setSelectedProjectId(v ?? "")}
                  disabled={projects.isLoading}
                >
                  <SelectTrigger
                    className="w-full mt-1"
                    data-testid="gitlab-project-select"
                  >
                    <SelectValue
                      placeholder={
                        projects.isLoading
                          ? "Loading projects..."
                          : "Select a project"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects.data ?? []).map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.pathWithNamespace}
                        {project.visibility === "private" ? " (private)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {projects.error && (
                  <p className="text-xs text-red-600 mt-1">
                    {projects.error.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Projects you maintain are listed; GitLab lets only Maintainers
                  push to a protected default branch.
                </p>
              </div>
            )}

            <div>
              <Label className="block text-sm font-medium">Branch</Label>
              {mode === "existing" && projectId !== null ? (
                <div className="space-y-2">
                  <Select
                    value={
                      branchInputMode === "select" ? selectedBranch : "custom"
                    }
                    onValueChange={(value) => {
                      if (value === "custom") {
                        setBranchInputMode("custom");
                        setCustomBranchName("");
                      } else if (value) {
                        setBranchInputMode("select");
                        setSelectedBranch(value);
                      }
                    }}
                    disabled={branches.isLoading}
                  >
                    <SelectTrigger
                      className="w-full mt-1"
                      data-testid="gitlab-branch-select"
                    >
                      <SelectValue
                        placeholder={
                          branches.isLoading
                            ? "Loading branches..."
                            : "Select a branch"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(branches.data ?? []).map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">
                        <span className="font-medium">
                          ✏️ Type custom branch name
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {branchInputMode === "custom" && (
                    <Input
                      data-testid="gitlab-custom-branch-input"
                      className="w-full"
                      value={customBranchName}
                      onChange={(event) =>
                        setCustomBranchName(event.target.value)
                      }
                      placeholder="Enter branch name (e.g., feature/new-feature)"
                      disabled={isLinking}
                    />
                  )}
                </div>
              ) : (
                <Input
                  className="w-full mt-1"
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                  placeholder="main"
                  disabled={isLinking}
                  data-testid="gitlab-new-project-branch-input"
                />
              )}
            </div>

            <Button
              type="submit"
              disabled={!canSubmit}
              data-testid="gitlab-link-submit"
            >
              {isLinking
                ? mode === "create"
                  ? "Creating..."
                  : "Connecting..."
                : mode === "create"
                  ? "Create Project"
                  : "Connect to Project"}
            </Button>
          </form>

          {linkError && (
            <div className="mt-2">
              <GitHubOperationError
                message={linkError}
                providerLabel="GitLab"
              />
            </div>
          )}
          {linkSuccess && <p className="text-green-600 mt-2">{linkSuccess}</p>}
        </div>
      </div>
    </div>
  );
}
