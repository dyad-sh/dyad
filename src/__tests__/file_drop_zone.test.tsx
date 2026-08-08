import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileDropZone } from "@/hooks/useFileDropZone";

function dragEvent(
  types: string[],
  files: File[] = [],
): React.DragEvent<HTMLElement> {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { types, files, dropEffect: "" },
  } as unknown as React.DragEvent<HTMLElement>;
}

const file = (name = "a.pdf", size = 10) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("useFileDropZone", () => {
  it("highlights only for drags carrying files", () => {
    const { result } = renderHook(() => useFileDropZone({ onFiles: vi.fn() }));

    act(() =>
      result.current.dropHandlers.onDragEnter(dragEvent(["text/plain"])),
    );
    expect(result.current.isDragging).toBe(false);

    act(() => result.current.dropHandlers.onDragEnter(dragEvent(["Files"])));
    expect(result.current.isDragging).toBe(true);
  });

  it("does not flicker when crossing child elements", () => {
    const { result } = renderHook(() => useFileDropZone({ onFiles: vi.fn() }));

    // Entering a child fires enter before the parent's leave.
    act(() => result.current.dropHandlers.onDragEnter(dragEvent(["Files"])));
    act(() => result.current.dropHandlers.onDragEnter(dragEvent(["Files"])));
    act(() => result.current.dropHandlers.onDragLeave(dragEvent(["Files"])));
    expect(result.current.isDragging).toBe(true);

    act(() => result.current.dropHandlers.onDragLeave(dragEvent(["Files"])));
    expect(result.current.isDragging).toBe(false);
  });

  it("hands over dropped files and clears the highlight", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));
    const dropped = [file("one.pdf"), file("two.png")];

    act(() => result.current.dropHandlers.onDragEnter(dragEvent(["Files"])));
    act(() =>
      result.current.dropHandlers.onDrop(dragEvent(["Files"], dropped)),
    );

    expect(onFiles).toHaveBeenCalledWith(dropped);
    expect(result.current.isDragging).toBe(false);
  });

  it("ignores folders, which arrive as empty typeless entries", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useFileDropZone({ onFiles }));
    const folder = new File([], "Documents", { type: "" });

    act(() =>
      result.current.dropHandlers.onDrop(dragEvent(["Files"], [folder])),
    );

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("accepts nothing while disabled", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() =>
      useFileDropZone({ onFiles, disabled: true }),
    );

    act(() => result.current.dropHandlers.onDragEnter(dragEvent(["Files"])));
    act(() =>
      result.current.dropHandlers.onDrop(dragEvent(["Files"], [file()])),
    );

    expect(result.current.isDragging).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("claims the drop so the app does not navigate to the file", () => {
    const { result } = renderHook(() => useFileDropZone({ onFiles: vi.fn() }));
    const over = dragEvent(["Files"]);

    act(() => result.current.dropHandlers.onDragOver(over));

    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe("copy");
  });
});
