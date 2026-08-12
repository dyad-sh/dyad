import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FolderKanban,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";

import { ipc } from "@/ipc/types";
import type { Project } from "@/ipc/types/project";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { ProjectFiles } from "@/components/projects/ProjectFiles";
import { useSettings } from "@/hooks/useSettings";
import {
  activeChatAgentTabAtom,
  chatAgentOpenTabsAtom,
} from "@/atoms/chatAgentAtoms";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Projects — a working context that applies across the app.
 *
 * A project holds standing instructions. Making one active prepends them to
 * the assistant's system prompt, so a preference is stated once instead of at
 * the top of every conversation.
 *
 * It is not a folder. Nothing is moved into a project and nothing is hidden
 * when one is active, because a container that quietly filters what you can
 * see is a much larger promise than this makes.
 */

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const [openTabs, setOpenTabs] = useAtom(chatAgentOpenTabsAtom);
  const [, setActiveTab] = useAtom(activeChatAgentTabAtom);
  const activeId = settings?.activeProjectId ?? null;

  const [editing, setEditing] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [filesOpen, setFilesOpen] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => ipc.project.list(),
  });
  const projects = projectsQuery.data ?? [];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["projects"] });

  const openEditor = (project: Project | null) => {
    setEditing(project);
    setIsCreating(project === null);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setInstructions(project?.instructions ?? "");
  };

  const closeEditor = () => {
    setEditing(null);
    setIsCreating(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return ipc.project.update({
          id: editing.id,
          name,
          description,
          instructions,
        });
      }
      return ipc.project.create({ name, description, instructions });
    },
    onSuccess: async (project) => {
      showSuccess(
        editing ? `${project.name} saved` : `${project.name} created`,
      );
      closeEditor();
      await refresh();
    },
    onError: (error: Error) => showError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (project: Project) => ipc.project.delete({ id: project.id }),
    onSuccess: async (_result, project) => {
      // A deleted project must not stay in effect.
      if (activeId === project.id) {
        await updateSettings({ activeProjectId: null });
      }
      setDeleteTarget(null);
      await refresh();
    },
    onError: (error: Error) => showError(error.message),
  });

  const setActive = async (project: Project | null) => {
    await updateSettings({ activeProjectId: project?.id ?? null });
  };

  /**
   * Open a project as a conversation.
   *
   * Activating and opening are separate acts: activating changes what the
   * assistant knows, opening puts you in a conversation that belongs to the
   * project. Doing both here means the new chat is stamped with it rather
   * than with whatever was active a moment ago.
   */
  const openAsChat = async (project: Project) => {
    await updateSettings({ activeProjectId: project.id });

    // Return to where the work already is. Opening a project that has
    // conversations should resume the newest, not bury it under an empty one.
    const existing = conversationsFor(project.id)[0];
    if (existing) {
      setActiveTab(existing.id);
      await navigate({ to: "/chat-agent" });
      return;
    }

    const conversation = {
      id: crypto.randomUUID(),
      title: `${project.name} conversation`,
      messages: [],
      vectorCollectionIds: [],
      projectId: project.id,
      updatedAt: Date.now(),
    };
    setOpenTabs((current) => [...current, conversation]);
    setActiveTab(conversation.id);
    await navigate({ to: "/chat-agent" });
  };

  /** Conversations already belonging to a project, newest first. */
  const conversationsFor = (projectId: string) =>
    openTabs
      .filter((tab) => tab.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  const isEditorOpen = isCreating || editing !== null;

  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-y-auto bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="manager-brand-icon">
                <FolderKanban className="size-4" />
              </div>
              <span className="manager-brand-label font-jarvis-ui">
                PROJECTS
              </span>
              <div className="manager-status-dot manager-status-dot--active" />
            </div>
            <h1 className="manager-title font-jarvis-display">
              Say it once, not every time
            </h1>
            <p className="manager-subtitle">
              A project carries standing instructions. While it is active, every
              assistant in Meta Human OS follows them.
            </p>
          </div>
          {!isEditorOpen && (
            <Button
              onClick={() => openEditor(null)}
              className="border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
              data-testid="project-new"
            >
              <Plus className="size-4" />
              New project
            </Button>
          )}
        </header>

        {isEditorOpen && (
          <section className="mb-6 rounded-2xl border border-cyan-500/15 bg-[rgba(6,18,34,0.7)] p-5">
            <div className="space-y-4">
              <div>
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Client work"
                  className="mt-1"
                  data-testid="project-name"
                />
              </div>
              <div>
                <Label htmlFor="project-description">
                  Description <span className="text-cyan-100/35">optional</span>
                </Label>
                <Input
                  id="project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What this project is for"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="project-instructions">Instructions</Label>
                <Textarea
                  id="project-instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder={
                    "British spelling.\nPostgres, not MySQL.\nAlways show the SQL before running it."
                  }
                  className="mt-1 min-h-32 font-mono text-xs"
                  data-testid="project-instructions"
                />
                <p className="mt-1 text-xs text-cyan-100/35">
                  Added to the assistant&rsquo;s system prompt while this
                  project is active. Written as you type it; nothing is
                  generated for you.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={!name.trim() || saveMutation.isPending}
                  data-testid="project-save"
                >
                  {saveMutation.isPending
                    ? "Saving…"
                    : editing
                      ? "Save"
                      : "Create"}
                </Button>
                <Button variant="ghost" onClick={closeEditor}>
                  Cancel
                </Button>
              </div>
            </div>
          </section>
        )}

        {projectsQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-white/45">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        )}

        {!projectsQuery.isLoading && projects.length === 0 && !isEditorOpen && (
          <section className="rounded-2xl border border-cyan-500/12 bg-[rgba(6,18,34,0.55)] p-10 text-center">
            <FolderKanban className="mx-auto mb-3 size-6 text-cyan-300/70" />
            <p className="text-sm text-[#7aadb8]">
              No projects yet. Create one to give the assistant standing
              instructions.
            </p>
          </section>
        )}

        <div className="space-y-3">
          {projects.map((project) => {
            const isActive = project.id === activeId;
            return (
              <article
                key={project.id}
                className={cn(
                  "rounded-2xl border p-4 transition-colors",
                  isActive
                    ? "border-cyan-400/40 bg-cyan-500/8 shadow-[0_0_24px_rgba(0,229,255,0.1)]"
                    : "border-cyan-500/12 bg-[rgba(6,18,34,0.55)]",
                )}
                data-testid={`project-${project.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-medium text-cyan-50">
                        {project.name}
                      </h2>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-200">
                          <Check className="size-3" />
                          Active
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <p className="mt-1 text-sm text-cyan-100/45">
                        {project.description}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-cyan-100/30">
                      {project.instructions
                        ? `${project.instructions.trim().split("\n").length} lines of instructions`
                        : "No instructions yet"}
                      {conversationsFor(project.id).length > 0 &&
                        ` · ${conversationsFor(project.id).length} conversation${
                          conversationsFor(project.id).length === 1 ? "" : "s"
                        }`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void openAsChat(project)}
                      className="border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                      data-testid={`project-open-${project.id}`}
                    >
                      <MessageSquare className="size-3.5" />
                      Open
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void setActive(isActive ? null : project)}
                      className="border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                      data-testid={`project-activate-${project.id}`}
                    >
                      {isActive ? "Deactivate" : "Use this project"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setFilesOpen((current) =>
                          current === project.id ? null : project.id,
                        )
                      }
                      data-testid={`project-files-${project.id}`}
                    >
                      <FolderOpen className="size-3.5" />
                      Files
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditor(project)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${project.name}`}
                      onClick={() => setDeleteTarget(project)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {filesOpen === project.id && (
                  <ProjectFiles projectId={project.id} />
                )}

                {conversationsFor(project.id).length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-cyan-500/10 pt-3">
                    {conversationsFor(project.id).map((conversation) => (
                      <li key={conversation.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab(conversation.id);
                            void navigate({ to: "/chat-agent" });
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-cyan-100/60 hover:bg-cyan-500/8 hover:text-cyan-50"
                        >
                          <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                          <span className="min-w-0 flex-1 truncate">
                            {conversation.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-cyan-100/25">
                            {new Date(
                              conversation.updatedAt,
                            ).toLocaleDateString()}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </main>

      <ConfirmationDialog
        isOpen={deleteTarget !== null}
        title="Delete project?"
        message={`${deleteTarget?.name ?? "This project"} will be deleted, along with its instructions. Conversations are not affected.`}
        confirmText={deleteMutation.isPending ? "Deleting…" : "Delete"}
        cancelText="Cancel"
        confirmDisabled={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
