import { describe, expect, it } from "vitest";

import { updateTodosTool } from "./update_todos";

describe("updateTodosTool", () => {
  it("allows testing and investigation when they are meaningful tasks", () => {
    expect(updateTodosTool.description).toContain(
      "when they merely support a higher-level task",
    );
    expect(updateTodosTool.description).toContain(
      "when the user explicitly requested it",
    );
    expect(updateTodosTool.description).not.toContain(
      "NEVER INCLUDE THESE IN TODOS",
    );
  });
});
