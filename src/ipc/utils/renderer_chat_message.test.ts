import { expect, it } from "vitest";
import {
  toRendererMessage,
  rendererMessageColumns,
  type RendererMessageRow,
} from "./renderer_chat_message";

it("projects the submission identity so history can precede acceptance", () => {
  expect(rendererMessageColumns.chatTurnIntentId).toBe(true);
  const row = {
    id: 10,
    role: "user",
    content: "hello",
    chatTurnIntentId: "intent-1",
  } as RendererMessageRow;
  expect(toRendererMessage(row)).toMatchObject({
    id: 10,
    chatTurnIntentId: "intent-1",
  });
});
