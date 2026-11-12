import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchModelsDialog } from "./FetchModelsDialog";

const mocks = vi.hoisted(() => ({
  fetchCustomProviderModels: vi.fn(),
  importCustomProviderModels: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    languageModel: {
      fetchCustomProviderModels: mocks.fetchCustomProviderModels,
      importCustomProviderModels: mocks.importCustomProviderModels,
    },
  },
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

const MODELS = [
  { apiName: "llama-3-8b", displayName: "llama-3-8b", contextWindow: 8192 },
  { apiName: "qwen-2-72b", displayName: "qwen-2-72b" },
  { apiName: "mistral-7b", displayName: "mistral-7b" },
];

function renderDialog(
  props: Partial<React.ComponentProps<typeof FetchModelsDialog>> = {},
) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <FetchModelsDialog
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
        providerId="custom::vllm"
        existingApiNames={[]}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSuccess };
}

const addButton = () =>
  screen.getByRole("button", { name: /^(Add \d+ models?|Adding\.\.\.)$/ });

describe("FetchModelsDialog", () => {
  beforeEach(() => {
    mocks.fetchCustomProviderModels.mockReset();
    mocks.fetchCustomProviderModels.mockResolvedValue(MODELS);
    mocks.importCustomProviderModels.mockReset();
    mocks.importCustomProviderModels.mockResolvedValue({
      added: 2,
      skipped: 0,
    });
    mocks.showError.mockReset();
    mocks.showSuccess.mockReset();
  });

  it("shows several skeleton rows while the models load", () => {
    mocks.fetchCustomProviderModels.mockReturnValue(new Promise(() => {}));
    renderDialog();

    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(1);
    expect(screen.queryByLabelText("Search models")).toBeNull();
  });

  it("lists fetched models and disables ones already added", async () => {
    renderDialog({ existingApiNames: ["qwen-2-72b"] });

    expect(await screen.findByText("llama-3-8b")).toBeTruthy();
    expect(screen.getByText("Context: 8,192 tokens")).toBeTruthy();
    expect(screen.getByText("Already added")).toBeTruthy();
    expect(
      (addButton() as HTMLButtonElement).disabled,
      "nothing selected yet",
    ).toBe(true);
  });

  it("filters the list by the search text", async () => {
    renderDialog();
    await screen.findByText("llama-3-8b");

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "QWEN" },
    });

    expect(screen.getByText("qwen-2-72b")).toBeTruthy();
    expect(screen.queryByText("llama-3-8b")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "nothing-like-this" },
    });
    expect(screen.getByText(/No models match/)).toBeTruthy();
  });

  it("keeps selections made before filtering and only selects visible models with Select all", async () => {
    renderDialog();
    await screen.findByText("llama-3-8b");

    fireEvent.click(screen.getByText("llama-3-8b"));
    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "qwen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(addButton().textContent).toBe("Add 2 models");

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "" },
    });
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(mocks.importCustomProviderModels).toHaveBeenCalledWith({
        providerId: "custom::vllm",
        models: [MODELS[0], MODELS[1]],
      }),
    );
  });

  it("reports the added and skipped counts, then closes", async () => {
    mocks.importCustomProviderModels.mockResolvedValue({
      added: 1,
      skipped: 1,
    });
    const { onClose, onSuccess } = renderDialog();
    await screen.findByText("llama-3-8b");

    fireEvent.click(screen.getByText("llama-3-8b"));
    fireEvent.click(screen.getByText("qwen-2-72b"));
    fireEvent.click(addButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.showSuccess).toHaveBeenCalledWith("Added 1 model");
    expect(mocks.showSuccess).toHaveBeenCalledWith("1 model was already added");
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("stays open and keeps the selection when the import fails", async () => {
    const failure = new Error("db locked");
    mocks.importCustomProviderModels.mockRejectedValue(failure);
    const { onClose, onSuccess } = renderDialog();
    await screen.findByText("llama-3-8b");

    fireEvent.click(screen.getByText("llama-3-8b"));
    fireEvent.click(addButton());

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith(failure));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    await waitFor(() => expect(addButton().textContent).toBe("Add 1 model"));
  });

  it("shows the fetch error with a retry", async () => {
    mocks.fetchCustomProviderModels.mockRejectedValueOnce(
      new Error("Could not reach the server"),
    );
    renderDialog();

    expect(await screen.findByText(/Could not reach the server/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("llama-3-8b")).toBeTruthy();
  });
});
