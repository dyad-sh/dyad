import { useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Eye,
  Images,
  Layers3,
  Palette,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";

type CanvaPresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "canva-designs" }
>;

export type CanvaCandidateSelection = {
  jobId: string;
  candidateId: string;
  conceptNumber: number;
};

function openUrl(url: string) {
  void ipc.system.openExternalUrl(url);
}

function DesignThumbnail({
  title,
  thumbnailUrl,
}: {
  title: string;
  thumbnailUrl?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (thumbnailUrl && !failed) {
    return (
      <img
        src={thumbnailUrl}
        alt={`${title} preview`}
        loading="lazy"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="grid size-full place-items-center bg-gradient-to-br from-cyan-400/15 via-fuchsia-500/12 to-violet-500/18 text-primary">
      <Images className="size-9 opacity-70" />
    </div>
  );
}

export function ChatAgentCanvaDesignCards({
  presentation,
  onSelectCandidate,
  onRetryGeneration,
  selectionDisabled = false,
}: {
  presentation: CanvaPresentation;
  onSelectCandidate?: (selection: CanvaCandidateSelection) => void;
  onRetryGeneration?: () => void;
  selectionDisabled?: boolean;
}) {
  if (presentation.status === "failed") {
    const isQuotaFailure = presentation.errorCode === "quota_exceeded";
    const isTerminalFailure = [
      "quota_exceeded",
      "authentication_required",
      "forbidden",
    ].includes(presentation.errorCode ?? "");
    const retriesPaused = presentation.retryable === false;
    const canRetry = !isTerminalFailure && !retriesPaused;
    return (
      <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-amber-400/25 bg-card/92 shadow-[0_18px_60px_-32px_rgba(251,191,36,0.35)]">
        <div className="flex items-start gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400/12 text-amber-400">
            <AlertCircle className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                {isQuotaFailure
                  ? "Canva generation quota reached"
                  : "Canva couldn’t finish this design"}
              </h3>
              <span className="shrink-0 rounded-full border border-amber-400/20 bg-amber-400/8 px-2.5 py-1 text-[10px] font-medium text-amber-500">
                Canva
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isQuotaFailure
                ? "Your Canva account has no generation quota remaining. Check your Canva plan or wait for the quota to reset."
                : retriesPaused
                  ? "Canva rejected both generation attempts. Further retries are paused to avoid consuming more generation credits."
                  : "Canva’s generator stopped before producing concepts. Retry with a smaller brief that keeps your topic, audience and page count."}
            </p>
            {presentation.errorMessage && (
              <p className="mt-2 rounded-lg bg-amber-400/7 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                {presentation.errorMessage}
              </p>
            )}
            {(presentation.errorCode || presentation.jobId) && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
                {presentation.errorCode && (
                  <span>Error: {presentation.errorCode}</span>
                )}
                {presentation.jobId && <span>Job: {presentation.jobId}</span>}
              </div>
            )}
            {!canRetry ? (
              <Button
                type="button"
                size="sm"
                className="mt-3 h-8"
                onClick={() => openUrl("https://www.canva.com/")}
              >
                Open Canva <ArrowUpRight className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="mt-3 h-8"
                disabled={selectionDisabled || !onRetryGeneration}
                onClick={onRetryGeneration}
              >
                <RefreshCw className="size-3.5" /> Retry simpler brief
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  const isConceptPicker =
    presentation.designs.some((design) => design.candidate) &&
    Boolean(presentation.jobId);

  return (
    <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 bg-card/92 shadow-[0_18px_60px_-32px_rgba(34,211,238,0.45)]">
      <header className="border-b border-border/60 bg-gradient-to-r from-cyan-400/8 via-violet-500/7 to-fuchsia-500/8 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-fuchsia-500/20 text-primary shadow-inner">
              {isConceptPicker ? (
                <Sparkles className="size-4.5" />
              ) : (
                <Check className="size-4.5" />
              )}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {isConceptPicker
                  ? "Your Canva concepts are ready"
                  : "Your Canva design is ready"}
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {isConceptPicker
                  ? "Choose the direction you like and I’ll turn it into a fully editable Canva design."
                  : "Open it in Canva to review, refine and share."}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-cyan-400/20 bg-cyan-400/8 px-2.5 py-1 text-[10px] font-medium text-cyan-200/80">
            Canva
          </span>
        </div>
      </header>

      <div className="grid gap-3 p-3 md:grid-cols-2">
        {presentation.designs.map((design, index) => {
          const openUrlValue = design.editUrl ?? design.viewUrl;
          const conceptNumber = index + 1;
          const humanTitle = design.candidate
            ? `Concept ${conceptNumber}`
            : design.title;
          return (
            <article
              key={`${presentation.toolName}-${design.id}`}
              className="group min-w-0 overflow-hidden rounded-xl border border-border/65 bg-background/55 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
            >
              <button
                type="button"
                className="relative block aspect-video w-full overflow-hidden border-b border-border/60 text-left disabled:cursor-default"
                disabled={!openUrlValue}
                onClick={() => openUrlValue && openUrl(openUrlValue)}
                aria-label={
                  openUrlValue
                    ? `Preview ${humanTitle} in Canva`
                    : `${humanTitle} preview`
                }
              >
                <DesignThumbnail
                  title={humanTitle}
                  thumbnailUrl={design.thumbnailUrl}
                />
                {openUrlValue && !design.candidate && (
                  <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/65 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
                    Open in Canva <ArrowUpRight className="size-3" />
                  </span>
                )}
              </button>
              <div className="p-3.5">
                <h4 className="truncate text-sm font-semibold text-foreground">
                  {humanTitle}
                </h4>
                {design.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {design.description}
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  {design.pageCount !== undefined && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                      <Layers3 className="size-3" /> {design.pageCount}{" "}
                      {design.pageCount === 1 ? "page" : "pages"}
                    </span>
                  )}
                  {design.designType && (
                    <span className="rounded-full bg-muted px-2 py-1">
                      {design.designType}
                    </span>
                  )}
                </div>

                {design.candidate && presentation.jobId ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 flex-1"
                      disabled={selectionDisabled || !onSelectCandidate}
                      onClick={() =>
                        onSelectCandidate?.({
                          jobId: presentation.jobId!,
                          candidateId: design.id,
                          conceptNumber,
                        })
                      }
                    >
                      <Sparkles className="size-3.5" /> Choose this design
                    </Button>
                    {openUrlValue && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        aria-label={`Preview ${humanTitle} in Canva`}
                        onClick={() => openUrl(openUrlValue)}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ) : openUrlValue ? (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 h-8 w-full"
                    onClick={() => openUrl(openUrlValue)}
                  >
                    <Palette className="size-3.5" /> Edit in Canva
                    <ArrowUpRight className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
