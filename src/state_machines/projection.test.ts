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

  it("warns and hands off transient concurrent writers in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const atom = {};
      const store = { set: vi.fn() };
      const first = registerAtomWriter<typeof store, typeof atom, number>(
        store,
        atom,
      );
      first.write(1);
      const second = registerAtomWriter<typeof store, typeof atom, number>(
        store,
        atom,
      );

      first.write(99);
      second.write(2);
      first.dispose();
      second.write(3);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("adopting the projection in production"),
      );
      expect(store.set.mock.calls).toEqual([
        [atom, 1],
        [atom, 2],
        [atom, 3],
      ]);
      second.dispose();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      warn.mockRestore();
    }
  });
});
