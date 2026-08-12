import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

/**
 * Picks the project in effect, from the composer.
 *
 * The same shape as the knowledge and data source menus beside it: an icon
 * that lights up when something is chosen, a list, and the name shown in the
 * bar. Unlike those, this is a single choice rather than a checklist, because
 * one set of standing instructions is in effect at a time.
 *
 * Selecting here changes the setting the main process reads when it assembles
 * the prompt, so the choice applies from the next message rather than needing
 * a visit to the Projects page.
 */
export function ChatAgentProjectMenu({ disabled }: { disabled?: boolean }) {
  const { settings, updateSettings } = useSettings();
  const activeId = settings?.activeProjectId ?? null;

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => ipc.project.list(),
  });
  const projects = projectsQuery.data ?? [];
  const active = projects.find((project) => project.id === activeId) ?? null;

  const choose = (id: string | null) => {
    void updateSettings({ activeProjectId: id });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "chat-agent-composer-icon-btn",
          active && "chat-agent-composer-icon-btn--active gap-1.5 px-2",
        )}
        aria-label={active ? `Project: ${active.name}` : "Choose a project"}
        title={active ? `Project: ${active.name}` : "Choose a project"}
        data-testid="chat-agent-project-menu"
      >
        <FolderKanban className="size-4" />
        {/* The control says what it has selected, rather than a separate chip
            elsewhere in the bar saying it for them. */}
        {active && (
          <span
            className="max-w-28 truncate text-xs"
            data-testid="chat-agent-project-chip"
          >
            {active.name}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-72 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FolderKanban className="size-4 text-cyan-500" />
          Project
        </DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-5 text-muted-foreground">
          The active project&rsquo;s standing instructions are followed in every
          conversation until you change it.
        </p>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => choose(null)}>
          <span className="min-w-0">
            <span className="block truncate">No project</span>
            <span className="block text-[10px] text-muted-foreground">
              No standing instructions
            </span>
          </span>
        </DropdownMenuItem>

        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => choose(project.id)}
            className={cn(project.id === activeId && "bg-cyan-500/10")}
          >
            <span className="min-w-0">
              <span className="block truncate">{project.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {/* What it will actually do, not just that it exists. */}
                {project.instructions?.trim()
                  ? `${project.instructions.trim().split("\n").length} lines of instructions`
                  : "No instructions yet"}
              </span>
            </span>
          </DropdownMenuItem>
        ))}

        {projects.length === 0 && (
          <div className="px-2 py-3 text-xs leading-5 text-muted-foreground">
            No projects yet. Create one in Projects.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
