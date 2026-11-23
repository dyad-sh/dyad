import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSelfHostedInstances: vi.fn(),
  addSelfHostedInstance: vi.fn(),
  setAppProject: vi.fn(),
  unsetAppProject: vi.fn(),
  removeSelfHostedInstance: vi.fn(),
  openExternalUrl: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  listCoolifySupabaseServices: vi.fn(),
  importCoolifySupabaseService: vi.fn(),
  getSelfHostedEmailStatus: vi.fn(),
  settings: {} as {
    enableOwnServerDeployment?: boolean;
    coolify?: { instanceUrl?: string; accessToken?: { value: string } };
  },
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    supabase: {
      listSelfHostedInstances: mocks.listSelfHostedInstances,
      addSelfHostedInstance: mocks.addSelfHostedInstance,
      setAppProject: mocks.setAppProject,
      unsetAppProject: mocks.unsetAppProject,
      removeSelfHostedInstance: mocks.removeSelfHostedInstance,
      listCoolifySupabaseServices: mocks.listCoolifySupabaseServices,
      importCoolifySupabaseService: mocks.importCoolifySupabaseService,
      getSelfHostedEmailStatus: mocks.getSelfHostedEmailStatus,
    },
    system: { openExternalUrl: mocks.openExternalUrl },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import {
  SupabaseSelfHostedConnectedCard,
  SupabaseSelfHostedInstancesSettings,
  SupabaseSelfHostedLinkSection,
} from "./SupabaseSelfHosted";

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper });
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const INSTANCE = {
  id: "instance-1",
  name: "Home lab",
  url: "https://supabase.example.com",
  studioUrl: null as string | null,
  ssh: { host: "203.0.113.5", port: 22, username: "root" } as {
    host: string;
    port: number;
    username: string;
  } | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSelfHostedInstances.mockResolvedValue([]);
  mocks.setAppProject.mockResolvedValue(undefined);
  mocks.unsetAppProject.mockResolvedValue(undefined);
  mocks.settings = {};
});

