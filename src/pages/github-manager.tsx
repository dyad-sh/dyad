import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  Github,
  Loader2,
  Plus,
  GitBranch,
  History,
  PenLine,
  RefreshCw,
  Upload,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ipc, type GithubRepository } from "@/ipc/types";
import type { GitHubContentEntry } from "@/ipc/types/github";
import { queryKeys } from "@/lib/queryKeys";
import { useGithubRepos } from "@/hooks/useGithubRepos";
import { useGithubAccount } from "@/hooks/useGithubAccount";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
function parseRepo(repo: GithubRepository) {
  return { owner: repo.owner, repo: repo.name };
}

export default function GitHubManagerPage() {
  const queryClient = useQueryClient();
  const {
    isConnected,
    account,
    setAccessToken,
    isConnecting,
    disconnect,
    isDisconnecting,
  } = useGithubAccount();
  const {
    repos,
    loading: reposLoading,
    error: reposError,
  } = useGithubRepos({
    enabled: isConnected,
  });

  const [patInput, setPatInput] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GithubRepository | null>(
    null,
  );
  const [currentPath, setCurrentPath] = useState("");
  /** Empty means the repository default branch. */
  const [branch, setBranch] = useState("");
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    sha: string;
    content: string;
  } | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [commitMessage, setCommitMessage] = useState(
    "Update via Meta Human OS",
  );

  const [createRepoOpen, setCreateRepoOpen] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [deleteRepoTarget, setDeleteRepoTarget] =
    useState<GithubRepository | null>(null);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [commitsOpen, setCommitsOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFileName, setNewFileName] = useState("README.md");

  const owner = selectedRepo?.owner ?? "";
  const repoName = selectedRepo?.name ?? "";

  const contentsQuery = useQuery({
    queryKey: queryKeys.github.contents({
      owner,
      repo: repoName,
      path: currentPath,
      ref: branch,
    }),
    queryFn: () =>
      ipc.github.listContents({
        owner,
        repo: repoName,
        path: currentPath || undefined,
        ref: branch || undefined,
      }),
    enabled: isConnected && !!selectedRepo,
    meta: { showErrorToast: true },
  });

  // The repository's real branches. Nothing is listed that GitHub did not
  // return, and the selector only appears once there is more than one.
  const branchesQuery = useQuery({
    queryKey: ["github", "branches", owner, repoName],
    queryFn: () => ipc.github.getRepoBranches({ owner, repo: repoName }),
    enabled: isConnected && !!selectedRepo,
  });
  const branches = branchesQuery.data ?? [];
  const activeBranch = branch || selectedRepo?.default_branch || "";

  const filteredRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.full_name.toLowerCase().includes(q),
    );
  }, [repos, repoSearch]);

  const pathSegments = currentPath ? currentPath.split("/") : [];

  const uploadMutation = useMutation({
    mutationFn: () =>
      ipc.github.uploadContent({
        owner,
        repo: repoName,
        path: currentPath,
        message: commitMessage.trim() || "Add files via Meta Human OS",
        ref: branch || undefined,
      }),
    onSuccess: async ({ uploaded }) => {
      // A cancelled dialog is not a failure, and not a success worth a toast.
      if (uploaded.length === 0) return;
      showSuccess(
        uploaded.length === 1
          ? `Uploaded ${uploaded[0]}`
          : `Uploaded ${uploaded.length} files`,
      );
      await contentsQuery.refetch();
    },
    onError: (error: Error) => showError(error.message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ fromPath, toPath }: { fromPath: string; toPath: string }) =>
      ipc.github.renameContent({
        owner,
        repo: repoName,
        fromPath,
        toPath,
        message: commitMessage.trim() || `Rename ${fromPath} to ${toPath}`,
        ref: branch || undefined,
      }),
    onSuccess: async () => {
      showSuccess("File renamed");
      setRenameTarget(null);
      setSelectedFile(null);
      await contentsQuery.refetch();
    },
    onError: (error: Error) => showError(error.message),
  });

  // Recent commits for the branch being browsed, and for the folder in view.
  const commitsQuery = useQuery({
    queryKey: [
      "github",
      "commits",
      owner,
      repoName,
      branch,
      currentPath,
    ] as const,
    queryFn: () =>
      ipc.github.listCommits({
        owner,
        repo: repoName,
        ref: branch || undefined,
        path: currentPath || undefined,
        limit: 20,
      }),
    enabled: isConnected && !!selectedRepo && commitsOpen,
  });

  const createRepoMutation = useMutation({
    mutationFn: (name: string) =>
      ipc.github.createManagerRepo({ name, private: true }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.repos });
      setSelectedRepo(created);
      setCurrentPath("");
      setSelectedFile(null);
      setCreateRepoOpen(false);
      setNewRepoName("");
      showSuccess("Repository created");
    },
    onError: (error) => showError(error),
  });

  const deleteRepoMutation = useMutation({
    mutationFn: ({ owner: o, repo: r }: { owner: string; repo: string }) =>
      ipc.github.deleteRepo({ owner: o, repo: r }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.repos });
      if (
        selectedRepo &&
        deleteRepoTarget &&
        selectedRepo.full_name === deleteRepoTarget.full_name
      ) {
        setSelectedRepo(null);
        setSelectedFile(null);
        setCurrentPath("");
      }
      setDeleteRepoTarget(null);
      showSuccess("Repository deleted");
    },
    onError: (error) => showError(error),
  });

  const saveFileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRepo || !selectedFile) return;
      const { owner: o, repo: r } = parseRepo(selectedRepo);
      return ipc.github.upsertContent({
        owner: o,
        repo: r,
        path: selectedFile.path,
        content: editorContent,
        message: commitMessage.trim() || "Update file",
        sha: selectedFile.sha,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.all });
      showSuccess("File saved");
    },
    onError: (error) => showError(error),
  });

  const deleteFileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRepo || !selectedFile) return;
      const { owner: o, repo: r } = parseRepo(selectedRepo);
      return ipc.github.deleteContent({
        owner: o,
        repo: r,
        path: selectedFile.path,
        message: commitMessage.trim() || "Delete file",
        sha: selectedFile.sha,
      });
    },
    onSuccess: async () => {
      setSelectedFile(null);
      setEditorContent("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.all });
      showSuccess("File deleted");
    },
    onError: (error) => showError(error),
  });

  const openFile = async (entry: GitHubContentEntry) => {
    if (!selectedRepo || entry.type !== "file") return;
    const { owner: o, repo: r } = parseRepo(selectedRepo);
    try {
      const file = await ipc.github.getContent({
        ref: branch || undefined,
        owner: o,
        repo: r,
        path: entry.path,
      });
      setSelectedFile({
        path: file.path,
        sha: file.sha,
        content: file.content,
      });
      setEditorContent(file.content);
    } catch (error) {
      showError(error);
    }
  };

  const handleConnectPat = async () => {
    if (!patInput.trim()) {
      showError("Enter a personal access token");
      return;
    }
    await setAccessToken(patInput.trim());
    setPatInput("");
  };

  const handleCreateFile = async () => {
    if (!selectedRepo || !newFileName.trim()) return;
    const filePath = currentPath
      ? `${currentPath}/${newFileName.trim()}`
      : newFileName.trim();
    const { owner: o, repo: r } = parseRepo(selectedRepo);
    try {
      const result = await ipc.github.upsertContent({
        owner: o,
        repo: r,
        path: filePath,
        content: "",
        message: `Create ${newFileName.trim()}`,
      });
      setNewFileOpen(false);
      setNewFileName("README.md");
      await queryClient.invalidateQueries({ queryKey: queryKeys.github.all });
      setSelectedFile({
        path: filePath,
        sha: result.sha,
        content: "",
      });
      setEditorContent("");
      showSuccess("File created");
    } catch (error) {
      showError(error);
    }
  };

  const breadcrumbNavigate = (index: number) => {
    if (index < 0) {
      setCurrentPath("");
    } else {
      setCurrentPath(pathSegments.slice(0, index + 1).join("/"));
    }
    setSelectedFile(null);
  };

  return (
    <div
      className="manager-page home-jarvis relative flex min-h-full w-full flex-col overflow-visible lg:overflow-hidden"
      data-testid="github-manager-page"
    >
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-h-full lg:h-full lg:max-h-full flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:overflow-hidden">
        <div className="mx-auto w-full max-w-6xl flex flex-col flex-1 min-h-0 lg:h-full lg:overflow-hidden">
          <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between flex-shrink-0">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="manager-brand-icon">
                  <Github className="size-4" />
                </div>
                <span className="manager-brand-label font-jarvis-ui">
                  GITHUB
                </span>
                {isConnected && account && (
                  <span className="manager-user-badge font-jarvis-ui">
                    {account.login ?? settingsLabel(account)}
                  </span>
                )}
              </div>
              <h1 className="manager-title font-jarvis-display">
                Repository Manager
              </h1>
              <p className="manager-subtitle">
                Connect with a personal access token, then create repositories
                and manage files directly on GitHub.
              </p>
            </div>
            {isConnected && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="manager-action-btn"
                  onClick={() => disconnect()}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            )}
          </header>

          {!isConnected ? (
            <section
              className="manager-connect-card"
              data-testid="github-manager-connect"
            >
              <div className="manager-connect-header">
                <Github className="size-5" />
                <span>Connect with PAT</span>
              </div>
              <p className="manager-connect-desc">
                Create a token at GitHub → Settings → Developer settings →
                Personal access tokens. Required scope:{" "}
                <code className="manager-code">repo</code>.
              </p>
              <div className="mt-5 space-y-2">
                <Label htmlFor="github-pat" className="manager-label">
                  Personal access token
                </Label>
                <Input
                  id="github-pat"
                  type="password"
                  autoComplete="off"
                  placeholder="ghp_…"
                  className="manager-input"
                  value={patInput}
                  onChange={(e) => setPatInput(e.target.value)}
                  data-testid="github-pat-input"
                />
              </div>
              <Button
                className="manager-connect-btn"
                onClick={handleConnectPat}
                disabled={isConnecting}
                data-testid="github-pat-connect-button"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Connect GitHub"
                )}
              </Button>
            </section>
          ) : (
            <div className="manager-split-layout lg:flex-1 lg:min-h-0 lg:overflow-hidden">
              {/* Repositories sidebar */}
              <aside className="manager-sidebar">
                <div className="manager-panel-header">
                  <h2 className="manager-panel-title font-jarvis-ui">REPOS</h2>
                  <span className="manager-panel-count font-jarvis-ui">
                    {filteredRepos.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="manager-action-btn ml-auto h-7 gap-1 px-2"
                    onClick={() => setCreateRepoOpen(true)}
                    data-testid="github-create-repo-button"
                  >
                    <Plus className="size-3.5" />
                    New
                  </Button>
                </div>
                <div className="manager-sidebar-search">
                  <Search className="manager-search-icon" />
                  <Input
                    className="manager-search-input"
                    placeholder="Search repos…"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                  />
                </div>
                <div className="manager-sidebar-content scrollbar-on-hover">
                  {reposLoading ? (
                    <div className="manager-loading">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                  ) : reposError ? (
                    <p className="manager-empty-msg text-red-400/80">
                      Failed to load repositories
                    </p>
                  ) : filteredRepos.length === 0 ? (
                    <p className="manager-empty-msg">No repositories found</p>
                  ) : (
                    <div className="manager-sidebar-grid">
                      {filteredRepos.map((repo) => {
                        const active =
                          selectedRepo?.full_name === repo.full_name;
                        return (
                          <div
                            key={repo.full_name}
                            className={cn(
                              "manager-grid-item group",
                              active && "manager-grid-item--active",
                            )}
                            data-testid={`github-repo-${repo.name}`}
                            onClick={() => {
                              setSelectedRepo(repo);
                              setCurrentPath("");
                              setSelectedFile(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                setSelectedRepo(repo);
                                setCurrentPath("");
                                setSelectedFile(null);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="manager-grid-icon-wrap">
                              <Folder
                                className={cn(
                                  "manager-grid-icon",
                                  active
                                    ? "text-[var(--jarvis-cyan)]"
                                    : "text-amber-400/80",
                                )}
                              />
                            </div>
                            <span className="manager-grid-name text-xs">
                              {repo.name}
                            </span>
                            <button
                              type="button"
                              className="manager-delete-btn"
                              aria-label={`Delete ${repo.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteRepoTarget(repo);
                              }}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </aside>

              {/* File browser + editor */}
              <section className="manager-main-panel">
                {!selectedRepo ? (
                  <div className="manager-empty-main">
                    <Folder className="size-10 text-[var(--jarvis-cyan)]/30" />
                    <p>Select a repository to browse and edit files</p>
                  </div>
                ) : (
                  <>
                    {/* Breadcrumb bar */}
                    <div className="manager-breadcrumb-bar">
                      <nav className="manager-breadcrumb font-jarvis-ui">
                        <button
                          type="button"
                          className="manager-breadcrumb-root"
                          onClick={() => breadcrumbNavigate(-1)}
                        >
                          {selectedRepo.name}
                        </button>
                        {pathSegments.map((segment, index) => (
                          <span
                            key={segment}
                            className="flex items-center gap-1"
                          >
                            <ChevronRight className="size-3.5 text-[var(--jarvis-cyan)]/30" />
                            <button
                              type="button"
                              className="manager-breadcrumb-seg"
                              onClick={() => breadcrumbNavigate(index)}
                            >
                              {segment}
                            </button>
                          </span>
                        ))}
                      </nav>
                      <div className="flex flex-wrap items-center gap-1">
                        {/* Only when there is a choice to make. */}
                        {branches.length > 1 && (
                          <label className="flex items-center gap-1.5 text-[11px] text-cyan-100/45">
                            <GitBranch className="size-3.5 text-cyan-300/70" />
                            <select
                              value={activeBranch}
                              onChange={(event) => {
                                setBranch(event.target.value);
                                // A path on one branch may not exist on
                                // another, so browsing restarts at the root.
                                setCurrentPath("");
                                setSelectedFile(null);
                              }}
                              className="rounded-md border border-cyan-400/20 bg-cyan-950/30 px-1.5 py-1 text-[11px] text-cyan-100 outline-none focus:border-cyan-400/40"
                              data-testid="github-branch-select"
                            >
                              {branches.map((item) => (
                                <option key={item.name} value={item.name}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="manager-action-btn h-7"
                          onClick={() => contentsQuery.refetch()}
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="manager-action-btn h-7 gap-1"
                          onClick={() => setNewFileOpen(true)}
                        >
                          <FilePlus className="size-3.5" />
                          New file
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="manager-action-btn h-7 gap-1"
                          onClick={() => uploadMutation.mutate()}
                          disabled={uploadMutation.isPending}
                          data-testid="github-upload"
                        >
                          <Upload className="size-3.5" />
                          {uploadMutation.isPending ? "Uploading…" : "Upload"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="manager-action-btn h-7 gap-1"
                          onClick={() => setCommitsOpen((open) => !open)}
                          data-testid="github-commits-toggle"
                        >
                          <History className="size-3.5" />
                          History
                        </Button>
                      </div>
                    </div>

                    {commitsOpen && (
                      <div
                        className="border-b border-cyan-500/10 bg-cyan-950/15 px-3 py-2"
                        data-testid="github-commits"
                      >
                        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-cyan-100/40">
                          Recent commits
                          {currentPath ? ` · ${currentPath}` : ""}
                          {activeBranch ? ` · ${activeBranch}` : ""}
                        </p>
                        {commitsQuery.isLoading && (
                          <p className="text-xs text-cyan-100/35">Loading…</p>
                        )}
                        {commitsQuery.data?.length === 0 && (
                          <p className="text-xs text-cyan-100/35">
                            No commits here.
                          </p>
                        )}
                        <ul className="max-h-40 space-y-1 overflow-y-auto scrollbar-on-hover">
                          {(commitsQuery.data ?? []).map((commit) => (
                            <li
                              key={commit.sha}
                              className="flex items-baseline gap-2 text-xs"
                            >
                              <code className="shrink-0 font-mono text-[10px] text-cyan-300/60">
                                {commit.sha.slice(0, 7)}
                              </code>
                              <span className="min-w-0 flex-1 truncate text-cyan-50/75">
                                {commit.message}
                              </span>
                              <span className="shrink-0 text-[10px] text-cyan-100/30">
                                {commit.authorName ?? ""}
                                {commit.date
                                  ? ` · ${new Date(commit.date).toLocaleDateString()}`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="manager-main-split">
                      {/* File listing */}
                      <div className="manager-file-list scrollbar-on-hover">
                        {contentsQuery.isLoading ? (
                          <div className="manager-loading">
                            <Loader2 className="size-5 animate-spin" />
                          </div>
                        ) : (
                          <div className="manager-file-grid">
                            {(contentsQuery.data ?? []).map((entry) => (
                              <button
                                key={entry.path}
                                type="button"
                                onClick={() => {
                                  if (entry.type === "dir") {
                                    setCurrentPath(entry.path);
                                    setSelectedFile(null);
                                  } else {
                                    void openFile(entry);
                                  }
                                }}
                                className={cn(
                                  "manager-grid-item",
                                  selectedFile?.path === entry.path &&
                                    "manager-grid-item--active",
                                )}
                              >
                                <div className="manager-grid-icon-wrap">
                                  {entry.type === "dir" ? (
                                    <Folder className="manager-grid-icon text-amber-400/80" />
                                  ) : (
                                    <File className="manager-grid-icon text-[var(--jarvis-cyan)]/50" />
                                  )}
                                </div>
                                <span className="manager-grid-name text-xs">
                                  {entry.name}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Editor */}
                      <div className="manager-editor">
                        {selectedFile ? (
                          <>
                            <div className="manager-editor-header">
                              <span className="manager-editor-path font-jarvis-ui">
                                {selectedFile.path}
                              </span>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="manager-action-btn h-7 gap-1"
                                  onClick={() => {
                                    const name =
                                      selectedFile.path.split("/").pop() ?? "";
                                    setRenameTarget({
                                      path: selectedFile.path,
                                      name,
                                    });
                                    setRenameValue(name);
                                  }}
                                  data-testid="github-rename"
                                >
                                  <PenLine className="size-3.5" />
                                  Rename
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7"
                                  onClick={() => deleteFileMutation.mutate()}
                                  disabled={deleteFileMutation.isPending}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  className="manager-save-btn h-7 gap-1"
                                  onClick={() => saveFileMutation.mutate()}
                                  disabled={saveFileMutation.isPending}
                                >
                                  {saveFileMutation.isPending ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Save className="size-3.5" />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </div>
                            <Input
                              className="manager-commit-input"
                              placeholder="Commit message"
                              value={commitMessage}
                              onChange={(e) => setCommitMessage(e.target.value)}
                            />
                            <textarea
                              className="manager-code-editor"
                              value={editorContent}
                              onChange={(e) => setEditorContent(e.target.value)}
                              spellCheck={false}
                            />
                          </>
                        ) : (
                          <div className="manager-empty-main">
                            <File className="size-8 text-[var(--jarvis-cyan)]/25" />
                            <p>Select a file to view or edit</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>
              {/* The exact path, since this writes a new file and removes the
                  old one. */}
              {renameTarget?.path} will be moved. Include folders to move it
              somewhere else.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-file">New name or path</Label>
            <Input
              id="rename-file"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              data-testid="github-rename-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!renameTarget) return;
                const folder = renameTarget.path
                  .split("/")
                  .slice(0, -1)
                  .join("/");
                const next = renameValue.trim();
                // A name stays put; a path with slashes moves the file.
                const toPath = next.includes("/")
                  ? next
                  : folder
                    ? `${folder}/${next}`
                    : next;
                renameMutation.mutate({
                  fromPath: renameTarget.path,
                  toPath,
                });
              }}
              disabled={
                !renameValue.trim() ||
                renameValue.trim() === renameTarget?.name ||
                renameMutation.isPending
              }
              data-testid="github-rename-confirm"
            >
              {renameMutation.isPending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createRepoOpen} onOpenChange={setCreateRepoOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create repository</DialogTitle>
            <DialogDescription>
              Creates a new private repository on your GitHub account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-repo-name">Repository name</Label>
            <Input
              id="new-repo-name"
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
              placeholder="my-project"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateRepoOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createRepoMutation.mutate(newRepoName)}
              disabled={!newRepoName.trim() || createRepoMutation.isPending}
            >
              {createRepoMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteRepoTarget}
        onOpenChange={(open) => !open && setDeleteRepoTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete repository?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <strong>{deleteRepoTarget?.full_name}</strong> from GitHub. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRepoTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteRepoMutation.isPending}
              onClick={() => {
                if (!deleteRepoTarget) return;
                deleteRepoMutation.mutate(parseRepo(deleteRepoTarget));
              }}
            >
              {deleteRepoMutation.isPending ? "Deleting…" : "Delete repository"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>
              {currentPath
                ? `In folder: ${currentPath}/`
                : "At repository root"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-file-name">File name</Label>
            <Input
              id="new-file-name"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFile} disabled={!newFileName.trim()}>
              Create file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function settingsLabel(
  account: { login: string; email: string } | null | undefined,
) {
  return account?.login ?? "Connected";
}
