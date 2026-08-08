/**
 * The stages shown while an image is being generated.
 *
 * These describe what a generator does, not what this one reports: the API
 * returns a finished image and nothing in between. The stages are paced on
 * elapsed time so the card reads as active work rather than a frozen spinner —
 * and the last one deliberately holds until the image actually arrives, so the
 * UI never claims to have finished something it hasn't.
 */

export type GenerationStage = {
  label: string;
  /** Milliseconds from the start at which this stage begins. */
  startsAtMs: number;
};

export const GENERATION_STAGES: GenerationStage[] = [
  { label: "Analyzing request", startsAtMs: 0 },
  { label: "Building scene", startsAtMs: 1800 },
  { label: "Selecting composition", startsAtMs: 4200 },
  { label: "Generating lighting", startsAtMs: 7000 },
  { label: "Rendering materials", startsAtMs: 10_500 },
  { label: "Enhancing details", startsAtMs: 14_500 },
  { label: "Upscaling", startsAtMs: 19_000 },
  { label: "Finalizing", startsAtMs: 24_000 },
];

/** Reading an attached document through the OCR model. */
export const DOCUMENT_STAGES: GenerationStage[] = [
  { label: "Uploading document", startsAtMs: 0 },
  { label: "Scanning pages", startsAtMs: 1200 },
  { label: "Extracting text", startsAtMs: 3500 },
  { label: "Structuring content", startsAtMs: 8000 },
  { label: "Finishing up", startsAtMs: 15_000 },
];

/** Building the vector index over the Knowledge Base. */
export const INDEXING_STAGES: GenerationStage[] = [
  { label: "Starting vector engine", startsAtMs: 0 },
  { label: "Collecting documents", startsAtMs: 1500 },
  { label: "Reading file contents", startsAtMs: 3500 },
  { label: "Splitting into chunks", startsAtMs: 8000 },
  { label: "Writing embeddings", startsAtMs: 14_000 },
  { label: "Finalising index", startsAtMs: 22_000 },
];

/** Importing chosen files into the vault and making them searchable. */
export const KNOWLEDGE_IMPORT_STAGES: GenerationStage[] = [
  { label: "Uploading documents to vault", startsAtMs: 0 },
  { label: "Indexing documents", startsAtMs: 1 },
];

/** What the assistant is doing before any text comes back. */
export const THINKING_STAGES: GenerationStage[] = [
  { label: "Understanding request", startsAtMs: 0 },
  { label: "Searching memory", startsAtMs: 1500 },
  { label: "Reasoning", startsAtMs: 3800 },
  { label: "Generating response", startsAtMs: 7000 },
];

/**
 * Video runs on a different clock: minutes rather than seconds, and most of it
 * is spent queued on the provider.
 */
export const VIDEO_STAGES: GenerationStage[] = [
  { label: "Submitting to fal", startsAtMs: 0 },
  { label: "Queued", startsAtMs: 4000 },
  { label: "Building scene", startsAtMs: 20_000 },
  { label: "Animating motion", startsAtMs: 50_000 },
  { label: "Rendering frames", startsAtMs: 95_000 },
  { label: "Encoding video", startsAtMs: 165_000 },
  { label: "Finalizing", startsAtMs: 240_000 },
];

/**
 * Index of the stage in progress after `elapsedMs`.
 *
 * Never advances past the final stage: a slow generation should sit on
 * "Finalizing" rather than run out of stages and appear stalled.
 */
export function stageIndexForElapsed(
  elapsedMs: number,
  stages: GenerationStage[] = GENERATION_STAGES,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  let index = 0;
  for (let i = 0; i < stages.length; i += 1) {
    if (elapsedMs >= stages[i].startsAtMs) index = i;
  }
  return index;
}

/** Stages to display: those done, the one running, and the next one ahead. */
export function visibleStages(
  currentIndex: number,
  stages: GenerationStage[] = GENERATION_STAGES,
): {
  stage: GenerationStage;
  index: number;
  state: "done" | "active" | "upcoming";
}[] {
  const first = Math.max(0, currentIndex - 2);
  const last = Math.min(stages.length - 1, currentIndex + 1);

  const rows = [];
  for (let index = first; index <= last; index += 1) {
    rows.push({
      stage: stages[index],
      index,
      state:
        index < currentIndex
          ? ("done" as const)
          : index === currentIndex
            ? ("active" as const)
            : ("upcoming" as const),
    });
  }
  return rows;
}
