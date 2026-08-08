import { describe, expect, it } from "vitest";

import { hasReasoning, parseReasoning } from "@/lib/reasoning_blocks";

const SAMPLE =
  '<think>\nOkay, the user said "hi". A simple friendly reply would work.\n</think>\nHello! How can I assist you today?';

describe("parseReasoning", () => {
  it("splits the working from the answer", () => {
    const parsed = parseReasoning(SAMPLE);
    expect(parsed.reasoning).toContain("simple friendly reply");
    expect(parsed.answer).toBe("Hello! How can I assist you today?");
    expect(parsed.streaming).toBe(false);
  });

  it("leaves an ordinary reply untouched", () => {
    const parsed = parseReasoning("Just a normal answer.");
    expect(parsed.answer).toBe("Just a normal answer.");
    expect(parsed.reasoning).toBe("");
  });

  it("treats a half-arrived block as thinking, not as the answer", () => {
    // Mid-stream the closing tag has not landed yet. Without this the working
    // would render as the reply and then vanish.
    const parsed = parseReasoning("<think>Still working it out");
    expect(parsed.reasoning).toBe("Still working it out");
    expect(parsed.answer).toBe("");
    expect(parsed.streaming).toBe(true);
  });

  it("keeps text that arrived before the block", () => {
    const parsed = parseReasoning("Sure.<think>checking</think> Done.");
    expect(parsed.answer).toBe("Sure. Done.");
    expect(parsed.reasoning).toBe("checking");
  });

  it("joins several blocks", () => {
    const parsed = parseReasoning("<think>one</think>A<think>two</think>B");
    expect(parsed.reasoning).toBe("one\n\ntwo");
    expect(parsed.answer).toBe("AB");
  });

  it("accepts the <thinking> spelling too", () => {
    const parsed = parseReasoning("<thinking>hmm</thinking>Answer");
    expect(parsed.reasoning).toBe("hmm");
    expect(parsed.answer).toBe("Answer");
  });

  it("is case-insensitive", () => {
    expect(parseReasoning("<THINK>x</THINK>y").answer).toBe("y");
  });

  it("collapses the gap a removed block leaves", () => {
    expect(parseReasoning("A\n\n<think>x</think>\n\n\n\nB").answer).toBe(
      "A\n\nB",
    );
  });

  it("handles an empty string", () => {
    expect(parseReasoning("")).toEqual({
      reasoning: "",
      answer: "",
      streaming: false,
    });
  });

  it("handles a reply that is only thinking", () => {
    const parsed = parseReasoning("<think>all working</think>");
    expect(parsed.answer).toBe("");
    expect(parsed.reasoning).toBe("all working");
  });
});

describe("hasReasoning", () => {
  it("detects a block", () => {
    expect(hasReasoning(SAMPLE)).toBe(true);
    expect(hasReasoning("plain")).toBe(false);
  });
});

describe("what the message row renders", () => {
  /** Mirrors the row: panel only when there is a real answer to separate. */
  /**
   * Mirrors the message row exactly. The previous version of this helper used
   * a different condition than the component, so it passed while the real UI
   * showed "Thinking…" forever with no answer and no explanation.
   */
  const render = (text: string, live = false) => {
    const parsed = parseReasoning(text);
    return {
      showsPanel: Boolean(parsed.reasoning),
      // "Thinking…" only while the reply is genuinely still arriving.
      thinking: parsed.streaming && live,
      body: parsed.answer,
      truncated: Boolean(!parsed.answer && parsed.reasoning && !live),
    };
  };

  it("never prints the raw tag", () => {
    // The bug on screen: the fallback rendered the raw text, so the working
    // appeared twice and the tag was visible.
    for (const sample of [
      "<think>working</think>Answer",
      "<think>unclosed working",
      "plain reply",
    ]) {
      expect(render(sample).body).not.toContain("<think>");
    }
  });

  it("never shows the working twice", () => {
    const view = render("<think>working</think>Answer");
    expect(view.showsPanel).toBe(true);
    expect(view.body).toBe("Answer");
    expect(view.body).not.toContain("working");
  });

  it("does not present truncated working as the answer", () => {
    // qwen3-0.6b spends its whole budget thinking. Showing that as the reply
    // is what made the chat look like it was answering with its notes.
    const view = render("<think>the model ran out of room");
    expect(view.showsPanel).toBe(true);
    expect(view.body).toBe("");
    expect(view.truncated).toBe(true);
  });

  it("stops saying Thinking once the reply has finished", () => {
    // The bug on screen: an unclosed tag left the header pulsing forever.
    const finished = render("<think>never closed", false);
    expect(finished.thinking).toBe(false);
    expect(finished.truncated).toBe(true);
  });

  it("says Thinking only while the reply is still arriving", () => {
    expect(render("<think>working on it", true).thinking).toBe(true);
    expect(render("<think>working on it", true).truncated).toBe(false);
  });

  it("never leaves a finished message with no answer and no explanation", () => {
    // Either there is an answer, or the user is told why there is not.
    for (const sample of ["<think>x</think>y", "<think>x", "y"]) {
      const view = render(sample, false);
      expect(Boolean(view.body) || view.truncated).toBe(true);
    }
  });

  it("leaves a plain reply exactly as written", () => {
    const view = render("Hello! How can I assist you today?");
    expect(view.showsPanel).toBe(false);
    expect(view.body).toBe("Hello! How can I assist you today?");
  });

  it("keeps the working reachable even when there is no answer", () => {
    expect(render("<think>x").showsPanel).toBe(true);
  });
});
