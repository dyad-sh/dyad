import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppItem } from "./appItem";
import "@/i18n";
import type { ListedApp } from "@/ipc/types/app";

const mocks = vi.hoisted(() => ({
  openEntityInNewWindow: vi.fn().mockResolvedValue({
    windowSessionId: "10000000-0000-4000-8000-000000000001",
  }),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...original,
    ipc: {
      ...original.ipc,
      windowInfrastructure: {
        ...original.ipc.windowInfrastructure,
        openEntityInNewWindow: mocks.openEntityInNewWindow,
      },
    },
  };
});

describe("AppItem", () => {
  beforeEach(() => {
    mocks.openEntityInNewWindow.mockClear();
  });

  it("explicitly duplicates an app surface into a new window", async () => {
    render(
      <AppItem
        app={
          {
            id: 7,
            name: "Product app",
            path: "product-app",
            createdAt: new Date("2026-07-01T00:00:00Z"),
            updatedAt: new Date("2026-07-01T00:00:00Z"),
            isFavorite: false,
            collectionId: null,
          } as ListedApp
        }
        handleAppClick={vi.fn()}
        selectedAppId={null}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId("app-list-item-Product app"));
    fireEvent.click(await screen.findByText("Open in New Window"));

    await waitFor(() =>
      expect(mocks.openEntityInNewWindow).toHaveBeenCalledWith({
        kind: "app",
        id: 7,
      }),
    );
  });
});
