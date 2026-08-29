import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateSupabaseProjectForm } from "./CreateSupabaseProjectForm";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/ipc/types", () => ({
  SUPABASE_REGIONS: [
    { id: "us-east-1", label: "East US (North Virginia)" },
    { id: "eu-west-2", label: "West EU (London)" },
  ],
  DEFAULT_SUPABASE_REGION: "us-east-1",
  SUPABASE_PROJECT_NAME_MAX_LENGTH: 64,
}));

const ONE_ORG = [{ organizationSlug: "org-1", name: "Acme" }];
const TWO_ORGS = [
  { organizationSlug: "org-1", name: "Acme" },
  { organizationSlug: "org-2", name: "Globex" },
];

function renderForm(
  overrides: Partial<Parameters<typeof CreateSupabaseProjectForm>[0]> = {},
) {
  const props = {
    appId: 7,
    organizations: ONE_ORG,
    defaultName: "My App",
    createProject: vi.fn().mockResolvedValue({
      id: "proj-new",
      name: "My App",
      region: "us-east-1",
      organizationSlug: "org-1",
    }),
    isCreatingProject: false,
    error: null as string | null,
    onCreated: vi.fn(),
    onFailed: vi.fn(),
    onClearError: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<CreateSupabaseProjectForm {...props} />), props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateSupabaseProjectForm", () => {
  it("seeds the project name from the app so creating is one click", () => {
    renderForm();

    const input = screen.getByTestId(
      "supabase-new-project-name",
    ) as HTMLInputElement;
    expect(input.value).toBe("My App");
  });

  it("hides the organization picker when there is nothing to choose", () => {
    renderForm();

    expect(screen.queryByTestId("supabase-new-project-org")).toBeNull();
  });

  it("offers the organization picker once more than one is connected", () => {
    renderForm({ organizations: TWO_ORGS });

    expect(screen.getByTestId("supabase-new-project-org")).toBeTruthy();
  });

  it("creates with the trimmed name, the sole organization and the default region", async () => {
    const { props } = renderForm();

    const input = screen.getByTestId("supabase-new-project-name");
    fireEvent.change(input, { target: { value: "  spaced-name  " } });
    fireEvent.click(screen.getByTestId("supabase-create-project-submit"));

    await waitFor(() =>
      expect(props.createProject).toHaveBeenCalledWith({
        appId: 7,
        name: "spaced-name",
        organizationSlug: "org-1",
        region: "us-east-1",
      }),
    );
    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
  });

  it("refuses to submit a blank name", () => {
    const { props } = renderForm({ defaultName: "" });

    const submit = screen.getByTestId("supabase-create-project-submit");
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.click(submit);
    expect(props.createProject).not.toHaveBeenCalled();
  });

  // Reporting is the connector's job, since the failure has to outlive this
  // form. Supabase's own explanation — an exhausted project slot being the
  // likeliest — is what gets handed over.
  it("hands a failure to the connector and keeps what was typed", async () => {
    const failure = new Error("You have reached your project limit");
    const { props } = renderForm({
      createProject: vi.fn().mockRejectedValue(failure),
    });

    fireEvent.change(screen.getByTestId("supabase-new-project-name"), {
      target: { value: "over-quota" },
    });
    fireEvent.click(screen.getByTestId("supabase-create-project-submit"));

    await waitFor(() =>
      expect(props.onFailed).toHaveBeenCalledWith(7, failure),
    );
    expect(props.onCreated).not.toHaveBeenCalled();

    const input = screen.getByTestId(
      "supabase-new-project-name",
    ) as HTMLInputElement;
    expect(input.value).toBe("over-quota");
  });

  // A throw from the success handler is a bug in that handler, not a failed
  // create. Reporting it as one would tell the user a project they now own and
  // are billed for was never made.
  it("does not report a create as failed when the success handler throws", async () => {
    const { props } = renderForm({
      onCreated: vi.fn().mockRejectedValue(new Error("toast blew up")),
    });

    fireEvent.click(screen.getByTestId("supabase-create-project-submit"));

    await waitFor(() => expect(props.onCreated).toHaveBeenCalled());
    await act(async () => {});
    expect(props.onFailed).not.toHaveBeenCalled();
  });

  it("renders the failure the connector hands back", () => {
    renderForm({ error: "You have reached your project limit" });

    expect(screen.getByRole("alert").textContent).toContain(
      "reached your project limit",
    );
  });

  it("stales the error as soon as a field changes", () => {
    const { props } = renderForm({ error: "something went wrong" });

    fireEvent.change(screen.getByTestId("supabase-new-project-name"), {
      target: { value: "retry-name" },
    });

    expect(props.onClearError).toHaveBeenCalled();
  });

  it("clamps a seeded name longer than the contract allows", () => {
    renderForm({ defaultName: "x".repeat(120) });

    const input = screen.getByTestId(
      "supabase-new-project-name",
    ) as HTMLInputElement;
    expect(input.value).toHaveLength(64);
  });

  it("locks the form down while a create is in flight", () => {
    renderForm({ isCreatingProject: true });

    expect(
      screen
        .getByTestId("supabase-create-project-submit")
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByTestId("supabase-new-project-name").hasAttribute("disabled"),
    ).toBe(true);
  });
});
