import type { AssistantMessage } from "@earendil-works/pi-ai";

export const MODEL_REFUSAL_WARNING =
  '<dyad-output type="warning" message="Model refused to respond for safety reasons">The model\'s safety system rejected this request. Try switching to a different model.</dyad-output>';

export function isPiModelRefusal(
  failure: Pick<AssistantMessage, "errorMessage">,
): boolean {
  return /content.?filter|safety (system|policy)|refus(ed|al)|policy violation/i.test(
    failure.errorMessage ?? "",
  );
}
