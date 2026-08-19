import { describe, expect, it } from "vitest";

import {
  buildCanvaFailureAssistantMessage,
  buildCanvaToolPresentation,
} from "./canva_mcp_presentations";

describe("Canva MCP design presentations", () => {
  it("surfaces direct Canva quota errors instead of hiding them", () => {
    expect(
      buildCanvaToolPresentation("generate-design", {
        content: [
          {
            type: "text",
            text: "Error: User has reached their quota limit (Request ID: request-1)\n\nNeed help? Contact Canva support.",
          },
        ],
        isError: true,
        _errorMeta: { code: "quota_exceeded" },
      }),
    ).toMatchObject({
      kind: "canva-designs",
      status: "failed",
      errorCode: "quota_exceeded",
      errorMessage:
        "Error: User has reached their quota limit (Request ID: request-1)",
      designs: [],
    });
  });

  it("normalizes generated design candidates from wrapped MCP content", () => {
    const result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            candidates: [
              {
                candidate_id: "candidate-1",
                title: "Quarterly launch deck",
                prompt: "A polished product launch presentation",
                thumbnail_url: "https://cdn.canva.com/launch.png",
                design_type: "presentation",
                page_count: 12,
              },
            ],
          }),
        },
      ],
    };

    expect(buildCanvaToolPresentation("generate-design", result)).toEqual({
      kind: "canva-designs",
      toolName: "generate-design",
      heading: "Choose a Canva design",
      status: "success",
      designs: [
        expect.objectContaining({
          id: "candidate-1",
          title: "Quarterly launch deck",
          candidate: true,
          designType: "presentation",
          pageCount: 12,
          thumbnailUrl: "https://cdn.canva.com/launch.png",
        }),
      ],
    });
  });

  it("normalizes Canva's asynchronous generation response exactly", () => {
    expect(
      buildCanvaToolPresentation("generate-design", {
        job: {
          id: "job-1",
          status: "success",
          result: {
            generated_designs: [
              {
                candidate_id: "candidate-live-1",
                url: "https://www.canva.com/d/candidate-live-1",
                thumbnails: [
                  { url: "https://design.canva.ai/candidate-live-1" },
                ],
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      kind: "canva-designs",
      jobId: "job-1",
      status: "success",
      designs: [
        {
          id: "candidate-live-1",
          candidate: true,
          viewUrl: "https://www.canva.com/d/candidate-live-1",
          thumbnailUrl: "https://design.canva.ai/candidate-live-1",
        },
      ],
    });
  });

  it("turns a failed generation job into a retryable native result", () => {
    expect(
      buildCanvaToolPresentation("generate-design", {
        job: {
          id: "job-failed-1",
          status: "failed",
          error: {
            code: "generation_failed",
            message: "The design generator could not complete this brief.",
          },
        },
      }),
    ).toEqual({
      kind: "canva-designs",
      toolName: "generate-design",
      heading: "Canva generation needs another try",
      jobId: "job-failed-1",
      status: "failed",
      errorCode: "generation_failed",
      errorMessage: "The design generator could not complete this brief.",
      designs: [],
    });
  });

  it("preserves a string failure reason from Canva", () => {
    expect(
      buildCanvaToolPresentation("generate-design", {
        job: {
          id: "job-failed-string",
          status: "failed",
          error: "Design generation failed upstream",
        },
      }),
    ).toMatchObject({
      status: "failed",
      jobId: "job-failed-string",
      errorMessage: "Design generation failed upstream",
    });
  });

  it("normalizes a created design summary and Canva URLs", () => {
    expect(
      buildCanvaToolPresentation("create-design-from-candidate", {
        structuredContent: {
          design_summary: {
            id: "design-1",
            title: "Campaign presentation",
            urls: {
              edit: "https://www.canva.com/design/design-1/edit",
              view: "https://www.canva.com/design/design-1/view",
            },
            pages: [{ id: "page-1" }, { id: "page-2" }],
          },
        },
      }),
    ).toMatchObject({
      kind: "canva-designs",
      heading: "Canva design created",
      designs: [
        {
          id: "design-1",
          title: "Campaign presentation",
          candidate: false,
          editUrl: "https://www.canva.com/design/design-1/edit",
          viewUrl: "https://www.canva.com/design/design-1/view",
          pageCount: 2,
        },
      ],
    });
  });

  it("leaves unrelated Canva tools on the normal tool renderer", () => {
    expect(
      buildCanvaToolPresentation("upload-asset", { id: "asset-1" }),
    ).toBeUndefined();
  });

  it("writes a trusted quota explanation for a terminal Canva failure", () => {
    expect(
      buildCanvaFailureAssistantMessage({
        kind: "canva-designs",
        toolName: "generate-design",
        heading: "Canva generation needs attention",
        status: "failed",
        errorCode: "quota_exceeded",
        retryable: false,
        designs: [],
      }),
    ).toContain("reached its AI generation quota");
  });

  it("does not replace model text while the native result is retryable", () => {
    expect(
      buildCanvaFailureAssistantMessage({
        kind: "canva-designs",
        toolName: "generate-design",
        heading: "Canva generation needs another try",
        status: "failed",
        retryable: true,
        designs: [],
      }),
    ).toBeUndefined();
  });

  it("stops repeated upstream failures without suggesting another retry", () => {
    const message = buildCanvaFailureAssistantMessage({
      kind: "canva-designs",
      toolName: "generate-design",
      heading: "Canva couldn't finish this design",
      status: "failed",
      errorCode: "design_generation_error",
      retryable: false,
      designs: [],
    });

    expect(message).toContain("stopped after two attempts");
    expect(message).not.toContain("Retry in Canva");
  });
});