describe("SupabaseSelfHostedLinkSection", () => {
  it("adds an instance and connects the app to it", async () => {
    mocks.addSelfHostedInstance.mockResolvedValue({ instance: INSTANCE });
    const onLinked = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={onLinked} />,
    );

    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));
    fill("Name", "Home lab");
    fill("API URL", "https://supabase.example.com");
    fill("Anon key", "sb_publishable_a");
    fill("Service role key", "sb_secret_s");
    fireEvent.click(
      screen.getByRole("switch", { name: "Enable edge functions" }),
    );
    fill("SSH user", "root");
    fill("Private key", "-----BEGIN OPENSSH PRIVATE KEY-----");
    fireEvent.click(screen.getByRole("button", { name: "Add and connect" }));

    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(mocks.addSelfHostedInstance).toHaveBeenCalledWith({
      name: "Home lab",
      url: "https://supabase.example.com",
      anonKey: "sb_publishable_a",
      serviceKey: "sb_secret_s",
      studioUrl: null,
      // An empty SSH host means the API URL's host.
      ssh: {
        host: "supabase.example.com",
        port: 22,
        username: "root",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      },
    });
    expect(mocks.setAppProject).toHaveBeenCalledWith({
      appId: 7,
      projectId: "instance-1",
      organizationSlug: null,
    });
  });

  it("warns about plain HTTP before anything is sent", () => {
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));
    const note = () => screen.queryByTestId("supabase-self-hosted-http-note");

    fill("API URL", "http://203.0.113.7:8000");
    expect(note()?.textContent).toContain(
      "Dyad will send the instance's keys unencrypted",
    );
    expect(mocks.addSelfHostedInstance).not.toHaveBeenCalled();

    for (const url of [
      "https://supabase.example.com",
      "http://localhost:8000",
    ]) {
      fill("API URL", url);
      expect(note()).toBeNull();
    }
  });

  it("refreshes each instance's linked apps after connecting", async () => {
    mocks.listSelfHostedInstances.mockResolvedValue([
      { ...INSTANCE, linkedApps: [] },
    ]);
    const user = userEvent.setup();
    const onLinked = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={onLinked} />,
    );

    await user.click(await screen.findByLabelText("Instance"));
    await user.click(await screen.findByRole("option", { name: "Home lab" }));
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    // Settings reads linked apps from this list to decide whether to confirm
    // a removal, so it must not keep the copy from before the link.
    await waitFor(() =>
      expect(mocks.listSelfHostedInstances).toHaveBeenCalledTimes(2),
    );
  });

  it("says which apps already use the selected instance", async () => {
    mocks.listSelfHostedInstances.mockResolvedValue([
      {
        ...INSTANCE,
        linkedApps: [
          { id: 1, name: "Blog" },
          { id: 2, name: "Shop" },
        ],
      },
      { ...INSTANCE, id: "instance-2", name: "Spare", linkedApps: [] },
    ]);
    const user = userEvent.setup();
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    const note = () => screen.queryByTestId("supabase-self-hosted-shared-note");

    await user.click(await screen.findByLabelText("Instance"));
    await user.click(await screen.findByRole("option", { name: "Home lab" }));
    expect(note()?.textContent).toBe(
      "Also used by Blog, Shop. Apps on one instance share its database and edge functions, so tables or functions with the same name will overwrite each other.",
    );

    await user.click(screen.getByLabelText("Instance"));
    await user.click(await screen.findByRole("option", { name: "Spare" }));
    expect(note()).toBeNull();
  });

  it("adds an instance without SSH by default", async () => {
    mocks.addSelfHostedInstance.mockResolvedValue({
      instance: { ...INSTANCE, ssh: null },
    });
    const onLinked = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={onLinked} />,
    );

    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));
    expect(screen.queryByLabelText("Private key")).toBeNull();
    fill("Name", "Home lab");
    fill("API URL", "https://supabase.example.com");
    fill("Anon key", "sb_publishable_a");
    fill("Service role key", "sb_secret_s");
    fireEvent.click(screen.getByRole("button", { name: "Add and connect" }));

    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(mocks.addSelfHostedInstance).toHaveBeenCalledWith(
      expect.objectContaining({ ssh: null }),
    );
  });

  it("shows a failed check next to the form and does not connect", async () => {
    mocks.addSelfHostedInstance.mockRejectedValue(
      new Error("The instance rejected the service key (401)."),
    );
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));
    fill("Name", "Home lab");
    fill("API URL", "https://supabase.example.com");
    fill("Anon key", "sb_publishable_a");
    fill("Service role key", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Add and connect" }));

    expect(
      (await screen.findByTestId("supabase-self-hosted-form-error"))
        .textContent,
    ).toContain("rejected the service key");
    expect(mocks.setAppProject).not.toHaveBeenCalled();
  });
});

