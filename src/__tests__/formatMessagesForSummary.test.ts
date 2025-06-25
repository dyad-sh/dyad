import { formatMessagesForSummary } from "../ipc/handlers/chat_stream_handlers";

describe("formatMessagesForSummary", () => {
  it("should return all messages when there are 8 or fewer messages", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
      { role: "assistant", content: "I'm doing well, thanks!" },
    ];

    const result = formatMessagesForSummary(messages);
    const expected = [
      '<message role="user">Hello</message>',
      '<message role="assistant">Hi there!</message>',
      '<message role="user">How are you?</message>',
      '<message role="assistant">I\'m doing well, thanks!</message>',
    ].join("\n");

    expect(result).toBe(expected);
  });

  it("should return all messages when there are exactly 8 messages", () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    }));

    const result = formatMessagesForSummary(messages);
    const expected = messages
      .map((m) => `<message role="${m.role}">${m.content}</message>`)
      .join("\n");

    expect(result).toBe(expected);
  });

  it("should truncate messages when there are more than 8 messages", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    }));

    const result = formatMessagesForSummary(messages);

    // Should contain first 2 messages
    expect(result).toContain('<message role="user">Message 1</message>');
    expect(result).toContain('<message role="assistant">Message 2</message>');

    // Should contain omission indicator
    expect(result).toContain(
      '<message role="system">[... 4 messages omitted ...]</message>',
    );

    // Should contain last 6 messages
    expect(result).toContain('<message role="user">Message 7</message>');
    expect(result).toContain('<message role="assistant">Message 8</message>');
    expect(result).toContain('<message role="user">Message 9</message>');
    expect(result).toContain('<message role="assistant">Message 10</message>');
    expect(result).toContain('<message role="user">Message 11</message>');
    expect(result).toContain('<message role="assistant">Message 12</message>');

    // Should not contain middle messages
    expect(result).not.toContain('<message role="user">Message 3</message>');
    expect(result).not.toContain(
      '<message role="assistant">Message 4</message>',
    );
    expect(result).not.toContain('<message role="user">Message 5</message>');
    expect(result).not.toContain(
      '<message role="assistant">Message 6</message>',
    );
  });

  it("should handle messages with undefined content", () => {
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: undefined },
      { role: "user", content: "Are you there?" },
    ];

    const result = formatMessagesForSummary(messages);
    const expected = [
      '<message role="user">Hello</message>',
      '<message role="assistant">undefined</message>',
      '<message role="user">Are you there?</message>',
    ].join("\n");

    expect(result).toBe(expected);
  });

  it("should handle empty messages array", () => {
    const messages: { role: string; content: string | undefined }[] = [];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe("");
  });

  it("should handle single message", () => {
    const messages = [{ role: "user", content: "Hello world" }];
    const result = formatMessagesForSummary(messages);
    expect(result).toBe('<message role="user">Hello world</message>');
  });

  it("should correctly calculate omitted messages count", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    }));

    const result = formatMessagesForSummary(messages);

    // Should indicate 12 messages omitted (20 total - 2 first - 6 last = 12)
    expect(result).toContain(
      '<message role="system">[... 12 messages omitted ...]</message>',
    );
  });

  it("should handle messages with special characters in content", () => {
    const messages = [
      { role: "user", content: 'Hello <world> & "friends"' },
      { role: "assistant", content: "Hi there! <tag>content</tag>" },
    ];

    const result = formatMessagesForSummary(messages);

    // Should preserve special characters as-is (no HTML escaping)
    expect(result).toContain(
      '<message role="user">Hello <world> & "friends"</message>',
    );
    expect(result).toContain(
      '<message role="assistant">Hi there! <tag>content</tag></message>',
    );
  });

  it("should maintain message order in truncated output", () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    }));

    const result = formatMessagesForSummary(messages);
    const lines = result.split("\n");

    // Should have exactly 9 lines (2 first + 1 omission + 6 last)
    expect(lines).toHaveLength(9);

    // Check order: first 2, then omission, then last 6
    expect(lines[0]).toBe('<message role="user">Message 1</message>');
    expect(lines[1]).toBe('<message role="assistant">Message 2</message>');
    expect(lines[2]).toBe(
      '<message role="system">[... 7 messages omitted ...]</message>',
    );

    // Last 6 messages are messages 10-15 (indices 9-14)
    // Message 10 (index 9): 9 % 2 === 1, so "assistant"
    // Message 11 (index 10): 10 % 2 === 0, so "user"
    // Message 12 (index 11): 11 % 2 === 1, so "assistant"
    // Message 13 (index 12): 12 % 2 === 0, so "user"
    // Message 14 (index 13): 13 % 2 === 1, so "assistant"
    // Message 15 (index 14): 14 % 2 === 0, so "user"
    expect(lines[3]).toBe('<message role="assistant">Message 10</message>');
    expect(lines[4]).toBe('<message role="user">Message 11</message>');
    expect(lines[5]).toBe('<message role="assistant">Message 12</message>');
    expect(lines[6]).toBe('<message role="user">Message 13</message>');
    expect(lines[7]).toBe('<message role="assistant">Message 14</message>');
    expect(lines[8]).toBe('<message role="user">Message 15</message>');
  });
});
