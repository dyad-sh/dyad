import { describe, expect, it, vi } from "vitest";
import type { ImageGenerationActorState } from "@/image_generation/state";
import { WindowRegistry } from "@/window_infrastructure/main/window_registry";
import { WindowSessionIdSchema } from "@/window_infrastructure/types";
import { ImageGenerationPresentationService } from "./image_generation_presentation_service";

function setup() {
  const windows = new WindowRegistry();
  const first = { id: 1, isDestroyed: () => false, send: vi.fn() };
  const second = { id: 2, isDestroyed: () => false, send: vi.fn() };
  const firstSession = WindowSessionIdSchema.parse(
    "00000000-0000-4000-8000-000000000001",
  );
  const secondSession = WindowSessionIdSchema.parse(
    "00000000-0000-4000-8000-000000000002",
  );
  windows.register(first, firstSession);
  windows.register(second, secondSession);
  windows.setVisibleEntities(firstSession, [{ kind: "app", id: 7 }]);
  windows.setVisibleEntities(secondSession, [{ kind: "app", id: 7 }]);
  return {
    first,
    firstSession,
    second,
    secondSession,
    service: new ImageGenerationPresentationService(windows),
    windows,
  };
}

function pendingState(): ImageGenerationActorState {
  return {
    jobs: ["job-1", "job-2"].map((id) => ({
      job: {
        id,
        prompt: id,
        themeMode: "plain",
        targetAppId: 7,
        targetAppName: "App",
        startedAt: 1,
        status: "pending",
      },
      activeInvocationRef: {
        kind: "image-generation",
        entityKey: id,
        operationId: `operation-${id}`,
      },
    })),
  };
}

describe("ImageGenerationPresentationService", () => {
  it("routes each operation to its initiator and counts that window's jobs", () => {
    const { first, firstSession, second, secondSession, service } = setup();
    const state = pendingState();
    service.recordInitiator("job-1", firstSession);
    service.recordInitiator("job-2", secondSession);

    service.present(state, "job-1");
    service.present(state, "job-2");

    expect(first.send).toHaveBeenCalledWith("image-generation:presentation", {
      type: "progress",
      pendingCount: 1,
    });
    expect(second.send).toHaveBeenCalledWith("image-generation:presentation", {
      type: "progress",
      pendingCount: 1,
    });
  });

  it("falls back to another visible window after the initiator closes", () => {
    const { first, firstSession, second, secondSession, service, windows } =
      setup();
    const state = pendingState();
    service.recordInitiator("job-1", firstSession);
    windows.setFocused(secondSession);
    windows.unregister(first.id);

    service.present(state, "job-1");

    expect(second.send).toHaveBeenCalledWith("image-generation:presentation", {
      type: "progress",
      pendingCount: 2,
    });
  });

  it("omits the absolute path from success presentation", () => {
    const { first, firstSession, service } = setup();
    const state: ImageGenerationActorState = {
      jobs: [
        {
          job: {
            id: "job-1",
            prompt: "A lighthouse",
            themeMode: "plain",
            targetAppId: 7,
            targetAppName: "App",
            startedAt: 1,
            status: "success",
            result: {
              fileName: "generated.png",
              filePath: "/private/app/.dyad/media/generated.png",
              appPath: "app",
              appId: 7,
              appName: "App",
            },
          },
          activeInvocationRef: null,
        },
      ],
    };
    service.recordInitiator("job-1", firstSession);

    service.present(state, "job-1");

    expect(first.send).toHaveBeenCalledWith("image-generation:presentation", {
      type: "succeeded",
      result: {
        fileName: "generated.png",
        appPath: "app",
        appId: 7,
        appName: "App",
      },
      pendingCount: 0,
    });
  });

  it("dismisses a deleted app's progress before forgetting its route", () => {
    const { first, firstSession, service } = setup();
    const state: ImageGenerationActorState = {
      jobs: [
        ...pendingState().jobs,
        {
          job: {
            id: "job-3",
            prompt: "Another app",
            themeMode: "plain",
            targetAppId: 8,
            targetAppName: "Other App",
            startedAt: 1,
            status: "pending",
          },
          activeInvocationRef: {
            kind: "image-generation",
            entityKey: "job-3",
            operationId: "operation-job-3",
          },
        },
      ],
    };
    service.recordInitiator("job-1", firstSession);
    service.recordInitiator("job-2", firstSession);
    service.recordInitiator("job-3", firstSession);
    service.forgetApp(7, state);

    expect(first.send).toHaveBeenCalledTimes(1);
    expect(first.send).toHaveBeenCalledWith("image-generation:presentation", {
      type: "progress",
      pendingCount: 1,
    });
  });
});
