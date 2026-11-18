import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsSection } from "./ModelsSection";

const mocks = vi.hoisted(() => ({
  useLanguageModelsForProvider: vi.fn(),
}));

vi.mock("@/hooks/useLanguageModelsForProvider", () => ({
  useLanguageModelsForProvider: mocks.useLanguageModelsForProvider,
}));

vi.mock("@/hooks/useDeleteCustomModel", () => ({
  useDeleteCustomModel: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/CreateCustomModelDialog", () => ({
  CreateCustomModelDialog: () => null,
}));

vi.mock("@/components/EditCustomModelDialog", () => ({
  EditCustomModelDialog: () => null,
}));

vi.mock("@/components/FetchModelsDialog", () => ({
  FetchModelsDialog: () => null,
}));

describe("ModelsSection", () => {
  beforeEach(() => {
    mocks.useLanguageModelsForProvider.mockReset();
  });

  it("keeps Import Models available when loading saved models fails", () => {
    mocks.useLanguageModelsForProvider.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("offline"),
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ModelsSection providerId="custom::vllm" />
      </QueryClientProvider>,
    );

    const importButton = screen.getByRole("button", { name: /Import Models/ });
    expect((importButton as HTMLButtonElement).disabled).toBe(false);
  });
});
