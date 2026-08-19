/**
 * The memory step of a chat turn.
 *
 * One entry point, `recallForMessage`, which the chat handler calls before
 * building its prompt. It searches, ranks, trims and formats — and it never
 * throws, because a memory system that can break a conversation is worse than
 * no memory system at all.
 */

import log from "electron-log";

import { readSettings } from "../../main/settings";
import {
  buildMemoryContext,
  dedupeMemories,
  DEFAULT_MEMORY_BUDGET,
  type ContextBudget,
  type RetrievedMemory,
} from "./memory_context";
import { searchMemory } from "./memory_index";
import {
  detectEntities,
  dropOverlapping,
  scoreMemory,
} from "./memory_retrieval";

const logger = log.scope("memory_service");

/** How many candidates to pull before ranking narrows them down. */
const SEARCH_LIMIT = 40;

export type RecallResult = {
  /** The block to place before the user's message, or "" when there is none. */
  context: string;
  /** What was chosen, so the interface can show its working later. */
  used: RetrievedMemory[];
};

const EMPTY: RecallResult = { context: "", used: [] };

/**
 * Retrieves the memory worth showing the model for this message.
 *
 * `destination` decides whether memories marked as never leaving this machine
 * may be included, so a local model can use everything while a cloud model
 * sees only what the user allowed off the device.
 */
export async function recallForMessage(input: {
  message: string;
  destination: "local" | "cloud";
  activeProject?: string | null;
  budget?: ContextBudget;
}): Promise<RecallResult> {
  const vaultPath = readSettings().storage?.localVaultPath?.trim();
  if (!vaultPath) return EMPTY;

  try {
    const candidates = await searchMemory(
      vaultPath,
      input.message,
      SEARCH_LIMIT,
    );
    if (candidates.length === 0) return EMPTY;

    const entities = detectEntities(input.message);
    const now = Date.now();

    // Re-score: similarity alone under-ranks the living project notes that are
    // usually the most useful thing in the vault.
    const ranked = candidates
      .map((candidate) => {
        const extended = candidate as RetrievedMemory & {
          project: string | null;
          person: string | null;
        };
        return {
          ...candidate,
          score: scoreMemory(
            {
              kind: candidate.kind,
              project: extended.project ?? null,
              person: extended.person ?? null,
              content: candidate.content,
              similarity: candidate.score,
              updatedAt: candidate.updatedAt,
            },
            { entities, activeProject: input.activeProject, now },
          ),
        };
      })
      .sort((a, b) => b.score - a.score);

    const trimmed = dropOverlapping(dedupeMemories(ranked));

    const context = buildMemoryContext(trimmed, {
      destination: input.destination,
      budget: input.budget ?? DEFAULT_MEMORY_BUDGET,
    });

    // What actually survived the budget is what the interface should report.
    const used = context
      ? trimmed.filter((memory) => context.includes(memory.content.trim()))
      : [];

    return { context, used };
  } catch (error) {
    // Never let memory take a conversation down with it.
    logger.warn("Memory recall failed; continuing without memory", error);
    return EMPTY;
  }
}
