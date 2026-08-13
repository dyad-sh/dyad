import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachmentsAtom } from "@/atoms/chatAtoms";
import type { FileAttachment } from "@/ipc/types";
import { showError } from "@/lib/toast";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENTS,
} from "@/shared/chatAttachmentLimits";
import { useAttachments } from "./useAttachments";

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
}));

function makeFile(name: string, size = 0): File {
  return { name, size } as File;
}

function makeWrapper() {
  const store = createStore();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, Wrapper };
}

describe("useAttachments", () => {
  beforeEach(() => {
    vi.mocked(showError).mockReset();
  });

  it("validates rapid additions against the latest atom state", () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(useAttachments, { wrapper: Wrapper });
    const hookSnapshot = result.current;
    const firstBatch = Array.from({ length: 6 }, (_, index) =>
      makeFile(`first-${index}.txt`),
    );
    const secondBatch = Array.from({ length: 5 }, (_, index) =>
      makeFile(`second-${index}.txt`),
    );
    let firstAdded = false;
    let secondAdded = false;

    act(() => {
      firstAdded = hookSnapshot.addAttachments(firstBatch);
      secondAdded = hookSnapshot.addAttachments(secondBatch);
    });

    expect(firstAdded).toBe(true);
    expect(secondAdded).toBe(false);
    expect(store.get(attachmentsAtom)).toHaveLength(6);
    expect(showError).toHaveBeenCalledWith(
      `You can attach up to ${MAX_CHAT_ATTACHMENTS} files at a time.`,
    );
  });

  it("keeps the aggregate byte limit under rapid additions", () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(useAttachments, { wrapper: Wrapper });
    const hookSnapshot = result.current;
    let firstAdded = false;
    let secondAdded = false;

    act(() => {
      firstAdded = hookSnapshot.addAttachments([
        makeFile("first.bin", MAX_CHAT_ATTACHMENT_BYTES),
        makeFile("second.bin", MAX_CHAT_ATTACHMENT_BYTES),
      ]);
      secondAdded = hookSnapshot.addAttachments([
        makeFile("third.bin", 6 * 1024 * 1024),
      ]);
    });

    expect(firstAdded).toBe(true);
    expect(secondAdded).toBe(false);
    expect(store.get(attachmentsAtom)).toHaveLength(2);
    expect(showError).toHaveBeenCalledWith(
      "Attachments total 26 MiB. The combined limit is 25 MiB.",
    );
  });

  it.each([
    { what: "a file drag", types: ["Files"], armed: true },
    {
      what: "a row dragged inside the composer",
      types: ["text/plain"],
      armed: false,
    },
  ])("$what: overlay armed = $armed", ({ types, armed }) => {
    // The composer hosts draggable rows of its own — reordering a recorded
    // test's checks — and their dragover bubbles up to the container's
    // handler. Arming on those paints "Drop files to attach" over the very
    // rows being dragged between.
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(useAttachments, { wrapper: Wrapper });
    const preventDefault = vi.fn();

    act(() => {
      result.current.handleDragOver({
        preventDefault,
        dataTransfer: { types },
      } as unknown as React.DragEvent);
    });

    expect(result.current.isDraggingOver).toBe(armed);
    // Still called either way: the container stays a valid drop target, so a
    // drop landing outside a row is a no-op rather than a browser navigation.
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("clears stale draft attachments when a queued replacement is invalid", () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(useAttachments, { wrapper: Wrapper });
    let replaced = true;

    act(() => {
      result.current.addAttachments([makeFile("current.txt")]);
    });
    expect(store.get(attachmentsAtom)).toHaveLength(1);

    const invalidReplacement: FileAttachment[] = Array.from(
      { length: MAX_CHAT_ATTACHMENTS + 1 },
      (_, index) => ({
        file: makeFile(`queued-${index}.txt`),
        type: "chat-context",
      }),
    );
    act(() => {
      replaced = result.current.replaceAttachments(invalidReplacement);
    });

    expect(replaced).toBe(false);
    expect(store.get(attachmentsAtom)).toEqual([]);
    expect(showError).toHaveBeenCalledWith(
      `You can attach up to ${MAX_CHAT_ATTACHMENTS} files at a time.`,
    );
  });
});
