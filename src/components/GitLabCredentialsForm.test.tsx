import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const h = vi.hoisted(() => ({
  saveToken: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    gitlab: { saveToken: h.saveToken },
    system: { openExternalUrl: h.openExternalUrl },
  },
}));

const { GitLabCredentialsForm: Form } = await import("./GitLabCredentialsForm");

function renderForm(props: { onConnected?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Form {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.saveToken.mockResolvedValue({
    connected: true,
    instanceUrl: "https://gitlab.com",
    username: "rene",
    tokenExpiresAt: null,
  });
});

describe("GitLabCredentialsForm", () => {
  it("defaults to gitlab.com and needs a token before it can connect", async () => {
    renderForm();

    expect(screen.getByTestId("gitlab-instance-url-input")).toHaveValue(
      "https://gitlab.com",
    );
    expect(screen.getByTestId("gitlab-connect-button")).toBeDisabled();

    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    expect(screen.getByTestId("gitlab-connect-button")).toBeEnabled();
    expect(screen.queryByTestId("gitlab-insecure-ack")).toBeNull();
  });

  it("sends the address and token, then clears the token field", async () => {
    const onConnected = vi.fn();
    renderForm({ onConnected });

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "https://gitlab.example.com/",
    );
    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(h.saveToken).toHaveBeenCalledWith({
      instanceUrl: "https://gitlab.example.com/",
      token: "glpat-x",
      acknowledgedInsecure: false,
    });
    expect(screen.getByTestId("gitlab-token-input")).toHaveValue("");
  });

  it("holds a plain-http address behind an acknowledgement", async () => {
    renderForm();

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "http://gitlab.internal",
    );
    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");

    expect(screen.getByTestId("gitlab-insecure-ack")).toBeInTheDocument();
    expect(screen.getByTestId("gitlab-connect-button")).toBeDisabled();

    await userEvent.click(screen.getByTestId("gitlab-insecure-ack"));
    expect(screen.getByTestId("gitlab-connect-button")).toBeEnabled();

    await userEvent.click(screen.getByTestId("gitlab-connect-button"));
    await waitFor(() =>
      expect(h.saveToken).toHaveBeenCalledWith(
        expect.objectContaining({ acknowledgedInsecure: true }),
      ),
    );
  });

  it("does not treat loopback as insecure", async () => {
    renderForm();

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "http://localhost:3500/gitlab",
    );

    expect(screen.queryByTestId("gitlab-insecure-ack")).toBeNull();
  });

  it("shows the main process's reason when the token is refused", async () => {
    h.saveToken.mockRejectedValue(new Error("needs the api scope"));
    renderForm();

    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));

    expect(
      await screen.findByTestId("gitlab-credentials-error"),
    ).toHaveTextContent("needs the api scope");
    // The token stays so the user can fix the address instead of retyping it.
    expect(screen.getByTestId("gitlab-token-input")).toHaveValue("glpat-x");
  });
});
