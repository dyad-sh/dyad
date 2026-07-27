import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatImageGenerationStrip } from "./ChatImageGenerationStrip";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  setDismissed: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => 7,
  useAtom: () => [new Set<string>(), mocks.setDismissed],
}));
vi.mock("@/image_generation/hooks", () => ({
  useChatImageGenerationJobs: () => [
    {
      id: "job-1",
      prompt: "A lighthouse",
      themeMode: "plain",
      targetAppId: 7,
      targetAppName: "App",
      source: "chat",
      startedAt: 1,
      status: "error",
      error: "Provider failed",
      activeInvocationRef: null,
    },
  ],
}));
vi.mock("@/hooks/useGenerateImage", () => ({
  useGenerateImage: () => ({
    start: mocks.start,
    cancel: mocks.cancel,
  }),
}));

describe("ChatImageGenerationStrip", () => {
  beforeEach(() => {
    mocks.start.mockReset();
    mocks.cancel.mockReset();
    mocks.setDismissed.mockReset();
  });

  it("keeps a failed job visible when retry admission is rejected", async () => {
    const admission = deferred<string | null>();
    mocks.start.mockReturnValue(admission.promise);
    render(<ChatImageGenerationStrip onGenerateImage={vi.fn()} />);
    const retry = screen.getByRole("button", { name: "Retry generation" });

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.setDismissed).not.toHaveBeenCalled();
    await act(async () => admission.resolve(null));
    expect(mocks.setDismissed).not.toHaveBeenCalled();
    expect(screen.getByText("Provider failed")).toBeTruthy();
  });

  it("dismisses the failed job only after a replacement is admitted", async () => {
    mocks.start.mockResolvedValue("image-generation-job:replacement");
    render(<ChatImageGenerationStrip onGenerateImage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));

    await act(async () => undefined);
    expect(mocks.setDismissed).toHaveBeenCalledOnce();
  });
});
