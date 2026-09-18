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
