import type { TextStreamPart, ToolSet } from "ai";

export const MODEL_REFUSAL_WARNING =
  '<dyad-output type="warning" message="Request declined by the model">The model\'s safety system declined this request. Try rephrasing with more context about your goal, or switch to a different model.</dyad-output>';

export function isModelRefusal(part: TextStreamPart<ToolSet>): boolean {
  return (
    part.type === "finish" &&
    part.finishReason === "content-filter" &&
    part.rawFinishReason === "refusal"
  );
}
