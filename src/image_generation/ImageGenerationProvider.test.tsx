import { act, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { imageGenerationJobsAtom } from "@/atoms/imageGenerationAtoms";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { ImageGenerationEvent } from "./state";
import { ImageGenerationManager } from "./manager";
import { ImageGenerationProvider } from "./ImageGenerationProvider";

vi.mock("@/components/ImageGenerationToast", () => ({
  dismissImageGenerationToast: vi.fn(),
  showImageGeneratingToast: vi.fn(),
  showImageSuccessToast: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

function ProjectionProbe() {
  const jobs = useAtomValue(imageGenerationJobsAtom);
  return <div data-testid="projection">{jobs[0]?.status ?? "empty"}</div>;
}

describe("ImageGenerationProvider", () => {
  it("is the single bridge from manager snapshots into the Jotai projection", async () => {
    const store = createStore();
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
      <Provider store={store}>
        <ImageGenerationProvider manager={manager}>
          <ProjectionProbe />
        </ImageGenerationProvider>
      </Provider>,
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
      expect(screen.getByTestId("projection").textContent).toBe("pending"),
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
      expect(screen.getByTestId("projection").textContent).toBe("success"),
    );
    expect(store.get(imageGenerationJobsAtom)).toHaveLength(1);

    view.unmount();
    expect(store.get(imageGenerationJobsAtom)).toEqual([]);
  });
});
