import { createTypedHandler } from "./base";
import { userInputContracts } from "../types/user_input";
import {
  acceptUserInputFollowUp,
  beginUserInputFollowUpExecution,
  prepareUserInputHandoffs,
  rejectUserInputFollowUp,
  rememberUserInputSubscriber,
  retryUserInputFollowUp,
  userInputRegistry,
} from "../../user_input/main";

export function registerUserInputHandlers(): void {
  createTypedHandler(userInputContracts.respond, async (event, input) => {
    rememberUserInputSubscriber(event.sender);
    if (input.response.kind === "follow-up-dispatched") {
      await userInputRegistry.followUpAcknowledged(input.requestId);
    } else {
      await userInputRegistry.respond(input.requestId, input.response);
    }
  });
  createTypedHandler(userInputContracts.getPending, async (event) => {
    rememberUserInputSubscriber(event.sender);
    prepareUserInputHandoffs();
    return userInputRegistry.getPending();
  });
  createTypedHandler(
    userInputContracts.acceptFollowUp,
    async (event, input) => {
      rememberUserInputSubscriber(event.sender);
      acceptUserInputFollowUp(input);
      await userInputRegistry.followUpAccepted(input.requestId);
    },
  );
  createTypedHandler(
    userInputContracts.beginFollowUpExecution,
    async (_event, { requestId }) => {
      beginUserInputFollowUpExecution(requestId);
    },
  );
  createTypedHandler(
    userInputContracts.retryFollowUp,
    async (_event, { requestId, error }) => {
      retryUserInputFollowUp(requestId, error);
      await userInputRegistry.followUpRetryable(requestId);
    },
  );
  createTypedHandler(
    userInputContracts.rejectFollowUp,
    async (_event, { requestId, reason }) => {
      rejectUserInputFollowUp(requestId, reason);
      await userInputRegistry.followUpRejected(requestId);
    },
  );
}