describe("SupabaseSelfHostedLinkSection help and import", () => {
  it("explains where each value is on both kinds of install", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));

    await user.hover(screen.getByRole("button", { name: "About Anon key" }));

    const compose = await screen.findByText(/ANON_KEY in your \.env file/);
    const coolify = screen.getByText(
      /SERVICE_SUPABASEANON_KEY in the Supabase service/,
    );
    // Each install's name is bold, ahead of its own line.
    expect(compose.querySelector("strong")?.textContent).toBe(
      "Docker Compose:",
    );
    expect(coolify.querySelector("strong")?.textContent).toBe("Coolify:");
  });

  it("offers no Coolify import when Coolify isn't connected", () => {
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));

    expect(
      screen.queryByTestId("supabase-self-hosted-coolify-import"),
    ).toBeNull();
    expect(mocks.listCoolifySupabaseServices).not.toHaveBeenCalled();
  });

  it("offers no Coolify import while the Coolify experiment is off", () => {
    mocks.settings = {
      enableOwnServerDeployment: false,
      coolify: {
        instanceUrl: "http://203.0.113.7:8000",
        accessToken: { value: "token" },
      },
    };
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));

    expect(
      screen.queryByTestId("supabase-self-hosted-coolify-import"),
    ).toBeNull();
    expect(mocks.listCoolifySupabaseServices).not.toHaveBeenCalled();
  });

  it("fills the form from a Coolify service and adds it", async () => {
    mocks.settings = {
      enableOwnServerDeployment: true,
      coolify: {
        instanceUrl: "http://203.0.113.7:8000",
        accessToken: { value: "token" },
      },
    };
    mocks.listCoolifySupabaseServices.mockResolvedValue([
      { uuid: "svc-1", name: "supabase-t2np", url: "http://kong.example" },
    ]);
    mocks.importCoolifySupabaseService.mockResolvedValue({
      name: "supabase-t2np",
      url: "http://kong.example",
      anonKey: "anon-jwt",
      serviceKey: "service-jwt",
      studioUrl: "http://kong.example",
      ssh: {
        host: "203.0.113.7",
        port: 22,
        username: "root",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n",
      },
    });
    mocks.addSelfHostedInstance.mockResolvedValue({
      instance: INSTANCE,
    });
    const user = userEvent.setup();
    const onLinked = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={onLinked} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));

    await user.click(await screen.findByLabelText("Import from Coolify"));
    await user.click(
      await screen.findByRole("option", {
        name: "supabase-t2np (http://kong.example)",
      }),
    );

    expect(
      (await screen.findByTestId("supabase-self-hosted-import-note"))
        .textContent,
    ).toBe(
      "Filled in from Coolify. Edge functions will connect as root@203.0.113.7 with Coolify's SSH key for that server.",
    );
    expect(mocks.importCoolifySupabaseService).toHaveBeenCalledWith({
      serviceUuid: "svc-1",
    });
    // The imported key is used but never shown.
    expect(
      screen.getByTestId("supabase-self-hosted-coolify-key").textContent,
    ).toContain("Using Coolify's SSH key for root@203.0.113.7.");
    expect(screen.queryByDisplayValue(/BEGIN OPENSSH/)).toBeNull();
    expect(
      screen
        .getByRole("switch", { name: "Enable edge functions" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add and connect" }));

    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(mocks.addSelfHostedInstance).toHaveBeenCalledWith({
      name: "supabase-t2np",
      url: "http://kong.example",
      anonKey: "anon-jwt",
      serviceKey: "service-jwt",
      studioUrl: "http://kong.example",
      ssh: {
        host: "203.0.113.7",
        port: 22,
        username: "root",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\n",
      },
    });
  });

  it("lets the user paste their own key instead of Coolify's", async () => {
    mocks.settings = {
      enableOwnServerDeployment: true,
      coolify: {
        instanceUrl: "http://203.0.113.7:8000",
        accessToken: { value: "token" },
      },
    };
    mocks.listCoolifySupabaseServices.mockResolvedValue([
      { uuid: "svc-1", name: "supabase-t2np", url: "http://kong.example" },
    ]);
    mocks.importCoolifySupabaseService.mockResolvedValue({
      name: "supabase-t2np",
      url: "http://kong.example",
      anonKey: "anon-jwt",
      serviceKey: "service-jwt",
      studioUrl: "http://kong.example",
      ssh: {
        host: "203.0.113.7",
        port: 22,
        username: "root",
        privateKey: "coolify-key",
      },
    });
    mocks.addSelfHostedInstance.mockResolvedValue({ instance: INSTANCE });
    const user = userEvent.setup();
    renderWithQuery(
      <SupabaseSelfHostedLinkSection appId={7} onLinked={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("supabase-self-hosted-add-button"));
    await user.click(await screen.findByLabelText("Import from Coolify"));
    await user.click(
      await screen.findByRole("option", {
        name: "supabase-t2np (http://kong.example)",
      }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Use a different key" }),
    );
    fill("Private key", "my-key");
    fireEvent.click(screen.getByRole("button", { name: "Add and connect" }));

    await waitFor(() =>
      expect(mocks.addSelfHostedInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          ssh: expect.objectContaining({ privateKey: "my-key" }),
        }),
      ),
    );
  });
});

describe("SupabaseSelfHostedConnectedCard", () => {
  const app = {
    id: 7,
    name: "Shop",
    supabaseProjectId: "instance-1",
    supabaseSelfHosted: {
      ...INSTANCE,
      studioUrl: "https://studio.example.com",
    },
  } as Parameters<typeof SupabaseSelfHostedConnectedCard>[0]["app"];

  it("opens Studio and disconnects the app", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    renderWithQuery(
      <SupabaseSelfHostedConnectedCard app={app} onChanged={onChanged} />,
    );

    expect(screen.getByText("Home lab")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Studio/ }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://studio.example.com",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect instance" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocks.unsetAppProject).toHaveBeenCalledWith({ app: 7 });
  });
});

