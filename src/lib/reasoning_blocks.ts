/**
 * Separating a model's thinking from its answer.
 *
 * Local reasoning models emit their working inside `<think>` tags. Left inline
 * it reads as part of the reply — the user sees the model talking to itself
 * about what to do, then doing it, and cannot tell which part was the answer.
 *
 * Streaming makes this harder than a regex: the opening tag arrives before the
 * closing one, so for a while the text is legitimately half a block. During
 * that window everything after `<think>` is thinking, and the answer is
 * whatever came before.
 */

const OPEN = /<think(?:ing)?>/i;
const CLOSE = /<\/think(?:ing)?>/i;

export type ParsedReasoning = {
  /** The model's working. Empty when it did not show any. */
  reasoning: string;
  /** What the user actually asked for. */
  answer: string;
  /** True while a block is still being written. */
  streaming: boolean;
};

export function parseReasoning(text: string): ParsedReasoning {
  if (!text) return { reasoning: "", answer: "", streaming: false };

  const reasoning: string[] = [];
  let answer = "";
  let rest = text;
  let streaming = false;

  while (rest.length > 0) {
    const open = rest.match(OPEN);
    if (!open || open.index === undefined) {
      answer += rest;
      break;
    }

    answer += rest.slice(0, open.index);
    const afterOpen = rest.slice(open.index + open[0].length);
    const close = afterOpen.match(CLOSE);

    if (!close || close.index === undefined) {
      // Still being written: everything after the tag is thinking so far.
      reasoning.push(afterOpen);
      streaming = true;
      break;
    }

    reasoning.push(afterOpen.slice(0, close.index));
    rest = afterOpen.slice(close.index + close[0].length);
  }

  return {
    reasoning: reasoning.join("\n\n").trim(),
    // Collapse the gap a removed block leaves behind.
    answer: answer.replace(/\n{3,}/g, "\n\n").trim(),
    streaming,
  };
}

/** Whether a reply contains any reasoning worth showing separately. */
export function hasReasoning(text: string): boolean {
  return OPEN.test(text);
}
