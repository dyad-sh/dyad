import { describe, expect, it, vi } from "vitest";
import { StreamingSentenceBuffer } from "@/shared/jarvis/sentence_buffer";

function collect() {
  const chunks: string[] = [];
  const buffer = new StreamingSentenceBuffer({
    onFlush: (text) => chunks.push(text),
  });
  return { chunks, buffer };
}

describe("StreamingSentenceBuffer", () => {
  it("flushes at sentence boundaries as deltas arrive", () => {
    const { chunks, buffer } = collect();
    for (const delta of [
      "Opening ",
      "the coding ",
      "agent. ",
      "It is ready.",
    ]) {
      buffer.push(delta);
    }
    expect(chunks).toEqual(["Opening the coding agent."]);

    buffer.finish();
    expect(chunks).toEqual(["Opening the coding agent.", "It is ready."]);
  });

  it("does not split a decimal number into two utterances", () => {
    const { chunks, buffer } = collect();
    buffer.push("The build took 3.5 seconds to complete. ");
    expect(chunks).toEqual(["The build took 3.5 seconds to complete."]);
  });

  it("never emits a partial word when forced to flush a long buffer", () => {
    const { chunks, buffer } = collect();
    const longText = `${"situation ".repeat(30)}`;
    buffer.push(longText);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      // Every emitted token must be a complete word.
      for (const word of chunk.split(/\s+/)) {
        expect(word === "" || word === "situation").toBe(true);
      }
    }
  });

  it("keeps closing punctuation with its sentence", () => {
    const { chunks, buffer } = collect();
    buffer.push('She said "run the tests." Then it passed. ');
    expect(chunks[0]).toBe('She said "run the tests."');
  });

  it("emits nothing after cancel, including on finish", () => {
    const onFlush = vi.fn();
    const buffer = new StreamingSentenceBuffer({ onFlush });

    buffer.push("Deleting the project");
    buffer.cancel();
    buffer.push(" cannot be undone. ");
    buffer.finish();

    expect(onFlush).not.toHaveBeenCalled();
    expect(buffer.pending).toBe("");
  });

  it("flushes the tail on finish even without punctuation", () => {
    const { chunks, buffer } = collect();
    buffer.push("Three files changed");
    expect(chunks).toEqual([]);

    buffer.finish();
    expect(chunks).toEqual(["Three files changed"]);
  });

  it("handles multiple sentences arriving in one delta", () => {
    const { chunks, buffer } = collect();
    buffer.push("First done. Second done. Third pending");
    expect(chunks).toEqual(["First done.", "Second done."]);
  });
});
