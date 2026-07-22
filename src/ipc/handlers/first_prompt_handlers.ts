import { ipcMain } from "electron";
import log from "electron-log";
import { firstPromptSendContracts } from "../types/first_prompt";
import { assertTrustedRenderer } from "../utils/renderer_security";
import {
  firstPromptCreationRegistry,
  logFirstPromptCreationCleanupFailure,
} from "../services/first_prompt_creation_service";

const logger = log.scope("first_prompt_handlers");

export function registerFirstPromptHandlers(): void {
  ipcMain?.on(
    firstPromptSendContracts.commitCreation.channel,
    (event, input: unknown) => {
      try {
        assertTrustedRenderer(event);
        const parsed =
          firstPromptSendContracts.commitCreation.input.parse(input);
        firstPromptCreationRegistry.commit(parsed.operationId);
      } catch (error) {
        logger.error("Ignoring invalid first-prompt commit", error);
      }
    },
  );

  ipcMain?.on(
    firstPromptSendContracts.cancelCreation.channel,
    (event, input: unknown) => {
      try {
        assertTrustedRenderer(event);
        const parsed =
          firstPromptSendContracts.cancelCreation.input.parse(input);
        void firstPromptCreationRegistry
          .cancel(parsed.operationId)
          .catch((error) =>
            logFirstPromptCreationCleanupFailure(parsed.operationId, error),
          );
      } catch (error) {
        logger.error("Ignoring invalid first-prompt cancellation", error);
      }
    },
  );
}
