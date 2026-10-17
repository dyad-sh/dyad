import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecentDeploymentsList,
  type RecentDeploymentRow,
} from "./RecentDeploymentsList";

const openExternalUrl = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl } },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const WHEN = new Date("2026-01-02T03:04:05Z");

const ROWS: RecentDeploymentRow[] = [
  {
    key: "newest",
    label: "Building",
    tone: "pending",
    createdAt: WHEN,
    url: null,
  },
  {
    key: "older",
    label: "Ready",
    tone: "success",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    url: "https://older.example.workers.dev",
    detail: "abc1234",
  },
];

describe("the recent deployments list", () => {
  it("renders nothing for no rows", () => {
    const { container } = render(<RecentDeploymentsList rows={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows each row's label, time and detail in order", () => {
    render(<RecentDeploymentsList rows={ROWS} testId="list" />);

    const rows = within(screen.getByTestId("list")).getAllByTestId(
      "recent-deployment",
    );
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Building")).toBeTruthy();
    expect(within(rows[0]).getByText(WHEN.toLocaleString())).toBeTruthy();
    expect(within(rows[1]).getByText("Ready")).toBeTruthy();
    expect(within(rows[1]).getByText("abc1234")).toBeTruthy();
  });

  it("colors the pill by tone", () => {
    render(<RecentDeploymentsList rows={ROWS} />);

    expect(screen.getByText("Building").className).toContain("bg-yellow-100");
    expect(screen.getByText("Ready").className).toContain("bg-green-100");
  });

  it("colors a failed deployment red", () => {
    render(
      <RecentDeploymentsList
        rows={[
          {
            key: "k",
            label: "Error",
            tone: "failure",
            createdAt: null,
            url: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("Error").className).toContain("bg-red-100");
  });

  it("heads the list with the translated title", () => {
    render(<RecentDeploymentsList rows={ROWS} />);
    expect(
      screen.getByText("integrations.vercel.recentDeployments"),
    ).toBeTruthy();
  });

  it("opens a row's address from View, and offers none without an address", () => {
    render(<RecentDeploymentsList rows={ROWS} />);

    const rows = screen.getAllByTestId("recent-deployment");
    expect(within(rows[0]).queryByText("View")).toBeNull();
    // A real link, so it can be reached from the keyboard.
    expect(
      within(rows[1]).getByRole("link", { name: "View" }).getAttribute("href"),
    ).toBe("https://older.example.workers.dev");
    fireEvent.click(within(rows[1]).getByText("View"));
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://older.example.workers.dev",
    );
  });
});
