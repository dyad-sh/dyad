import { DuplicateIdentifierError } from "../errors.js";

export type DiffPair<T> = {
  readonly old: T;
  readonly next: T;
};

export type BuildDiffResult<TDiff> = {
  readonly diff: TDiff;
  readonly requiresRecreation: boolean;
};

export type ListDiff<TObject, TDiff> = {
  readonly adds: readonly TObject[];
  readonly deletes: readonly TObject[];
  readonly alters: readonly TDiff[];
};

export function diffLists<TObject, TDiff>(options: {
  readonly oldObjects: readonly TObject[];
  readonly newObjects: readonly TObject[];
  readonly getName: (object: TObject) => string;
  readonly buildDiff: (
    oldObject: TObject,
    newObject: TObject,
    oldIndex: number,
    newIndex: number,
  ) => BuildDiffResult<TDiff>;
}): ListDiff<TObject, TDiff> {
  const nameToOld = new Map<
    string,
    { readonly index: number; readonly object: TObject }
  >();

  options.oldObjects.forEach((oldObject, index) => {
    const name = options.getName(oldObject);
    if (nameToOld.has(name)) {
      throw new DuplicateIdentifierError(name);
    }
    nameToOld.set(name, { index, object: oldObject });
  });

  const adds: TObject[] = [];
  const deletes: TObject[] = [];
  const alters: TDiff[] = [];
  const seenNewNames = new Set<string>();

  options.newObjects.forEach((newObject, newIndex) => {
    const name = options.getName(newObject);
    if (seenNewNames.has(name)) {
      throw new DuplicateIdentifierError(name);
    }
    seenNewNames.add(name);

    const oldEntry = nameToOld.get(name);
    if (oldEntry === undefined) {
      adds.push(newObject);
      return;
    }

    nameToOld.delete(name);
    const result = options.buildDiff(
      oldEntry.object,
      newObject,
      oldEntry.index,
      newIndex,
    );
    if (result.requiresRecreation) {
      deletes.push(oldEntry.object);
      adds.push(newObject);
    } else {
      alters.push(result.diff);
    }
  });

  for (const oldEntry of nameToOld.values()) {
    deletes.push(oldEntry.object);
  }

  deletes.sort((a, b) => options.getName(a).localeCompare(options.getName(b)));

  return { adds, deletes, alters };
}
