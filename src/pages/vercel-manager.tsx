import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Folder,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Triangle,
} from "lucide-react";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import { useVercelAccount } from "@/hooks/useVercelAccount";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import type { VercelProject } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showSuccess } from "@/lib/toast";

export default function VercelManagerPage() {
  const queryClient = useQueryClient();
  const {
    isConnected,
    projects,
    isLoadingProjects,
    refetchProjects,
    connect,
    isConnecting,
    disconnect,
    isDisconnecting,
  } = useVercelAccount();

  const [tokenInput, setTokenInput] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectEditor, setProjectEditor] = useState<{
    mode: "create" | "edit";
    project?: VercelProject;
  } | null>(null);
  const [projectName, setProjectName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<VercelProject | null>(null);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const handleConnect = async () => {
    if (!tokenInput.trim()) {
      showError("Enter a Vercel access token");
      return;
    }
    await connect(tokenInput.trim());
    setTokenInput("");
  };

  const refreshProjectList = async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.vercel.projects,
    });
  };

  const createProjectMutation = useMutation({
    mutationFn: (name: string) =>
      ipc.vercel.createManagerProject({ name: name.trim() }),
    onSuccess: async () => {
      await refreshProjectList();
      setProjectEditor(null);
      setProjectName("");
      showSuccess("Vercel project created");
    },
    onError: (error) => showError(error),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      ipc.vercel.updateManagerProject({ projectId, name: name.trim() }),
    onSuccess: async () => {
      await refreshProjectList();
      setProjectEditor(null);
      setProjectName("");
      showSuccess("Vercel project renamed");
    },
    onError: (error) => showError(error),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) =>
      ipc.vercel.deleteManagerProject({ projectId }),
    onSuccess: async () => {
      await refreshProjectList();
      setDeleteTarget(null);
      showSuccess("Vercel project deleted");
    },
    onError: (error) => showError(error),
  });

  const saveProject = () => {
    if (!projectName.trim() || !projectEditor) return;
    if (projectEditor.mode === "create") {
      createProjectMutation.mutate(projectName);
    } else if (projectEditor.project) {
      updateProjectMutation.mutate({
        projectId: projectEditor.project.id,
        name: projectName,
      });
    }
  };

  const isSavingProject =
    createProjectMutation.isPending || updateProjectMutation.isPending;

  return (
    <div
      className="manager-page home-jarvis relative flex min-h-full w-full flex-col overflow-visible lg:overflow-hidden"
      data-testid="vercel-manager-page"
    >
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-h-full lg:h-full lg:max-h-full flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:overflow-hidden">
        <div className="mx-auto w-full max-w-6xl flex flex-col flex-1 min-h-0 lg:h-full lg:overflow-hidden">
          <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between flex-shrink-0">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="manager-brand-icon">
                  <Triangle className="size-4 fill-current" />
                </div>
                <span className="manager-brand-label font-jarvis-ui">
                  VERCEL
                </span>
                <div className="manager-status-dot manager-status-dot--active" />
              </div>
              <h1 className="manager-title font-jarvis-display">
                Deployment Manager
              </h1>
              <p className="manager-subtitle">
                Connect with an access token to browse your Vercel projects.
                Link projects to apps from the publish panel when you deploy.
              </p>
            </div>
            {isConnected && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="manager-action-btn"
                  onClick={() => refetchProjects()}
                  disabled={isLoadingProjects}
                >
                  <RefreshCw
                    className={cn(
                      "mr-2 size-4",
                      isLoadingProjects && "animate-spin",
                    )}
                  />
                  Refresh
                </Button>
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
              data-testid="vercel-manager-connect"
            >
              <div className="manager-connect-header">
                <Triangle className="size-5 fill-current" />
                <span>Connect with access token</span>
              </div>
              <p className="manager-connect-desc">
                Create a token at{" "}
                <button
                  type="button"
                  className="manager-link"
                  onClick={() =>
                    ipc.system.openExternalUrl(
                      "https://vercel.com/account/settings/tokens",
                    )
                  }
                >
                  Vercel account settings
                </button>
                .
              </p>
              <div className="mt-5 space-y-2">
                <Label htmlFor="vercel-token" className="manager-label">
                  Access token
                </Label>
                <Input
                  id="vercel-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Enter your token"
                  className="manager-input"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  data-testid="vercel-token-input"
                />
              </div>
              <Button
                className="manager-connect-btn"
                onClick={handleConnect}
                disabled={isConnecting}
                data-testid="vercel-token-connect-button"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  "Connect Vercel"
                )}
              </Button>
            </section>
          ) : (
            <section className="manager-panel lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:flex lg:flex-col">
              <div className="manager-panel-header">
                <h2 className="manager-panel-title font-jarvis-ui">PROJECTS</h2>
                <span className="manager-panel-count font-jarvis-ui">
                  {filteredProjects.length}
                </span>
                <div className="manager-search-wrap">
                  <Search className="manager-search-icon" />
                  <Input
                    className="manager-search-input"
                    placeholder="Search projects…"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    data-testid="vercel-project-search"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="manager-action-btn h-8 gap-1.5"
                  onClick={() => {
                    setProjectName("");
                    setProjectEditor({ mode: "create" });
                  }}
                  data-testid="vercel-create-project"
                >
                  <Plus className="size-3.5" />
                  New project
                </Button>
              </div>
              {isLoadingProjects ? (
                <div className="manager-loading">
                  <Loader2 className="size-5 animate-spin" />
                  <span>Loading projects…</span>
                </div>
              ) : filteredProjects.length === 0 ? (
                <p className="manager-empty-msg">
                  {projectSearch.trim()
                    ? "No projects match your search."
                    : "No projects found on this account."}
                </p>
              ) : (
                <div className="manager-grid">
                  {filteredProjects.map((project) => (
                    <article
                      key={project.id}
                      className="manager-grid-item group"
                      data-testid={`vercel-project-${project.id}`}
                    >
                      <div className="manager-grid-icon-wrap">
                        <Folder className="manager-grid-icon" />
                      </div>
                      <div className="manager-grid-label">
                        <p className="manager-grid-name">{project.name}</p>
                        {project.framework && (
                          <p className="manager-grid-meta">
                            {project.framework}
                          </p>
                        )}
                        <div className="mt-3 flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-cyan-100/45 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
                            aria-label={`Rename ${project.name}`}
                            onClick={() => {
                              setProjectName(project.name);
                              setProjectEditor({ mode: "edit", project });
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-cyan-100/45 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
                            aria-label={`Open ${project.name} in Vercel`}
                            onClick={() =>
                              void ipc.system.openExternalUrl(
                                "https://vercel.com/dashboard",
                              )
                            }
                          >
                            <ExternalLink className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-red-300/55 transition-colors hover:bg-red-400/10 hover:text-red-300"
                            aria-label={`Delete ${project.name}`}
                            onClick={() => setDeleteTarget(project)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={projectEditor !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingProject) setProjectEditor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {projectEditor?.mode === "create"
                ? "Create Vercel project"
                : "Rename Vercel project"}
            </DialogTitle>
            <DialogDescription>
              {projectEditor?.mode === "create"
                ? "Create an empty project in your connected Vercel account."
                : "Change the project name used by Vercel."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="vercel-project-name">Project name</Label>
            <Input
              id="vercel-project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveProject();
              }}
              autoFocus
              data-testid="vercel-project-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectEditor(null)}
              disabled={isSavingProject}
            >
              Cancel
            </Button>
            <Button
              onClick={saveProject}
              disabled={!projectName.trim() || isSavingProject}
              data-testid="vercel-project-save"
            >
              {isSavingProject && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              {projectEditor?.mode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={deleteTarget !== null}
        title="Delete Vercel project"
        message={`Delete "${deleteTarget?.name ?? ""}" from Vercel? This permanently removes the project and cannot be undone.`}
        confirmText={
          deleteProjectMutation.isPending ? "Deleting…" : "Delete project"
        }
        cancelText="Cancel"
        confirmDisabled={deleteProjectMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteProjectMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
