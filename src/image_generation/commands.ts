import type { QueryClient } from "@tanstack/react-query";
import { DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { ImageGenerationCommandRunner } from "./controller";

export function createImageGenerationCommandRunner(options: {
  queryClient: QueryClient;
}): ImageGenerationCommandRunner {
  return {
    run(command, emit) {
      switch (command.type) {
        case "GenerateImage":
          void ipc.imageGeneration
            .generateImage({
              requestId: command.jobId,
              prompt: command.params.prompt,
              themeMode: command.params.themeMode,
              targetAppId: command.params.targetAppId,
            })
            .then(
              (result) => emit({ type: "JOB_SUCCEEDED", result }),
              (error) =>
                emit({
                  type: "JOB_FAILED",
                  message:
                    error instanceof Error ? error.message : String(error),
                  kind:
                    isDyadError(error) &&
                    error.kind === DyadErrorKind.UserCancelled
                      ? "user_cancelled"
                      : "other",
                }),
            );
          return;

        case "RequestCancel":
          void ipc.imageGeneration
            .cancelImageGeneration({ requestId: command.jobId })
            .then(
              ({ cancelled }) => emit({ type: "CANCEL_CONFIRMED", cancelled }),
              () => emit({ type: "CANCEL_CONFIRMED", cancelled: false }),
            );
          return;

        case "InvalidateMediaQueries":
          void options.queryClient.invalidateQueries({
            queryKey: queryKeys.media.all,
          });
          return;

        default:
          return assertNever(command);
      }
    },
  };
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected image-generation command: ${JSON.stringify(value)}`,
  );
}
