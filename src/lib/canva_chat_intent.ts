type ChatTurn = { role: "user" | "assistant"; content: string };

const CANVA_ACTION =
  /\b(?:create|make|design|generate|build|produce|find|search|show|open|copy|duplicate|edit|update|change|resize|export|download)\b/i;
const VISUAL_ARTIFACT =
  /\b(?:presentation|slide(?:show| deck|s)?|pitch deck|deck|poster|flyer|brochure|social (?:post|graphic)|infographic|design|template)\b/i;
const CLARIFICATION_REQUEST =
  /\b(?:tell me|which|what (?:audience|style|tone|format)|target audience|audience|style|tone|vibe|how long|duration|mix|bulk|cut|technical|simple)\b/i;
const REFINEMENT_DETAIL =
  /\b(?:audience|member|members|body\s*builder|body\s*builders|bodybuilding|power\s*lifter|power\s*lifters|lifting|beginner|advanced|hardcore|technical|simple|minute|minutes|brand|colour|color|dark|light|professional|playful|bulk|cut|season|slide|slides|page|pages)\b/i;
const NON_ACTIONABLE_REPLY =
  /^(?:thanks?|thank you|ok(?:ay)?|great|perfect|sounds good|never ?mind|cancel|stop)[.!\s]*$/i;

export type CanvaDesignAction = "generate" | "search" | "edit" | "export";

function directCanvaAction(content: string): CanvaDesignAction | null {
  if (!CANVA_ACTION.test(content)) return null;
  if (!/\bcanva\b/i.test(content) && !VISUAL_ARTIFACT.test(content)) {
    return null;
  }
  if (/\b(?:export|download)\b/i.test(content)) return "export";
  if (/\b(?:find|search|show|open)\b/i.test(content)) return "search";
  if (/\b(?:edit|update|change|resize)\b/i.test(content)) return "edit";
  return "generate";
}

function isDesignClarificationReply(
  turns: ChatTurn[],
  latestUserIndex: number,
) {
  const latest = turns[latestUserIndex]?.content.trim() ?? "";
  if (
    !latest ||
    latest.length > 240 ||
    NON_ACTIONABLE_REPLY.test(latest) ||
    latest.includes("?")
  ) {
    return false;
  }

  const previousAssistant = turns
    .slice(0, latestUserIndex)
    .reverse()
    .find((turn) => turn.role === "assistant")?.content;

  return (
    REFINEMENT_DETAIL.test(latest) ||
    Boolean(previousAssistant && CLARIFICATION_REQUEST.test(previousAssistant))
  );
}

export function inferCanvaDesignAction(
  turns: ChatTurn[],
): CanvaDesignAction | null {
  let latestUserIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return null;

  const latestUser = turns[latestUserIndex].content.trim();
  const directAction = directCanvaAction(latestUser);
  if (directAction) return directAction;

  // Presentation briefs are often refined over several turns. A reply such
  // as "hardcore bodybuilders, about 10 minutes" is still part of the active
  // creation request even though it does not repeat "create a presentation".
  // Inherit only through a short clarification answer so ordinary later chat
  // does not unexpectedly reopen Canva.
  if (!isDesignClarificationReply(turns, latestUserIndex)) return null;

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    if (turns[index].role !== "user") continue;
    const inheritedAction = directCanvaAction(turns[index].content.trim());
    if (inheritedAction) return inheritedAction;
  }
  return null;
}

/**
 * Detects requests that should go straight to a connected Canva account.
 * Keep this deliberately narrow: merely discussing Canva must remain normal
 * chat, while an explicit design action or presentation creation is routed.
 */
export function inferCanvaDesignIntent(turns: ChatTurn[]) {
  return inferCanvaDesignAction(turns) !== null;
}

export function isCanvaCandidateSelection(turns: ChatTurn[]) {
  const latestUser = [...turns]
    .reverse()
    .find((turn) => turn.role === "user")
    ?.content.trim();
  if (!latestUser) return false;
  return (
    /\b(?:use|choose|select|pick|create|make)\b/i.test(latestUser) &&
    /\b(?:option|candidate|design|first|second|third|fourth|1st|2nd|3rd|4th|one|two|three|four|#?\d+)\b/i.test(
      latestUser,
    )
  );
}
