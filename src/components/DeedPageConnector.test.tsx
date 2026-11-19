import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  deedpage: {
    getSite: vi.fn(),
    publish: vi.fn(),
    disconnect: vi.fn(),
  },
  system: { openExternalUrl: vi.fn() },
}));
const toast = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));

vi.mock("@/ipc/types", () => ({ ipc: ipcMock }));
vi.mock("@/lib/toast", () => toast);

const { DeedPageConnector } = await import("./DeedPageConnector");

function renderConnector() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DeedPageConnector appId={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DeedPageConnector", () => {
  it("publishes a new app with the site name the user typed", async () => {
    ipcMock.deedpage.getSite.mockResolvedValue(null);
    ipcMock.deedpage.publish.mockResolvedValue({
      slug: "my-app",
      url: "https://my-app.deed.page/",
      version: "v1",
    });
    renderConnector();

    fireEvent.change(await screen.findByLabelText("Site name (optional)"), {
      target: { value: "my-app" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to deed.page" }),
    );

    await waitFor(() =>
      expect(toast.showSuccess).toHaveBeenCalledWith(
        "Published v1 to https://my-app.deed.page/",
      ),
    );
    expect(ipcMock.deedpage.publish).toHaveBeenCalledWith({
      appId: 7,
      slug: "my-app",
    });
  });

  it("will not publish an invalid site name", async () => {
    ipcMock.deedpage.getSite.mockResolvedValue(null);
    renderConnector();

    fireEvent.change(await screen.findByLabelText("Site name (optional)"), {
      target: { value: "My App" },
    });

    expect(
      screen.getByRole("button", { name: "Publish to deed.page" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Use lowercase letters, numbers, and dashes."),
    ).toBeTruthy();
  });

  it("updates the saved site and can forget it", async () => {
    ipcMock.deedpage.getSite.mockResolvedValue({
      slug: "my-app",
      url: "https://my-app.deed.page/",
    });
    ipcMock.deedpage.publish.mockResolvedValue({
      slug: "my-app",
      url: "https://my-app.deed.page/",
      version: "v2",
    });
    ipcMock.deedpage.disconnect.mockResolvedValue(undefined);
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Publish update" }),
    );
    await waitFor(() =>
      expect(ipcMock.deedpage.publish).toHaveBeenCalledWith({ appId: 7 }),
    );

    fireEvent.click(screen.getByText("https://my-app.deed.page/"));
    expect(ipcMock.system.openExternalUrl).toHaveBeenCalledWith(
      "https://my-app.deed.page/",
    );

    fireEvent.click(screen.getByRole("button", { name: "Forget site" }));
    await waitFor(() =>
      expect(ipcMock.deedpage.disconnect).toHaveBeenCalledWith({ appId: 7 }),
    );
  });

  it("shows publish errors", async () => {
    ipcMock.deedpage.getSite.mockResolvedValue(null);
    const error = new Error("The build failed");
    ipcMock.deedpage.publish.mockRejectedValue(error);
    renderConnector();

    fireEvent.click(
      await screen.findByRole("button", { name: "Publish to deed.page" }),
    );

    await waitFor(() => expect(toast.showError).toHaveBeenCalledWith(error));
  });
});
