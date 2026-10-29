import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TestRunQueueSnapshot } from "@/ipc/types/tests";
import { NeonBranchLimitBanner } from "./NeonBranchLimitBanner";

const mocks = vi.hoisted(() => ({
  notices: new Map<number, TestRunQueueSnapshot["neonBranchLimit"]>(),
  project: "project",
  open: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { neonProjectId: mocks.project } }),
}));
vi.mock("@/hooks/useTestRunQueue", () => ({
  useDismissNeonBranchLimit: () => ({
    mutate: mocks.dismiss,
    isPending: false,
  }),
  useTestRunQueue: (appId: number) => ({
    data: { neonBranchLimit: mocks.notices.get(appId) },
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: mocks.open } },
}));
vi.mock("react-i18next", async () => {
  const { default: translations } = await import("@/i18n/locales/en/chat.json");
  return {
    useTranslation: () => ({
      t: (key: string) =>
        translations.neonBranchLimit[
          key.split(".")[1] as keyof typeof translations.neonBranchLimit
        ],
    }),
  };
});
beforeEach(() => {
  mocks.notices.clear();
  mocks.project = "project";
  mocks.open.mockClear();
  mocks.dismiss.mockClear();
});
afterEach(cleanup);

it("explains the plan limit and automatic resumption, and opens Neon", () => {
  mocks.notices.set(1, { runId: 1, projectId: "project", status: "waiting" });
  render(<NeonBranchLimitBanner appId={1} />);
  expect(screen.getByRole("status").textContent).toContain("Neon plan limits");
  expect(screen.getByRole("status").textContent).toContain(
    "continue automatically",
  );
  expect(
    screen.queryByRole("button", { name: "Dismiss Neon branch notice" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Neon" }));
  expect(mocks.open).toHaveBeenCalledWith("https://console.neon.tech");
});

it("shows an actionable blocked message and clears when capacity is recovered", () => {
  mocks.notices.set(1, { runId: 1, projectId: "project", status: "blocked" });
  const view = render(<NeonBranchLimitBanner appId={1} />);
  expect(screen.getByRole("status").textContent).toContain(
    "Delete an unused branch",
  );
  expect(screen.getByRole("status").textContent).not.toContain(
    "continue automatically",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss Neon branch notice" }),
  );
  expect(mocks.dismiss).toHaveBeenCalledWith({ appId: 1, runId: 1 });
  mocks.notices.delete(1);
  view.rerender(<NeonBranchLimitBanner appId={1} />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not carry another app's or a disconnected project's notice into the chat", () => {
  mocks.notices.set(1, { runId: 1, projectId: "project", status: "waiting" });
  const view = render(<NeonBranchLimitBanner appId={1} />);
  view.rerender(<NeonBranchLimitBanner appId={2} />);
  expect(screen.queryByRole("status")).toBeNull();
  mocks.project = "different-project";
  view.rerender(<NeonBranchLimitBanner appId={1} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<NeonBranchLimitBanner appId={null} />);
  expect(screen.queryByRole("status")).toBeNull();
});
