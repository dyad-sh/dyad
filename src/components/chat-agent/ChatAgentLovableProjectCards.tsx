import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  Globe2,
  ImageIcon,
  LockKeyhole,
  MonitorPlay,
  Sparkles,
} from "lucide-react";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ipc } from "@/ipc/types";

type LovablePresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "lovable-projects" }
>;

function openUrl(url: string) {
  void ipc.system.openExternalUrl(url);
}

function formatDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function ProjectThumbnail({
  name,
  screenshotUrl,
}: {
  name: string;
  screenshotUrl?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  if (screenshotUrl && !imageFailed) {
    return (
      <img
        src={screenshotUrl}
        alt={`${name} preview`}
        loading="lazy"
        className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className="relative size-full overflow-hidden bg-gradient-to-br from-primary/18 via-background to-violet-500/12">
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:24px_24px] text-primary/20" />
      <div className="absolute inset-x-[10%] top-[13%] bottom-[12%] overflow-hidden rounded-lg border border-border/80 bg-background/90 shadow-lg">
        <div className="flex h-7 items-center gap-1.5 border-b border-border/70 px-2.5">
          <span className="size-1.5 rounded-full bg-rose-400" />
          <span className="size-1.5 rounded-full bg-amber-400" />
          <span className="size-1.5 rounded-full bg-emerald-400" />
          <span className="ml-2 h-1.5 w-1/3 rounded-full bg-muted" />
        </div>
        <div className="space-y-2.5 p-4">
          <div className="h-2.5 w-2/3 rounded-full bg-foreground/55" />
          <div className="h-1.5 w-full rounded-full bg-muted-foreground/18" />
          <div className="h-1.5 w-4/5 rounded-full bg-muted-foreground/12" />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <span className="aspect-square rounded-md bg-primary/10" />
            <span className="aspect-square rounded-md bg-violet-500/10" />
            <span className="aspect-square rounded-md bg-primary/8" />
          </div>
        </div>
      </div>
      <span className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg border border-border/70 bg-background/75 text-primary backdrop-blur">
        <ImageIcon className="size-3.5" />
      </span>
    </div>
  );
}

function statusLabel(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function ChatAgentLovableProjectCards({
  presentation,
}: {
  presentation: LovablePresentation;
}) {
  return (
    <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/92 shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary/16 to-violet-500/14 text-primary">
            <Sparkles className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {presentation.heading}
            </h3>
            <p className="text-xs text-muted-foreground">
              Live from Lovable MCP
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border/70 bg-muted/55 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
          {presentation.projects.length}{" "}
          {presentation.projects.length === 1 ? "project" : "projects"}
        </span>
      </header>

      <div className="grid gap-3 p-3 md:grid-cols-2">
        {presentation.projects.map((project) => {
          const primaryUrl =
            project.previewUrl ?? project.publishedUrl ?? project.editorUrl;
          return (
            <article
              key={`${presentation.toolName}-${project.id}`}
              className="group min-w-0 overflow-hidden rounded-xl border border-border/65 bg-background/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
            >
              <button
                type="button"
                className="relative block aspect-video w-full overflow-hidden border-b border-border/60 text-left disabled:cursor-default"
                disabled={!primaryUrl}
                onClick={() => primaryUrl && openUrl(primaryUrl)}
                aria-label={
                  primaryUrl
                    ? `Open ${project.name} preview`
                    : `${project.name} preview unavailable`
                }
              >
                <ProjectThumbnail
                  name={project.name}
                  screenshotUrl={project.screenshotUrl}
                />
                {primaryUrl && (
                  <span className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-medium text-white backdrop-blur transition-colors group-hover:bg-black/78">
                    Open <ArrowUpRight className="size-3" />
                  </span>
                )}
              </button>

              <div className="p-3.5">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-foreground">
                      {project.name}
                    </h4>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {project.workspace
                        ? `${project.workspace} · ${project.id}`
                        : project.id}
                    </p>
                  </div>
                  {project.status && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2 py-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-3" />
                      {statusLabel(project.status)}
                    </span>
                  )}
                </div>

                {project.description &&
                  project.description !== project.name && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {project.description}
                    </p>
                  )}

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {project.visibility && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      <LockKeyhole className="size-3" />
                      {statusLabel(project.visibility)}
                    </span>
                  )}
                  {project.updatedAt && (
                    <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      Updated {formatDate(project.updatedAt)}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 border-t border-border/55 pt-3">
                  {project.previewUrl && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                      onClick={() => openUrl(project.previewUrl!)}
                    >
                      <MonitorPlay className="size-3.5" />
                      Preview
                    </button>
                  )}
                  {project.publishedUrl && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                      onClick={() => openUrl(project.publishedUrl!)}
                    >
                      <Globe2 className="size-3.5" />
                      Live site
                    </button>
                  )}
                  {project.editorUrl && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                      onClick={() => openUrl(project.editorUrl!)}
                    >
                      <Code2 className="size-3.5" />
                      Edit
                      <ExternalLink className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
