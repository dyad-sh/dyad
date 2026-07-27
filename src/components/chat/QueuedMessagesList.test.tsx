import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueuedMessagesList } from "./QueuedMessagesList";

function renderList(
  onDelete: (id: string) => void | Promise<void>,
  capabilities: { editable?: boolean; removable?: boolean } = {},
) {
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
          ...capabilities,
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
  it("labels machine-owned deletion as rejection", () => {
    const onDelete = vi.fn(() => Promise.resolve());
    renderList(onDelete);
    const deleteButton = screen.getByTitle("Reject and delete");

    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("follow-up");
  });

  it("hides mutations excluded by the authoritative queue capabilities", () => {
    renderList(vi.fn(), { editable: false, removable: false });

    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Move up")).toBeNull();
    expect(screen.queryByTitle("Move down")).toBeNull();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByTitle("Reject and delete")).toBeNull();
  });
});
