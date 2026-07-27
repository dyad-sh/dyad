import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageGenerationPresentationEvent } from "@/ipc/types/image_generation";
import { ImageGenerationProvider } from "./ImageGenerationProvider";

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  generating: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  listener: undefined as
    | ((event: ImageGenerationPresentationEvent) => void)
    | undefined,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      imageGeneration: {
        onPresentation: (
          listener: (event: ImageGenerationPresentationEvent) => void,
        ) => {
          mocks.listener = listener;
          return () => {
            mocks.listener = undefined;
          };
        },
      },
    },
  },
}));
vi.mock("@/components/ImageGenerationToast", () => ({
  dismissImageGenerationToast: mocks.dismiss,
  showImageGeneratingToast: mocks.generating,
  showImageSuccessToast: mocks.success,
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.error }));

describe("ImageGenerationProvider", () => {
  it("renders targeted presentation events without owning job authority", () => {
    const view = render(
      <ImageGenerationProvider>
        <div />
      </ImageGenerationProvider>,
    );

    mocks.listener?.({ type: "progress", pendingCount: 2 });
    expect(mocks.generating).toHaveBeenCalledWith(2);

    const result = {
      fileName: "generated.png",
      appId: 1,
      appName: "App",
    };
    mocks.listener?.({ type: "succeeded", result, pendingCount: 1 });
    expect(mocks.success).toHaveBeenCalledWith(result, expect.any(Function));

    mocks.listener?.({
      type: "failed",
      message: "Provider failed",
      pendingCount: 0,
    });
    expect(mocks.error).toHaveBeenCalledWith("Provider failed");
    expect(mocks.dismiss).toHaveBeenCalled();

    view.unmount();
    expect(mocks.listener).toBeUndefined();
  });
});
