import type { DeepLinkWindowReadinessCommand } from "./state";

export interface ReadinessQueue {
  markReady(): void;
  markNotReady(): void;
}

export function runDeepLinkWindowReadinessCommand(
  queue: ReadinessQueue,
  command: DeepLinkWindowReadinessCommand,
): void {
  switch (command.type) {
    case "MarkQueueReady":
      queue.markReady();
      return;
    case "MarkQueueNotReady":
      queue.markNotReady();
      return;
    default:
      assertNever(command);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled deep-link window readiness command: ${String(value)}`,
  );
}
