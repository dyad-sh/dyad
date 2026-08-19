import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatAgentCanvaDesignCards } from "./ChatAgentCanvaDesignCards";

describe("Canva design cards", () => {
  it("presents generated candidates as human concepts with a continuation action", async () => {
    const user = userEvent.setup();
    const onSelectCandidate = vi.fn();
    render(
      <ChatAgentCanvaDesignCards
        presentation={{
          kind: "canva-designs",
          toolName: "generate-design",
          heading: "Choose a Canva design",
          jobId: "job-1",
          designs: [
            {
              id: "candidate-1",
              title: "Canva design candidate-1",
              candidate: true,
              viewUrl: "https://www.canva.com/d/candidate-1",
            },
          ],
        }}
        onSelectCandidate={onSelectCandidate}
      />,
    );

    expect(screen.getByText("Your Canva concepts are ready")).toBeTruthy();
    expect(screen.getByText("Concept 1")).toBeTruthy();
    expect(screen.queryByText(/candidate-1/)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Choose this design" }),
    );
    expect(onSelectCandidate).toHaveBeenCalledWith({
      jobId: "job-1",
      candidateId: "candidate-1",
      conceptNumber: 1,
    });
  });

  it("shows a clear edit action for the final Canva design", () => {
    render(
      <ChatAgentCanvaDesignCards
        presentation={{
          kind: "canva-designs",
          toolName: "create-design-from-candidate",
          heading: "Canva design created",
          designs: [
            {
              id: "design-1",
              title: "AI fitness presentation",
              editUrl: "https://www.canva.com/d/design-1/edit",
              candidate: false,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Your Canva design is ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Edit in Canva/ })).toBeTruthy();
  });

  it("explains failed Canva jobs and lets the user retry", async () => {
    const user = userEvent.setup();
    const onRetryGeneration = vi.fn();
    render(
      <ChatAgentCanvaDesignCards
        presentation={{
          kind: "canva-designs",
          toolName: "generate-design",
          heading: "Canva generation needs another try",
          jobId: "job-failed-1",
          status: "failed",
          errorCode: "generation_failed",
          errorMessage: "The generator could not complete this brief.",
          designs: [],
        }}
        onRetryGeneration={onRetryGeneration}
      />,
    );

    expect(screen.getByText("Canva couldn’t finish this design")).toBeTruthy();
    expect(
      screen.getByText("The generator could not complete this brief."),
    ).toBeTruthy();
    expect(screen.getByText("Error: generation_failed")).toBeTruthy();
    expect(screen.getByText("Job: job-failed-1")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Retry simpler brief" }),
    );
    expect(onRetryGeneration).toHaveBeenCalledOnce();
  });

  it("explains quota failures and does not offer another retry", () => {
    render(
      <ChatAgentCanvaDesignCards
        presentation={{
          kind: "canva-designs",
          toolName: "generate-design",
          heading: "Canva generation needs attention",
          status: "failed",
          errorCode: "quota_exceeded",
          errorMessage: "User has reached their quota limit",
          designs: [],
        }}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(screen.getByText("Canva generation quota reached")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry simpler brief" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Open Canva" })).toBeTruthy();
  });

  it("pauses retries after two generic generation failures", () => {
    render(
      <ChatAgentCanvaDesignCards
        presentation={{
          kind: "canva-designs",
          toolName: "generate-design",
          heading: "Canva generation needs attention",
          status: "failed",
          errorCode: "design_generation_error",
          errorMessage: "Design generation failed",
          retryable: false,
          designs: [],
        }}
        onRetryGeneration={() => undefined}
      />,
    );

    expect(screen.getByText(/Further retries are paused/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Retry simpler brief" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Open Canva" })).toBeTruthy();
  });
});
