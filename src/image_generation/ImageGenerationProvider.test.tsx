import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { ImageGenerationEvent } from "./state";
import { ImageGenerationManager } from "./manager";
import { ImageGenerationProvider } from "./ImageGenerationProvider";
import { useImageGenerationJobs } from "./hooks";

vi.mock("@/components/ImageGenerationToast", () => ({
  dismissImageGenerationToast: vi.fn(),
  showImageGeneratingToast: vi.fn(),
  showImageSuccessToast: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

function ProjectionProbe() {
  const jobs = useImageGenerationJobs();
  return <div data-testid="jobs-snapshot">{jobs[0]?.status ?? "empty"}</div>;
}

describe("ImageGenerationProvider", () => {
  it("publishes manager job snapshots directly to renderer readers", async () => {
    let generationEmit: ((event: ImageGenerationEvent) => void) | undefined;
    const manager = new ImageGenerationManager({
      clock: createFakeClock(10),
      idSource: createSequentialIdSource(),
      runner: {
        run(command, emit) {
          if (command.type === "GenerateImage") generationEmit = emit;
        },
      },
    });
    const view = render(
      <ImageGenerationProvider manager={manager}>
        <ProjectionProbe />
      </ImageGenerationProvider>,
    );

    act(() => {
      manager.submit({
        prompt: "A lighthouse",
        themeMode: "plain",
        targetAppId: 1,
        targetAppName: "App",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("jobs-snapshot").textContent).toBe("pending"),
    );

    act(() => {
      generationEmit?.({
        type: "JOB_SUCCEEDED",
        result: {
          fileName: "generated.png",
          filePath: "/tmp/generated.png",
          appPath: "app",
          appId: 1,
          appName: "App",
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("jobs-snapshot").textContent).toBe("success"),
    );
    expect(manager.getJobsSnapshot()).toHaveLength(1);

    view.unmount();
    await waitFor(() =>
      expect(() =>
        manager.submit({
          prompt: "disposed",
          themeMode: "plain",
          targetAppId: 1,
          targetAppName: "App",
        }),
      ).toThrow("disposed"),
    );
  });
});
