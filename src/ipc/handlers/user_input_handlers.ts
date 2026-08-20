import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { userInputContracts } from "../types/user_input";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "../../user_input/main";
import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import { DyadError, DyadErrorKind } from "../../errors/dyad_error";

async function respondToIntegrationSkip(requestId: string): Promise<void> {
  const response = {
    kind: "integration" as const,
    provider: null,
    completed: false as const,
  };
  const pending = userInputRegistry
    .getPending()
    .find((entry) => entry.descriptor.requestId === requestId);
  if (!pending || pending.descriptor.kind !== "integration") {
    await userInputRegistry.respond(requestId, response);
    return;
  }

  const [chat] = await db
    .select({ appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, pending.descriptor.chatId))
    .limit(1);
  if (!chat) {
    throw new DyadError("Chat not found", DyadErrorKind.NotFound);
  }

  await appOperationCoordinator.run(
    {
      appId: chat.appId,
      operation: "skip-database-integration",
      resources: [readAppResource("provider")],
    },
    async () => {
      const [app] = await db
        .select({
          supabaseProjectId: apps.supabaseProjectId,
          neonProjectId: apps.neonProjectId,
        })
        .from(apps)
        .where(eq(apps.id, chat.appId))
        .limit(1);
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }
      if (app.supabaseProjectId || app.neonProjectId) {
        throw new DyadError(
          "A database integration finished connecting before Skip could be applied.",
          DyadErrorKind.Conflict,
        );
      }
      await userInputRegistry.respond(requestId, response);
    },
  );
}

export function registerUserInputHandlers(): void {
  createTypedHandler(userInputContracts.respond, async (event, input) => {
    rememberUserInputSubscriber(event.sender);
    if (input.response.kind === "follow-up-dispatched") {
      await userInputRegistry.followUpDispatched(input.requestId);
    } else if (
      input.response.kind === "integration" &&
      !input.response.completed &&
      input.response.provider === null
    ) {
      await respondToIntegrationSkip(input.requestId);
    } else {
      await userInputRegistry.respond(input.requestId, input.response);
    }
  });
  createTypedHandler(userInputContracts.getPending, async (event) => {
    rememberUserInputSubscriber(event.sender);
    return userInputRegistry.getPending();
  });
  createTypedHandler(
    userInputContracts.rejectFollowUp,
    async (_event, { requestId }) => {
      await userInputRegistry.followUpRejected(requestId);
    },
  );
}
