import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueuedMessagesList } from "./QueuedMessagesList";

function renderList(onDelete: (id: string) => void | Promise<void>) {
  return render(
    <QueuedMessagesList
      messages={[
        {
          id: "follow-up",
          prompt: "Continue after integration",
          owner: {
            kind: "user-input-follow-up",
            requestId: "integration:1",
          },
        },
      ]}
      onEdit={vi.fn()}
      onDelete={onDelete}
      onMoveUp={vi.fn()}
      onMoveDown={vi.fn()}
      isStreaming
      hasError={false}
      isPaused={false}
      onPauseQueue={vi.fn()}
      onResumeQueue={vi.fn()}
    />,
  );
}

describe("QueuedMessagesList", () => {
  it("disables machine-owned deletion while rejection is pending", async () => {
    let finish!: () => void;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderList(onDelete);
    const deleteButton = screen.getByTitle("Reject and delete");

    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("follow-up");
    expect(
      (screen.getByTitle("Rejecting follow-up") as HTMLButtonElement).disabled,
    ).toBe(true);

    finish();
    await vi.waitFor(() =>
      expect(
        (screen.getByTitle("Reject and delete") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });
});
