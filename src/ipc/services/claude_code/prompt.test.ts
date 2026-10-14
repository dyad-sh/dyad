import { expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { claudeConversation } from "./prompt";

it.each([
  {
    type: "file" as const,
    mediaType: "image/png",
    data: "x".repeat(8 * 1024 * 1024 + 1),
  },
  { type: "file" as const, mediaType: "application/zip", data: "eA==" },
  { type: "text" as const, text: "x".repeat(256 * 1024 + 1) },
])("classifies user attachment/context refusals as validation", (part) => {
  expect(() =>
    claudeConversation([{ role: "user", content: [part] }], false),
  ).toThrow(expect.objectContaining({ kind: DyadErrorKind.Validation }));
});

it("classifies unresolved attachment URLs as validation without fetching", () => {
  expect(() =>
    claudeConversation(
      [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: new URL("https://example.test/image.png"),
            },
          ],
        },
      ],
      false,
    ),
  ).toThrow(expect.objectContaining({ kind: DyadErrorKind.Validation }));
});

it("bounds the complete UTF-8 prompt including oversized questionnaire recovery", () => {
  const recovery = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    outcome: "answered",
    answers: { label: "🌍".repeat(20000) },
  }));
  recovery.push({
    id: 50,
    outcome: "answered",
    answers: { label: "latest answer" },
  });
  const result = claudeConversation(
    [
      { role: "user", content: [{ type: "text", text: "🌍".repeat(70000) }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "previous response" }],
      },
      { role: "user", content: [{ type: "text", text: "latest request" }] },
    ],
    false,
    recovery,
  );
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(256 * 1024);
  expect(result.text).toContain("latest answer");
  expect(result.text).toContain("latest request");
  expect(result.text).toContain("questionnaire outcomes omitted");
  expect(result.text).not.toContain("🌍".repeat(20000));
});
