import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { planStateAtom, type PlanData } from "@/atoms/planAtoms";

import {
  readPlanDocument,
  useIsPlanAccepted,
  usePlanDocument,
} from "./usePlanDocument";

function makeHarness() {
  const store = createStore();
  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }
  return { store, Wrapper };
}

const plan = (title: string): PlanData => ({
  title,
  content: `${title} content`,
});

describe("plan document readers", () => {
  it("reads the latest plan document from the injected store", () => {
    const store = createStore();
    expect(readPlanDocument(store, 7)).toBeUndefined();

    const latestPlan = plan("Latest");
    store.set(planStateAtom, {
      plansByChatId: new Map([[7, latestPlan]]),
      acceptedChatIds: new Set<number>(),
    });

    expect(readPlanDocument(store, 7)).toBe(latestPlan);
  });

  it("does not rerender the document reader for unrelated plan state", () => {
    const { store, Wrapper } = makeHarness();
    const currentPlan = plan("Current");
    store.set(planStateAtom, {
      plansByChatId: new Map([[7, currentPlan]]),
      acceptedChatIds: new Set<number>(),
    });
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return usePlanDocument(7);
      },
      { wrapper: Wrapper },
    );
    const renderCountBeforeUnrelatedUpdate = renderCount;

    act(() => {
      store.set(planStateAtom, {
        plansByChatId: new Map([
          [7, currentPlan],
          [8, plan("Other")],
        ]),
        acceptedChatIds: new Set([7]),
      });
    });

    expect(result.current).toBe(currentPlan);
    expect(renderCount).toBe(renderCountBeforeUnrelatedUpdate);
  });

  it("exposes acceptance separately from the plan document", () => {
    const { store, Wrapper } = makeHarness();
    const { result } = renderHook(() => useIsPlanAccepted(7), {
      wrapper: Wrapper,
    });

    act(() => {
      store.set(planStateAtom, {
        plansByChatId: new Map(),
        acceptedChatIds: new Set([7]),
      });
    });

    expect(result.current).toBe(true);
  });
});
