import { expect, it } from "vitest";
import { selectPendingToolConsents } from "./selectors";
import type { UserInputReadModelSnapshot } from "./read_model";
it.each(["shell-approval", "shell-review-retry"] as const)(
  "projects %s without conflating verdicts and outages",
  (confirmation) => {
    const snapshot: UserInputReadModelSnapshot = {
      respondingRequestIds: new Set(),
      requests: new Map([
        [
          "request",
          {
            status: "awaiting",
            deadlineAt: null,
            descriptor: {
              kind: "agent-consent",
              requestId: "request",
              chatId: 1,
              deadlineAt: null,
              classifier: "none",
              confirmation,
              toolName: "run_shell",
              toolDescription: "Review reason",
            },
          },
        ],
      ]),
    };
    const [consent] = selectPendingToolConsents(snapshot, 1);
    expect(consent.toolDescription).toBe("Review reason");
    expect(consent.classifierReason).toBe(
      confirmation === "shell-approval" ? "Review reason" : undefined,
    );
  },
);
