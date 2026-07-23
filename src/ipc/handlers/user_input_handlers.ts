import { createTypedHandler } from "./base";
import { userInputContracts } from "../types/user_input";
import {
  rememberUserInputSubscriber,
  userInputRegistry,
} from "../../user_input/main";

export function registerUserInputHandlers(): void {
  createTypedHandler(userInputContracts.respond, async (event, input) => {
    rememberUserInputSubscriber(event.sender);
    if (input.response.kind === "follow-up-dispatched") {
      await userInputRegistry.followUpDispatched(input.requestId);
    } else {
      await userInputRegistry.respond(input.requestId, input.response);
    }
  });
  createTypedHandler(userInputContracts.getPending, async (event) => {
    rememberUserInputSubscriber(event.sender);
    return userInputRegistry.getPending();
  });
}
