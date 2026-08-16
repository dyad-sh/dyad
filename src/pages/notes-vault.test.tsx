import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notesVaultAtom } from "@/atoms/notesVaultAtoms";
import NotesVaultPage from "./notes-vault";

const mocks = vi.hoisted(() => ({ syncVaultNotes: vi.fn() }));

vi.mock("@/ipc/types", () => ({
  ipc: { storage: { syncVaultNotes: mocks.syncVaultNotes } },
}));

describe("NotesVaultPage", () => {
  beforeEach(() => {
    mocks.syncVaultNotes.mockReset();
    mocks.syncVaultNotes.mockResolvedValue({
      destination: "cache",
      files: 0,
      syncedAt: null,
      location: null,
      reason: "Choose a local vault.",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and autosaves an editable note", () => {
    const store = createStore();
    store.set(notesVaultAtom, []);
    render(
      <Provider store={store}>
        <NotesVaultPage />
      </Provider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new note/i })[0]);
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Red Special setup" },
    });
    fireEvent.change(screen.getByLabelText("Note body"), {
      target: { value: "Check the tremolo and pickup switches." },
    });

    expect(store.get(notesVaultAtom)[0]).toMatchObject({
      title: "Red Special setup",
      body: "Check the tremolo and pickup switches.",
    });
    expect(screen.getByText("Saving to vault…")).toBeTruthy();
    expect(
      screen.getByTestId("notes-vault").querySelector(".particle-background"),
    ).toBeTruthy();
  });

  it("debounces edits into Markdown files in the selected vault", async () => {
    vi.useFakeTimers();
    mocks.syncVaultNotes.mockResolvedValue({
      destination: "local",
      files: 1,
      syncedAt: Date.now(),
      location: "/vault/Notes/Vault",
      reason: null,
    });
    const store = createStore();
    store.set(notesVaultAtom, []);
    render(
      <Provider store={store}>
        <NotesVaultPage />
      </Provider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /new note/i })[0]);
    fireEvent.change(screen.getByLabelText("Note title"), {
      target: { value: "Mirrored note" },
    });
    fireEvent.change(screen.getByLabelText("Note body"), {
      target: { value: "Stored as Markdown." },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.syncVaultNotes).toHaveBeenCalledTimes(1);
    expect(mocks.syncVaultNotes).toHaveBeenCalledWith({
      notes: [
        expect.objectContaining({
          title: "Mirrored note",
          body: "Stored as Markdown.",
        }),
      ],
    });
    expect(screen.getByText("Saved to vault")).toBeTruthy();
  });
});
