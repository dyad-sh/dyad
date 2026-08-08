import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import {
  GENERATION_STAGES,
  type GenerationStage,
  stageIndexForElapsed,
  visibleStages,
} from "@/lib/image_generation_stages";
import { cn } from "@/lib/utils";

/**
 * The placeholder shown while an image is being generated.
 *
 * It occupies roughly the space the finished image will take, so the
 * conversation does not jump when the picture lands, and it keeps moving —
 * a static box for twenty seconds reads as a hung request.
 */
export function GeneratingImageCard({
  label = "Generating image",
  stages = GENERATION_STAGES,
  activeStageIndex,
  footnote,
  className,
}: {
  label?: string;
  stages?: GenerationStage[];
  /** Use a real pipeline stage instead of advancing stages by elapsed time. */
  activeStageIndex?: number;
  /** Extra line under the stages, e.g. how long this is expected to take. */
  footnote?: string;
  className?: string;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (activeStageIndex !== undefined) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 400);
    return () => clearInterval(timer);
  }, [activeStageIndex]);

  const currentIndex =
    activeStageIndex === undefined
      ? stageIndexForElapsed(elapsedMs, stages)
      : Math.max(0, Math.min(activeStageIndex, stages.length - 1));
  const rows = visibleStages(currentIndex, stages);
  const activeStage = rows.find((row) => row.state === "active")?.stage;

  return (
    <figure
      className={cn("holo-generating chat-card-fly-in", className)}
      data-testid="generating-image-card"
      aria-live="polite"
      aria-label={`${label}: ${activeStage?.label ?? ""}`}
    >
      <div className="holo-generating-header">
        <span className="holo-generating-title">{label}</span>
        <span className="holo-generating-live">
          <span className="holo-generating-live-dot" aria-hidden />
          In progress
        </span>
      </div>

      <div className="holo-generating-scene" aria-hidden>
        <div className="holo-dot-field">
          <span className="holo-dot-plane holo-dot-plane--a" />
          <span className="holo-dot-plane holo-dot-plane--b" />
          <span className="holo-dot-plane holo-dot-plane--c" />
          <span className="holo-dot-focus" />
        </div>
      </div>

      <figcaption className="holo-generating-status">
        <ol className="holo-stage-list">
          {rows.map((row) => (
            <li
              key={row.index}
              className={cn("holo-stage", `holo-stage--${row.state}`)}
              data-testid={`generation-stage-${row.state}`}
            >
              <span className="holo-stage-marker">
                {row.state === "done" ? (
                  <Check className="size-3" />
                ) : row.state === "active" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="holo-stage-dot" />
                )}
              </span>
              <span className="holo-stage-label">{row.stage.label}</span>
            </li>
          ))}
        </ol>
        {footnote && <p className="holo-stage-footnote">{footnote}</p>}
      </figcaption>
    </figure>
  );
}
