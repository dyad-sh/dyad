import { Provider, createStore } from "jotai";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { DyadStepLimit } from "./DyadStepLimit";

const streamChatMocks = vi.hoisted(() => ({
  streamMessage: vi.fn(),
  clearPauseOnly: vi.fn(),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => streamChatMocks,
}));

describe("DyadStepLimit", () => {
  beforeEach(() => {
    streamChatMocks.streamMessage.mockReset();
    streamChatMocks.clearPauseOnly.mockReset();
  });

  it("keeps the queue paused when continuation hits the step limit again", () => {
    renderStepLimit();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const onSettled = streamChatMocks.streamMessage.mock.calls[0][0].onSettled;
    act(() => {
      onSettled({ success: true, pausedByStepLimit: true });
    });

    expect(streamChatMocks.clearPauseOnly).not.toHaveBeenCalled();
  });

  it("clears the pause after a successful continuation that does not pause again", () => {
    renderStepLimit();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const onSettled = streamChatMocks.streamMessage.mock.calls[0][0].onSettled;
    act(() => {
      onSettled({ success: true, pausedByStepLimit: false });
    });

    expect(streamChatMocks.clearPauseOnly).toHaveBeenCalledTimes(1);
  });
});

function renderStepLimit() {
  const store = createStore();
  store.set(selectedChatIdAtom, 123);

  render(
    <Provider store={store}>
      <DyadStepLimit
        node={{
          properties: {
            steps: "100",
            limit: "100",
            state: "finished",
          },
        }}
      />
    </Provider>,
  );
}
