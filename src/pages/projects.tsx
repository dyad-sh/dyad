import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  FolderKanban,
  Loader2,
  Pencil,
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

  /**
   * Conversations recorded in the open project.
   *
   * Read from the project folder rather than the open tabs, so a conversation
   * closed weeks ago is still here to continue.
   */
  const conversationsQuery = useQuery({
    queryKey: ["project-conversations", filesOpen],
    queryFn: () =>
      ipc.project.listConversations({ projectId: filesOpen as string }),
    enabled: filesOpen !== null,
  });

  /** Conversations belonging to a project among the tabs currently open. */
  const conversationsFor = (projectId: string) =>
    openTabs
      .filter((tab) => tab.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  /**
   * Continue a recorded conversation.
   *
   * If its tab is still open, go to it. Otherwise the messages are read back
   * from the project and reopened as a tab under the same id, so continuing
   * where you left off is the same conversation rather than a copy of it.
   */
  const continueConversation = async (
    projectId: string,
    conversationId: string,
  ) => {
    const alreadyOpen = openTabs.find((tab) => tab.id === conversationId);
    if (!alreadyOpen) {
      const stored = await ipc.project.getConversation({
        projectId,
        conversationId,
      });
      setOpenTabs((current) => [
        ...current,
        {
          id: stored.id,
          title: stored.title,
          messages: stored.messages.map((message) => ({
            id: crypto.randomUUID(),
            role: message.role as "user" | "assistant",
            content: message.content,
          })),
          vectorCollectionIds: [],
          projectId,
          updatedAt: stored.updatedAt,
        },
      ]);
    }
    await updateSettings({ activeProjectId: projectId });
    setActiveTab(conversationId);
    await navigate({ to: "/chat-agent" });
  };

  const isEditorOpen = isCreating || editing !== null;
  const openProject = projects.find((project) => project.id === filesOpen);

  if (openProject) {
    return (
      <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-y-auto bg-background">
        <ParticleBackground className="z-0" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <div className="system-subheader">
            <button
              type="button"
              onClick={() => setFilesOpen(null)}
              className="system-back"
              data-testid="project-files-back"
            >
              <ChevronLeft className="size-4" />
              Projects
            </button>
            <span className="system-crumb">
              <FolderKanban className="size-3.5" />
              {openProject.name}
            </span>
          </div>

          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="system-group-label">Conversations</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openAsChat(openProject)}
                  data-testid="project-new-conversation"
                >
                  <Plus className="size-3.5" />
                  New conversation
                </Button>
              </div>

              {conversationsQuery.data?.length === 0 && (
                <p className="text-xs text-cyan-100/35">
                  No conversations recorded here yet.
                </p>
              )}

              <div className="project-file-grid">
                {(conversationsQuery.data ?? []).map((conversation) => (
                  <div
                    key={conversation.id}
                    className="project-file-tile group"
                    data-testid={`project-conversation-${conversation.id}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        void continueConversation(
                          openProject.id,
                          conversation.id,
                        )
                      }
                      className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
                    >
                      <MessageSquare className="size-9 text-cyan-300/70" />
                      <span className="w-full truncate text-xs text-cyan-50/85">
                        {conversation.title}
                      </span>
                      <span className="text-[10px] text-cyan-100/30">
                        {new Date(conversation.updatedAt).toLocaleDateString(
                          undefined,
                          { day: "numeric", month: "short", year: "numeric" },
                        )}
                        {` · ${conversation.messageCount} message${conversation.messageCount === 1 ? "" : "s"}`}
                      </span>
                    </button>
                    <div className="project-file-tile-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          await ipc.project.deleteConversation({
                            projectId: openProject.id,
                            conversationId: conversation.id,
                          });
                          await queryClient.invalidateQueries({
                            queryKey: ["project-conversations", openProject.id],
                          });
                        }}
                        aria-label={`Delete ${conversation.title}`}
                        className="rounded p-1 text-white/35 hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <h2 className="system-group-label mb-3">Files</h2>
            <ProjectFiles projectId={openProject.id} />
          </div>
        </div>
      </div>
    );
  }

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

        {/* Projects as folders, opened by clicking one. Actions live on the
            tile and appear on hover, so the page is a place to find a project
            rather than a stack of forms. */}
        <div className="project-file-grid">
          {projects.map((project) => {
            const isActive = project.id === activeId;
            const conversations = conversationsFor(project.id);
            return (
              <div
                key={project.id}
                className={cn(
                  "project-file-tile group",
                  isActive && "project-file-tile--active",
                )}
                data-testid={`project-${project.id}`}
              >
                <button
                  type="button"
                  onClick={() => setFilesOpen(project.id)}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
                  data-testid={`project-open-files-${project.id}`}
                >
                  <FolderKanban
                    className={cn(
                      "size-10",
                      isActive ? "text-cyan-300" : "text-cyan-300/70",
                    )}
                  />
                  <span className="w-full truncate text-sm text-cyan-50/90">
                    {project.name}
                  </span>
                  <span className="w-full truncate text-[10px] text-cyan-100/35">
                    {/* What is actually in it, rather than a description that
                        may be empty. */}
                    {conversations.length > 0
                      ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
                      : project.instructions?.trim()
                        ? "Has instructions"
                        : "Empty"}
                  </span>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-cyan-200">
                      <Check className="size-2.5" />
                      Active
                    </span>
                  )}
                </button>

                <div className="project-file-tile-actions">
                  <button
                    type="button"
                    onClick={() => void openAsChat(project)}
                    aria-label={`Open ${project.name} chat`}
                    title="Open chat"
                    className="rounded p-1 text-white/35 hover:bg-cyan-500/10 hover:text-cyan-100"
                    data-testid={`project-open-${project.id}`}
                  >
                    <MessageSquare className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void setActive(isActive ? null : project)}
                    aria-label={
                      isActive
                        ? `Deactivate ${project.name}`
                        : `Use ${project.name}`
                    }
                    title={isActive ? "Deactivate" : "Use this project"}
                    className="rounded p-1 text-white/35 hover:bg-cyan-500/10 hover:text-cyan-100"
                    data-testid={`project-activate-${project.id}`}
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(project)}
                    aria-label={`Edit ${project.name}`}
                    title="Edit"
                    className="rounded p-1 text-white/35 hover:bg-cyan-500/10 hover:text-cyan-100"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(project)}
                    aria-label={`Delete ${project.name}`}
                    title="Delete"
                    className="rounded p-1 text-white/35 hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
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
