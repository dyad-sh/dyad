# Jotai Testing

Learnings for writing unit tests against components/hooks that read or write Jotai atoms.

## Sharing a store across `renderHook` calls in a single test

When a test needs to render a hook, unmount it, and then render the hook again (e.g., to verify state persists across an unmount/remount — the exact scenario for atoms that replace local `useState`), all `renderHook` calls must share the **same Jotai store**. Otherwise each `renderHook`'s `Provider` wrapper creates its own isolated store and writes made by the first hook are invisible to the second.

**Wrong** — each call to `makeWrapper()` returns a component that creates a fresh `<Provider>` (no store prop), so every `renderHook` gets a new default store:

```tsx
function makeWrapper() {
  return function Wrapper({ children }) {
    return <Provider>{children}</Provider>;
  };
}
```

**Right** — create one store per test and bind every `renderHook` in that test to it:

```tsx
import { createStore, Provider } from "jotai";

function makeWrapper() {
  const store = createStore();
  return function Wrapper({ children }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

// In the test:
const wrapper = makeWrapper();
const first = renderHook(() => useMyAtomHook(id), { wrapper });
// ... mutate state ...
first.unmount();
const second = renderHook(() => useMyAtomHook(id), { wrapper });
// second now sees state written by first
```

The symptom when you get this wrong is assertions like `expected false to be true` on the remounted hook's state, even though the setter clearly ran against the first hook.

See `src/atoms/githubSyncAtoms.test.tsx` for a complete example covering unmount/remount, cross-unmount completion, and per-key isolation.
