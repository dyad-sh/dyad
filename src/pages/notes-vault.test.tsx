import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";

import { notesVaultAtom } from "@/atoms/notesVaultAtoms";
import NotesVaultPage from "./notes-vault";

describe("NotesVaultPage", () => {
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
    expect(screen.getByText("Saved locally")).toBeTruthy();
  });
});
