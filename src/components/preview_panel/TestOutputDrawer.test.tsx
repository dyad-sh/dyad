import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendTestRunOutputAtom,
  applyTestRunStartedAtom,
  clearTestRuntimeForAppAtom,
  currentTestRunOutputAtom,
  currentTestRunStateAtom,
} from "@/atoms/testRuntimeAtoms";
import { MAX_TEST_RUN_OUTPUT_LENGTH } from "@/atoms/testOutputAtoms";
import { TestOutputDrawer } from "./TestOutputDrawer";

afterEach(cleanup);

function setup() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  const onToggle = vi.fn();
  const mount = (open = true) =>
    render(
      <Provider store={store}>
        <TestOutputDrawer open={open} onToggle={onToggle} />
      </Provider>,
    );
  const start = (runId: number, appId = 1) =>
    act(() => {
      store.set(applyTestRunStartedAtom, {
        appId,
        runId,
        source: "panel",
        testFile: "e2e-tests/signup.spec.ts",
      });
    });
  const append = (runId: number, chunk: string, appId = 1) =>
    act(() => store.set(appendTestRunOutputAtom, { appId, runId, chunk }));
  const tab = (runId: number) =>
    screen.getByRole("tab", { name: `Run ${runId} · signup.spec.ts` });
  const close = (runId: number) =>
    fireEvent.click(
      screen.getByRole("button", {
        name: `Close output for Run ${runId} · signup.spec.ts`,
      }),
    );
  return { store, mount, start, append, tab, close, onToggle };
}

describe("TestOutputDrawer", () => {
  it("selects new runs and shows only the selected run's output", () => {
    const { mount, start, append, tab } = setup();
    mount();
    start(1);
    expect(screen.getByRole("tabpanel").textContent).toBe("No output yet.");
    append(1, "first run\n");
    start(2);
    append(2, "second run\n");
    expect(tab(2).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("second run\n");

    fireEvent.click(tab(1));
    append(2, "more second run\n");
    expect(tab(1).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("first run\n");
    append(1, "more first run\n");
    expect(screen.getByRole("tabpanel").textContent).toBe(
      "first run\nmore first run\n",
    );
    fireEvent.click(tab(2));
    expect(screen.getByRole("tabpanel").textContent).toBe(
      "second run\nmore second run\n",
    );
  });

  it("closes inactive and selected tabs, selects a neighbor, and handles the last tab", () => {
    const { mount, start, tab, close } = setup();
    mount();
    for (const runId of [1, 2, 3, 4]) start(runId);
    close(2);
    expect(tab(4).getAttribute("aria-selected")).toBe("true");
    close(4);
    expect(tab(3).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(3));
    fireEvent.click(tab(1));
    close(1);
    expect(tab(3).getAttribute("aria-selected")).toBe("true");
    close(3);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen.getByText("No test output tabs. Run tests to see output."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Toggle test output" }),
    );
  });

  it("dismisses live output without stopping a run or losing AI fix context", () => {
    const { store, mount, start, append, close } = setup();
    mount();
    start(1);
    append(1, "initial output\n");
    const runningState = store.get(currentTestRunStateAtom);
    close(1);
    append(1, "later output\n");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(store.get(currentTestRunStateAtom)).toBe(runningState);
    expect(store.get(currentTestRunOutputAtom)).toBe(
      "initial output\nlater output\n",
    );
    start(2);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });

  it("supports arrow-key selection and Delete to close the focused tab", async () => {
    const { mount, start, tab } = setup();
    mount();
    start(1);
    start(2);
    act(() => tab(2).focus());
    // Base UI moves keyboard focus in a microtask.
    await act(async () => {
      fireEvent.keyDown(tab(2), { key: "ArrowLeft" });
    });
    expect(tab(1).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(1), { key: "Delete" });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(document.activeElement).toBe(tab(2));
    expect(tab(2).getAttribute("aria-selected")).toBe("true");
  });

  it("retains tabs, selection, and dismissals across app switches and remounts", () => {
    const { store, mount, start, append, tab, close } = setup();
    const first = mount();
    start(1);
    append(1, "app one");
    start(2);
    start(3);
    close(2);
    fireEvent.click(tab(1));

    act(() => store.set(selectedAppIdAtom, 2));
    expect(screen.queryByRole("tab")).toBeNull();
    start(4, 2);
    append(4, "app two", 2);
    expect(screen.getByRole("tabpanel").textContent).toBe("app two");
    act(() => store.set(selectedAppIdAtom, 1));
    expect(tab(1).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("app one");

    first.unmount();
    append(1, " while away");
    mount();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(tab(1).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("app one while away");
  });

  it("clears only the deleted app's output tabs", () => {
    const { store, mount, start, append } = setup();
    mount();
    start(1);
    start(2, 2);
    append(2, "other app", 2);
    act(() => store.set(clearTestRuntimeForAppAtom, 1));
    expect(screen.queryByRole("tab")).toBeNull();
    act(() => store.set(selectedAppIdAtom, 2));
    expect(screen.getByRole("tabpanel").textContent).toBe("other app");
  });

  it("caps each run's output independently", () => {
    const { mount, start, append, tab } = setup();
    mount();
    start(1);
    append(1, "x".repeat(MAX_TEST_RUN_OUTPUT_LENGTH));
    append(1, "tail");
    start(2);
    append(2, "small run");
    fireEvent.click(tab(1));
    const output = screen.getByRole("tabpanel").textContent!;
    expect(output).toHaveLength(MAX_TEST_RUN_OUTPUT_LENGTH);
    expect(output.endsWith("tail")).toBe(true);
    fireEvent.click(tab(2));
    expect(screen.getByRole("tabpanel").textContent).toBe("small run");
  });

  it("keeps the drawer collapsible", () => {
    const { mount, start, onToggle } = setup();
    start(1);
    mount(false);
    expect(screen.queryByRole("tablist")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Toggle test output" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
