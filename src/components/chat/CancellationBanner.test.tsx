import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  EMPTY_TEST_RUN_STATE,
  testRunStateByAppIdAtom,
  type TestRunPhase,
} from "@/atoms/testRuntimeAtoms";
import type { TestIsolation } from "@/ipc/types";
import { CancellationBanner } from "./CancellationBanner";

function renderBanner(runState?: {
  phase: TestRunPhase;
  isolationMode?: TestIsolation["mode"];
}) {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  if (runState) {
    store.set(
      testRunStateByAppIdAtom,
      new Map([
        [
          1,
          {
            ...EMPTY_TEST_RUN_STATE,
            phase: runState.phase,
            isolation: runState.isolationMode
              ? { mode: runState.isolationMode }
              : undefined,
          },
        ],
      ]),
    );
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return render(<CancellationBanner />, { wrapper });
}

describe("CancellationBanner", () => {
  it("always says the stop is in progress", () => {
    // The composer stays locked until the agent's in-flight tool unwinds, and
    // the transcript's status card scrolls away. Without this line the lock is
    // unexplained.
    renderBanner();

    expect(screen.getByText("Stopping…")).toBeTruthy();
    expect(screen.getByTestId("cancellation-banner").getAttribute("role")).toBe(
      "status",
    );
  });

  it("invents no reason when no test run is active", () => {
    // Most cancellations settle quickly. Only a test run's teardown makes the
    // wait long, so only a test run gets to explain it.
    renderBanner();

    expect(screen.queryByText(/test run/)).toBeNull();
    expect(screen.queryByText(/database/)).toBeNull();
  });

  it("warns about the length of the Neon teardown", () => {
    // The branch delete retries with backoff, so this wait can pass a minute.
    renderBanner({ phase: "cleaning-up", isolationMode: "neon-branch" });

    expect(
      screen.getByText(/Restoring your app's database and preview/),
    ).toBeTruthy();
    expect(screen.getByText(/up to a minute/)).toBeTruthy();
  });

  it("does not claim a restore on the Supabase path", () => {
    // That teardown only deletes the temporary test user — no env swap, no
    // dev-server restart, nothing the user sees.
    renderBanner({ phase: "cleaning-up", isolationMode: "supabase-test-user" });

    expect(screen.getByText(/Cleaning up the test data/)).toBeTruthy();
    expect(screen.queryByText(/Restoring/)).toBeNull();
  });

  it("reports the kill before the teardown starts", () => {
    renderBanner({ phase: "stopping" });

    expect(screen.getByText("Ending the test run.")).toBeTruthy();
  });
});
