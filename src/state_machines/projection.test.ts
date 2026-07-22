import { describe, expect, it, vi } from "vitest";
import { SnapshotStore } from "./snapshot_store";
import { projectToAtom, registerAtomWriter } from "./projection";

describe("projection kit", () => {
  it("writes the initial and reference-distinct selected values", () => {
    const atom = {};
    const store = { set: vi.fn() };
    const source = new SnapshotStore({ value: 1 });
    const stop = projectToAtom(store, atom, source, (state) => state.value);

    source.setState({ value: 1 });
    source.setState({ value: 2 });

    expect(store.set.mock.calls).toEqual([
      [atom, 1],
      [atom, 2],
    ]);
    stop();
  });

  it("rejects concurrent writers and permits a replacement after disposal", () => {
    const atom = {};
    const store = { set: vi.fn() };
    const first = registerAtomWriter(store, atom);

    expect(() => registerAtomWriter(store, atom)).toThrow(
      "already has a registered writer",
    );
    first.dispose();
    expect(() => registerAtomWriter(store, atom)).not.toThrow();
  });
});
