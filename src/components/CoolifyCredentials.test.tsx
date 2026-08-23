import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

const h = vi.hoisted(() => ({ revealCredentials: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { coolifySetup: { revealCredentials: h.revealCredentials } },
}));

const { CoolifyCredentials: Panel } = await import("./CoolifyCredentials");

function CoolifyCredentials(props: { showTitle?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <Panel {...props} />
    </QueryClientProvider>
  );
}

const FULL = {
  dashboardUrl: "https://203.0.113.5.sslip.io",
  adminEmail: "me@gmail.com",
  adminPassword: "Abc123@xyzAbc123@xyz",
  apiToken: "1|abcdefghijklmnop",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.revealCredentials.mockResolvedValue(FULL);
});

async function renderAndSettle() {
  render(<CoolifyCredentials />);
  await waitFor(() =>
    expect(screen.getByTestId("coolify-credentials")).toBeTruthy(),
  );
}

describe("what is on screen without asking", () => {
  it("shows the details rather than hiding them behind a control", async () => {
    // Made to click to discover Dyad even has these, most people never find
    // out — and then signing out locks them out of their own server.
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-address").textContent).toBe(
      FULL.dashboardUrl,
    );
    expect(screen.getByTestId("coolify-field-email").textContent).toBe(
      FULL.adminEmail,
    );
  });

  it("includes the API token, not only the sign-in details", async () => {
    // Signing out of Coolify in Dyad clears it, so without this the token is
    // gone for good and the instance has to be set up again.
    await renderAndSettle();
    expect(screen.getByTestId("coolify-field-api-token")).toBeTruthy();
  });

  it("keeps the secrets masked until they are asked for", async () => {
    // Showing the details is not the same as showing the secrets: these sit
    // in a panel someone may have open while screen sharing.
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-password").textContent).toMatch(
      /^•+$/,
    );
    expect(screen.getByTestId("coolify-field-api-token").textContent).toMatch(
      /^•+$/,
    );
  });

  it("does not mask what is not secret", async () => {
    await renderAndSettle();
    expect(screen.queryByRole("button", { name: "Show Address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Email" })).toBeNull();
  });
});

describe("revealing one value", () => {
  it("shows the password when asked, and hides it again", async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole("button", { name: "Show Password" }));
    expect(screen.getByTestId("coolify-field-password").textContent).toBe(
      FULL.adminPassword,
    );

    await user.click(screen.getByRole("button", { name: "Hide Password" }));
    expect(screen.getByTestId("coolify-field-password").textContent).toMatch(
      /^•+$/,
    );
  });

  it("reveals each value on its own", async () => {
    // Showing the password should not put the token on screen too.
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole("button", { name: "Show Password" }));

    expect(screen.getByTestId("coolify-field-api-token").textContent).toMatch(
      /^•+$/,
    );
  });
});

describe("naming the section", () => {
  it("names a server Dyad installed", async () => {
    // Reached by installing a server whose API token could not be minted, so
    // the account is all Dyad has for it.
    h.revealCredentials.mockResolvedValue({ ...FULL, apiToken: null });
    render(<CoolifyCredentials showTitle />);

    await waitFor(() =>
      expect(screen.getByText("Your new Coolify server")).toBeTruthy(),
    );
  });

  it("leaves no heading over nothing", async () => {
    // The caller cannot know there is anything to show until this has asked.
    h.revealCredentials.mockResolvedValue({
      dashboardUrl: null,
      adminEmail: null,
      adminPassword: null,
      apiToken: null,
    });
    render(<CoolifyCredentials showTitle />);

    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalled());
    expect(screen.queryByText("Your new Coolify server")).toBeNull();
  });
});

describe("an instance Dyad did not set up", () => {
  it("renders nothing rather than an empty heading", async () => {
    // Connected by pasting a token: no account Dyad created, no address it
    // chose. A panel of blanks would read as something having failed.
    h.revealCredentials.mockResolvedValue({
      dashboardUrl: null,
      adminEmail: null,
      adminPassword: null,
      apiToken: null,
    });
    const { container } = render(<CoolifyCredentials />);

    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalled());
    expect(screen.queryByTestId("coolify-credentials")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("still shows a token the user pasted themselves", async () => {
    h.revealCredentials.mockResolvedValue({
      dashboardUrl: "https://coolify.example.com",
      adminEmail: null,
      adminPassword: null,
      apiToken: "1|theirs",
    });
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-api-token")).toBeTruthy();
    expect(screen.queryByTestId("coolify-field-password")).toBeNull();
  });
});
