import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DescribeAppTestsResult } from "@/ipc/types";
import { TestStepsDialog, type TestStepsTarget } from "./TestStepsDialog";

const describeAppTestsMock = vi.hoisted(() => vi.fn());

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      describeAppTests: describeAppTestsMock,
    },
  },
}));

// Base UI's Dialog portals into the document body and animates; none of that is
// what this test is about, so stub it down to plain elements.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
}));

const TARGET: TestStepsTarget = {
  file: "e2e-tests/signup.spec.ts",
  line: 3,
  title: "signs up a new user",
};

function Wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderDialog(target: TestStepsTarget | null = TARGET) {
  return render(
    <Wrapper>
      <TestStepsDialog appId={1} target={target} onOpenChange={() => {}} />
    </Wrapper>,
  );
}

function result(
  partial: Partial<DescribeAppTestsResult>,
): DescribeAppTestsResult {
  return { tests: [], ...partial };
}

describe("TestStepsDialog", () => {
  beforeEach(() => {
    describeAppTestsMock.mockReset();
  });

  it("renders nothing until a test is targeted", () => {
    renderDialog(null);
    expect(screen.queryByTestId("test-steps-dialog")).toBeNull();
    expect(describeAppTestsMock).not.toHaveBeenCalled();
  });

  it("numbers sentence steps and shows raw statements as code", async () => {
    describeAppTestsMock.mockResolvedValue(
      result({
        tests: [
          {
            title: TARGET.title,
            line: TARGET.line,
            truncated: false,
            steps: [
              { kind: "navigation", text: `Go to "/".`, line: 4, depth: 0 },
              {
                kind: "action",
                text: `Click the "Submit" button.`,
                line: 5,
                depth: 0,
              },
              {
                kind: "raw",
                text: "await page.evaluate(() => window.scrollTo(0, 0));",
                line: 6,
                depth: 0,
              },
            ],
          },
        ],
      }),
    );

    renderDialog();

    expect(await screen.findByText(`Click the "Submit" button.`)).toBeTruthy();
    expect(describeAppTestsMock).toHaveBeenCalledWith({
      appId: 1,
      testFile: TARGET.file,
    });

    const list = screen.getByTestId("test-steps-list");
    // Every non-group step is numbered in order.
    expect(
      Array.from(list.querySelectorAll("li")).map(
        (li) =>
          li.textContent?.startsWith("1") ||
          li.textContent?.startsWith("2") ||
          li.textContent?.startsWith("3"),
      ),
    ).toEqual([true, true, true]);

    // The unrecognized statement is shown verbatim, in monospace.
    const raw = screen.getByText(
      "await page.evaluate(() => window.scrollTo(0, 0));",
    );
    expect(raw.className).toContain("font-mono");
  });

  it("matches the test by title when its line has moved", async () => {
    describeAppTestsMock.mockResolvedValue(
      result({
        tests: [
          {
            title: TARGET.title,
            // The spec was edited, so the test now starts on a different line.
            line: 42,
            truncated: false,
            steps: [
              { kind: "navigation", text: `Go to "/".`, line: 43, depth: 0 },
            ],
          },
        ],
      }),
    );

    renderDialog();

    expect(await screen.findByText(`Go to "/".`)).toBeTruthy();
  });

  it("explains a spec that could not be parsed", async () => {
    describeAppTestsMock.mockResolvedValue(
      result({ parseError: "Unexpected token (3:12)" }),
    );

    renderDialog();

    expect(await screen.findByText(/couldn't be parsed/i)).toBeTruthy();
  });

  it("offers a retry when the read fails", async () => {
    describeAppTestsMock.mockRejectedValue(new Error("nope"));

    renderDialog();

    expect(await screen.findByText(/couldn't read this test/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says so when a test has no describable steps", async () => {
    describeAppTestsMock.mockResolvedValue(
      result({
        tests: [
          {
            title: TARGET.title,
            line: TARGET.line,
            truncated: false,
            steps: [],
          },
        ],
      }),
    );

    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText(/doesn't perform any steps we can describe/i),
      ).toBeTruthy();
    });
  });
});
