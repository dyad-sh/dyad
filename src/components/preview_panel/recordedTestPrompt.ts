import type { RecordedAction } from "@/ipc/types/tests";

/** Human-readable one-line summary of an action's target element. */
function describeTarget(action: RecordedAction): string {
  const s = action.selector;
  if (!s) return "an element";
  if (s.role && s.name) return `the ${s.role} "${s.name}"`;
  if (s.name) return `"${s.name}"`;
  if (s.label) return `the field labeled "${s.label}"`;
  if (s.placeholder) return `the field with placeholder "${s.placeholder}"`;
  if (s.testId) return `the element with test id "${s.testId}"`;
  if (s.text) return `the element with text "${s.text}"`;
  if (s.dyadName) return `the <${s.dyadName}> component`;
  if (s.role) return `the ${s.role}`;
  return `the <${s.tag ?? "element"}>`;
}

function describeAction(action: RecordedAction): string {
  const target = describeTarget(action);
  switch (action.kind) {
    case "click":
      return `Click ${target}.`;
    case "fill":
      return `Fill ${target} with "${action.value ?? ""}".`;
    case "select":
      return `Select "${action.value ?? ""}" in ${target}.`;
    case "check":
      return `${action.value === "false" ? "Uncheck" : "Check"} ${target}.`;
    case "press":
      return `Press "${action.value ?? "Enter"}" in ${target}.`;
    case "navigate":
      return `Navigate to ${action.url ?? "a new page"}.`;
    default:
      return `Interact with ${target}.`;
  }
}

/** Compact JSON of the selector hints, so the AI can pick the best locator. */
function selectorHints(action: RecordedAction): string {
  if (!action.selector) return "";
  const entries = Object.entries(action.selector).filter(
    ([, v]) => v != null && v !== "",
  );
  if (entries.length === 0) return "";
  return ` (locator hints: ${JSON.stringify(Object.fromEntries(entries))})`;
}

/**
 * Build the chat prompt that is auto-sent when the user stops recording a flow
 * in the preview. The recording is actions-only; the prompt asks the AI to
 * write a Playwright test and add the assertions itself.
 */
export function buildRecordedTestPrompt(actions: RecordedAction[]): string {
  const steps = actions
    .map((a, i) => `${i + 1}. ${describeAction(a)}${selectorHints(a)}`)
    .join("\n");

  return [
    "I recorded a flow by interacting with my app's preview. Please turn it into a Playwright end-to-end test.",
    "",
    "Recorded flow (these are the ACTIONS I took — you decide the assertions):",
    steps,
    "",
    "Write a single focused test under `tests/` that reproduces these actions and then asserts the outcome the flow was demonstrating. Add meaningful `await expect(...)` assertions — the recording does not include any. Prefer role/text-based locators using the hints above.",
  ].join("\n");
}
