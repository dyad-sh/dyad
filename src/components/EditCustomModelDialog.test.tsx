import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditCustomModelDialog } from "./EditCustomModelDialog";

const mocks = vi.hoisted(() => ({
  updateCustomModel: vi.fn(),
  updateSettings: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    languageModel: {
      updateCustomModel: mocks.updateCustomModel,
    },
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      selectedModel: {
        provider: "openai",
        name: "shared-api-name",
      },
      recentModels: [
        {
          provider: "openai",
          name: "shared-api-name",
          customModelId: 12,
        },
        {
          provider: "openai",
          name: "shared-api-name",
          customModelId: 99,
        },
      ],
    },
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showSuccess: mocks.showSuccess,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("EditCustomModelDialog", () => {
  beforeEach(() => {
    mocks.updateCustomModel.mockReset();
    mocks.updateCustomModel.mockResolvedValue(12);
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(undefined);
    mocks.showError.mockReset();
    mocks.showSuccess.mockReset();
  });

  it("updates the exact custom model ID in place", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditCustomModelDialog
          isOpen
          onClose={vi.fn()}
          onSuccess={vi.fn()}
          providerId="openai"
          model={{
            id: 12,
            apiName: "shared-api-name",
            displayName: "Original name",
            type: "custom",
          }}
          models={[
            {
              id: 12,
              apiName: "shared-api-name",
              type: "custom",
            },
            {
              id: 99,
              apiName: "shared-api-name",
              type: "custom",
            },
          ]}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Name*"), {
      target: { value: "Updated name" },
    });
    fireEvent.change(screen.getByLabelText("Model ID*"), {
      target: { value: "renamed-api-name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Model" }));

    await waitFor(() => {
      expect(mocks.updateCustomModel).toHaveBeenCalledWith({
        id: 12,
        apiName: "renamed-api-name",
        displayName: "Updated name",
        providerId: "openai",
        description: undefined,
        maxOutputTokens: undefined,
        contextWindow: undefined,
        // No custom effort levels set: the dialog sends an explicit null.
        effortSettings: null,
      });
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedModel: {
          provider: "openai",
          name: "renamed-api-name",
          customModelId: 12,
        },
        recentModels: [
          {
            provider: "openai",
            name: "renamed-api-name",
            customModelId: 12,
          },
          {
            provider: "openai",
            name: "shared-api-name",
            customModelId: 99,
          },
        ],
      });
    });
  });
});
