export interface ProjectionSource<Snapshot> {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
}

const registeredWriters = new WeakMap<object, Map<unknown, symbol>>();

export interface AtomProjectionWriter<Value> {
  write(value: Value): void;
  dispose(): void;
}

/** Registers the sole writer for an atom and releases that claim on dispose. */
export function registerAtomWriter<Store extends object, Atom, Value>(
  store: Store,
  atom: Atom,
): AtomProjectionWriter<Value> {
  const storeKey = store;
  const set = (
    store as unknown as { set: (target: Atom, value: Value) => unknown }
  ).set.bind(store);
  const token = Symbol("atom-projection-writer");
  let writers = registeredWriters.get(storeKey);
  if (!writers) {
    writers = new Map();
    registeredWriters.set(storeKey, writers);
  }
  if (writers.has(atom)) {
    const message = "A projection atom already has a registered writer";
    if (process.env.NODE_ENV !== "production") {
      throw new Error(message);
    }
    console.warn(`${message}; adopting the projection in production`);
  }
  writers.set(atom, token);
  let disposed = false;

  return {
    write(value) {
      if (!disposed && registeredWriters.get(storeKey)?.get(atom) === token) {
        set(atom, value);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const current = registeredWriters.get(storeKey);
      if (current?.get(atom) === token) current.delete(atom);
      if (current?.size === 0) registeredWriters.delete(storeKey);
    },
  };
}

/** Projects a snapshot source to one atom, suppressing reference-equal writes. */
export function projectToAtom<Store extends object, Atom, Snapshot, Value>(
  store: Store,
  atom: Atom,
  source: ProjectionSource<Snapshot>,
  select: (snapshot: Snapshot) => Value,
  options: { cleanupValue?: Value } = {},
): () => void {
  const writer = registerAtomWriter(store, atom);
  let previous = select(source.getSnapshot());
  writer.write(previous);
  const unsubscribe = source.subscribe(() => {
    const next = select(source.getSnapshot());
    if (Object.is(previous, next)) return;
    previous = next;
    writer.write(next);
  });
  return () => {
    unsubscribe();
    if ("cleanupValue" in options) writer.write(options.cleanupValue as Value);
    writer.dispose();
  };
}
