import type { IgnoreReason, TransitionResult } from "./types";

export function describeTransitionValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function transitionValuesAreEqual(
  left: unknown,
  right: unknown,
): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        transitionValuesAreEqual(value, right[index]),
      )
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        transitionValuesAreEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function validationFailure(
  message: string,
  context: {
    state: unknown;
    event: unknown;
    result: unknown;
    path: readonly unknown[];
  },
): never {
  throw new Error(
    `${message}\nSource state: ${describeTransitionValue(context.state)}\nEvent: ${describeTransitionValue(context.event)}\nResult: ${describeTransitionValue(context.result)}\nExplored path: ${describeTransitionValue(context.path)}`,
  );
}

/**
 * Enforces the runtime contract at the pure transition boundary.
 *
 * Dispatchers report failures as programming errors and reject the invalid
 * transaction before reservation or commit.
 */
export function validateTransitionResult<
  State,
  Event,
  Command,
  Reason extends IgnoreReason,
>(
  previous: State,
  event: Event,
  result: TransitionResult<State, Command, Reason>,
  path: readonly Event[] = [],
): void {
  const context = { state: previous, event, result, path };
  if (typeof result !== "object" || result === null) {
    validationFailure("Transition did not return a valid result", context);
  }
  if (!("state" in result)) {
    validationFailure("Transition result must include a state", context);
  }
  if (result.kind === "ignored") {
    if (result.state !== previous) {
      validationFailure(
        "Ignored transitions must retain the exact state reference",
        context,
      );
    }
    if (!("reason" in result) || typeof result.reason !== "string") {
      validationFailure("Ignored transitions must include a reason", context);
    }
    if ("commands" in result) {
      validationFailure("Ignored transitions must not emit commands", context);
    }
    return;
  }
  if (result.kind !== "applied" || !Array.isArray(result.commands)) {
    validationFailure("Transition did not return a valid result", context);
  }
  if (
    transitionValuesAreEqual(previous, result.state) &&
    previous !== result.state
  ) {
    validationFailure(
      "Applied value-equal states must reuse the previous reference",
      context,
    );
  }
}