describe("SupabaseSelfHostedConnectedCard details", () => {
  const app = {
    id: 7,
    name: "Shop",
    supabaseProjectId: "instance-1",
    supabaseSelfHosted: INSTANCE,
  } as Parameters<typeof SupabaseSelfHostedConnectedCard>[0]["app"];

  /** The details list as label: value lines. */
  async function details(status: unknown) {
    mocks.getSelfHostedEmailStatus.mockResolvedValue(status);
    renderWithQuery(
      <SupabaseSelfHostedConnectedCard app={app} onChanged={vi.fn()} />,
    );
    const list = await screen.findByTestId("supabase-self-hosted-details");
    await waitFor(() => expect(list.textContent).not.toContain("Checking"));
    expect(mocks.getSelfHostedEmailStatus).toHaveBeenCalledWith({
      projectId: "instance-1",
    });
    return [...list.querySelectorAll("dt")].map(
      (term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`,
    );
  }

  it("shows edge functions and email as rows, not notices", async () => {
    expect(await details({ kind: "not-configured" })).toEqual([
      "Edge functions: Enabled",
      "Email: SMTP not configured",
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names a configured mail server", async () => {
    expect(
      await details({
        kind: "configured",
        host: "smtp.resend.com",
        brokenLinkOrigin: null,
      }),
    ).toContain("Email: SMTP configured (smtp.resend.com)");
  });

  it("says when email links point away from the instance", async () => {
    const user = userEvent.setup();
    expect(
      await details({
        kind: "configured",
        host: "smtp.resend.com",
        brokenLinkOrigin: "http://supabase-kong:8000",
      }),
    ).toContain("Email: SMTP configured, but email links won't work");

    await user.hover(screen.getByRole("button", { name: "About Email" }));
    expect(
      await screen.findByText(
        /Links in emails point to http:\/\/supabase-kong:8000/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/API_EXTERNAL_URL in the Supabase service/),
    ).toBeTruthy();
  });

  it("says sign-ups confirm without email when autoconfirm is on", async () => {
    expect(await details({ kind: "autoconfirm" })).toContain(
      "Email: Sign-ups confirm without email",
    );
  });

  it("states the requirement when Dyad can't tell", async () => {
    expect(await details({ kind: "unknown" })).toEqual([
      "Edge functions: Enabled",
    ]);
    expect(
      screen.getByText(
        "Email sign-up requires SMTP to be configured on your server.",
      ),
    ).toBeTruthy();
  });
});

describe("SupabaseSelfHostedInstancesSettings", () => {
  it("removes an instance no app uses without asking", async () => {
    mocks.listSelfHostedInstances.mockResolvedValue([
      { ...INSTANCE, linkedApps: [] },
    ]);
    mocks.removeSelfHostedInstance.mockResolvedValue(undefined);
    renderWithQuery(<SupabaseSelfHostedInstancesSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(mocks.removeSelfHostedInstance).toHaveBeenCalledWith({
        id: "instance-1",
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("removes every instance, listing the apps all of them disconnect", async () => {
    mocks.listSelfHostedInstances.mockResolvedValue([
      { ...INSTANCE, linkedApps: [{ id: 1, name: "Notes" }] },
      { ...INSTANCE, id: "instance-2", name: "Backup", linkedApps: [] },
    ]);
    mocks.removeSelfHostedInstance.mockResolvedValue(undefined);
    renderWithQuery(<SupabaseSelfHostedInstancesSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove all" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      Array.from(dialog.querySelectorAll("li")).map((item) => item.textContent),
    ).toEqual(["Notes"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);

    await waitFor(() =>
      expect(mocks.removeSelfHostedInstance.mock.calls).toEqual([
        [{ id: "instance-1" }],
        [{ id: "instance-2" }],
      ]),
    );
  });

  it("lists the apps it will disconnect before removing", async () => {
    mocks.listSelfHostedInstances.mockResolvedValue([
      {
        ...INSTANCE,
        linkedApps: [
          { id: 1, name: "Notes" },
          { id: 2, name: "Shop" },
        ],
      },
    ]);
    mocks.removeSelfHostedInstance.mockResolvedValue(undefined);
    renderWithQuery(<SupabaseSelfHostedInstancesSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This will disconnect the following apps:",
    );
    expect(
      Array.from(dialog.querySelectorAll("li")).map((item) => item.textContent),
    ).toEqual(["Notes", "Shop"]);
    expect(mocks.removeSelfHostedInstance).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);

    await waitFor(() =>
      expect(mocks.removeSelfHostedInstance).toHaveBeenCalledWith({
        id: "instance-1",
      }),
    );
  });
});
