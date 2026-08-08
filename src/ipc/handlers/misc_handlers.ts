import { createTypedHandler } from "./base";
import { miscContracts } from "../types/misc";
import { notifyRendererErrorToastListenerReady } from "@/main/settings";

export function registerMiscHandlers() {
  createTypedHandler(miscContracts.rendererErrorToastReady, async (event) => {
    notifyRendererErrorToastListenerReady(event.sender);
  });
}
