import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ClaudeCodeUsage } from "./ClaudeCodeUsage";

const mocks = vi.hoisted(() => ({ usage: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { chat: { claudeCodeUsage: mocks.usage } },
}));

beforeEach(() => {
  mocks.usage.mockReset();
});

function setup(open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClaudeCodeUsage open={open} />
    </QueryClientProvider>,
  );
}

it("shows account percentages, reset times and the observation time", async () => {
  const resetsAt = Date.now() + 3600_000;
  mocks.usage.mockResolvedValue({
    windows: [
      { name: "five_hour", usedPercent: 7.000000000000001, resetsAt },
      { name: "seven_day", usedPercent: 58, resetsAt },
    ],
    updatedAt: Date.now(),
  });
  setup();
  expect(await screen.findByText("7% used")).toBeTruthy();
  expect(screen.getByText("58% used")).toBeTruthy();
  expect(
    screen
      .getByRole("progressbar", { name: "Claude Code Weekly usage" })
      .getAttribute("value"),
  ).toBe("58");
  expect(
    screen.getAllByText(`Resets ${new Date(resetsAt).toLocaleString()}`),
  ).toHaveLength(2);
  expect(screen.getByText(/Last reported/)).toBeTruthy();
});

it.each([
  { windows: [] },
  {
    windows: [
      { name: "five_hour", usedPercent: 7, resetsAt: Date.now() - 1000 },
    ],
  },
])(
  "shows unavailable instead of a zero bar when no current windows exist",
  async ({ windows }) => {
    mocks.usage.mockResolvedValue({ windows, updatedAt: null });
    setup();
    expect(await screen.findByText(/Usage unavailable/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  },
);

it("shows unavailable on a cache read failure", async () => {
  mocks.usage.mockRejectedValue(new Error("IPC unavailable"));
  setup();
  expect(await screen.findByText(/Usage unavailable/)).toBeTruthy();
});

it("only reads usage while the menu is open", async () => {
  setup(false);
  await waitFor(() => expect(mocks.usage).not.toHaveBeenCalled());
});
