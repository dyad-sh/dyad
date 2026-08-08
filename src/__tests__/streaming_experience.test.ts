import { describe, expect, it } from "vitest";

import { splitStreamingMarkdown } from "@/lib/streaming_markdown";
import { nextFlushDelay } from "@/lib/streaming_pace";
import {
  animateScrollTo,
  easeOutCubic,
  scrollDurationFor,
} from "@/lib/smooth_scroll";

describe("splitStreamingMarkdown", () => {
  it("keeps finished paragraphs out of the re-rendered part", () => {
    const { stable, trailing } = splitStreamingMarkdown(
      "First paragraph.\n\nSecond one still bein",
    );
    expect(stable).toBe("First paragraph.\n\n");
    expect(trailing).toBe("Second one still bein");
  });

  it("treats a single unfinished paragraph as entirely unsettled", () => {
    const { stable, trailing } = splitStreamingMarkdown("Just starting to");
    expect(stable).toBe("");
    expect(trailing).toBe("Just starting to");
  });

  it("holds an open code fence in the unsettled part", () => {
    // Every new line still belongs to the fence until it closes, so none of it
    // can be memoised yet.
    const content = "Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;";
    const { stable, trailing } = splitStreamingMarkdown(content);
    expect(stable).toBe("Intro.\n\n");
    expect(trailing).toBe("```ts\nconst a = 1;\n\nconst b = 2;");
  });

  it("settles a fence once it closes", () => {
    const content = "```ts\nconst a = 1;\n```\n\nAfter the code";
    const { stable, trailing } = splitStreamingMarkdown(content);
    expect(stable).toBe("```ts\nconst a = 1;\n```\n\n");
    expect(trailing).toBe("After the code");
  });

  it("never loses or reorders a character", () => {
    const samples = [
      "",
      "one",
      "one\n\ntwo\n\nthree",
      "```js\ncode\n```\n\ntail",
      "a\n\n```py\nx = 1\n",
      "# Heading\n\n- a\n- b\n\nnext",
    ];
    for (const sample of samples) {
      const { stable, trailing } = splitStreamingMarkdown(sample);
      expect(stable + trailing).toBe(sample);
    }
  });

  it("grows the settled part monotonically as tokens arrive", () => {
    // The memoised prefix must never shrink, or finished blocks would remount.
    const full = "Alpha para.\n\nBeta para.\n\nGamma still going";
    let previous = 0;
    for (let i = 1; i <= full.length; i += 1) {
      const { stable } = splitStreamingMarkdown(full.slice(0, i));
      expect(stable.length).toBeGreaterThanOrEqual(previous);
      previous = stable.length;
    }
  });
});

describe("nextFlushDelay", () => {
  const steady = () => 0.5;

  it("pauses longest between paragraphs", () => {
    const paragraph = nextFlushDelay({
      growth: 10,
      revealed: "End of thought.\n\n",
      random: steady,
    });
    const sentence = nextFlushDelay({
      growth: 10,
      revealed: "End of thought. ",
      random: steady,
    });
    const midSentence = nextFlushDelay({
      growth: 10,
      revealed: "still going along",
      random: steady,
    });
    expect(paragraph).toBeGreaterThan(sentence);
    expect(sentence).toBeGreaterThan(midSentence);
  });

  it("moves quickly through material that is scanned", () => {
    const list = nextFlushDelay({
      growth: 10,
      revealed: "- a list item",
      random: steady,
    });
    const prose = nextFlushDelay({
      growth: 10,
      revealed: "ordinary prose here",
      random: steady,
    });
    expect(list).toBeLessThan(prose);
  });

  it("speeds up when the stream is running ahead", () => {
    const flooding = nextFlushDelay({
      growth: 400,
      revealed: "text",
      random: steady,
    });
    const trickle = nextFlushDelay({
      growth: 5,
      revealed: "text",
      random: steady,
    });
    expect(flooding).toBeLessThan(trickle);
  });

  it("is never perfectly constant", () => {
    const values = new Set(
      [0.1, 0.4, 0.9].map((r) =>
        nextFlushDelay({ growth: 10, revealed: "text", random: () => r }),
      ),
    );
    expect(values.size).toBeGreaterThan(1);
  });

  it("stays within readable bounds whatever the input", () => {
    for (const revealed of ["", "x", "end.\n\n", "- item", "```"]) {
      for (const growth of [0, 1, 1000]) {
        for (const r of [0, 0.5, 1]) {
          const delay = nextFlushDelay({ growth, revealed, random: () => r });
          expect(delay).toBeGreaterThanOrEqual(12);
          expect(delay).toBeLessThanOrEqual(190);
        }
      }
    }
  });
});

describe("easeOutCubic", () => {
  it("runs from rest to rest", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("decelerates — most of the distance is covered early", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });

  it("clamps outside the unit range", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe("scrollDurationFor", () => {
  it("stays inside the range that reads as deliberate", () => {
    expect(scrollDurationFor(200)).toBeGreaterThanOrEqual(250);
    expect(scrollDurationFor(100_000)).toBeLessThanOrEqual(400);
  });

  it("does not animate a distance too small to see", () => {
    expect(scrollDurationFor(3)).toBe(0);
  });

  it("treats direction as irrelevant", () => {
    expect(scrollDurationFor(-500)).toBe(scrollDurationFor(500));
  });
});

describe("animateScrollTo", () => {
  function fakeElement(scrollTop = 0) {
    return { scrollTop } as HTMLElement;
  }

  /** Drives the animation frame-by-frame on a clock we control. */
  function driver() {
    let time = 0;
    const queue: (() => void)[] = [];
    return {
      now: () => time,
      schedule: (callback: () => void) => {
        queue.push(callback);
        return queue.length;
      },
      cancelScheduled: () => {},
      advance(ms: number) {
        time += ms;
        const due = queue.splice(0, queue.length);
        for (const callback of due) callback();
      },
    };
  }

  it("lands exactly on the target", () => {
    const element = fakeElement(0);
    const clock = driver();
    animateScrollTo(element, 1000, { duration: 300, ...clock });
    clock.advance(300);
    expect(element.scrollTop).toBe(1000);
  });

  it("moves most of the way early, as an ease-out should", () => {
    const element = fakeElement(0);
    const clock = driver();
    animateScrollTo(element, 1000, { duration: 300, ...clock });
    clock.advance(150);
    expect(element.scrollTop).toBeGreaterThan(800);
    expect(element.scrollTop).toBeLessThan(1000);
  });

  it("jumps without animating when the distance is negligible", () => {
    const element = fakeElement(0);
    const clock = driver();
    animateScrollTo(element, 2, clock);
    expect(element.scrollTop).toBe(2);
  });

  it("stops where it was when cancelled", () => {
    // A user grabbing the scrollbar must not be dragged onward.
    const element = fakeElement(0);
    const clock = driver();
    const animation = animateScrollTo(element, 1000, {
      duration: 300,
      ...clock,
    });
    clock.advance(100);
    const interrupted = element.scrollTop;
    animation.cancel();
    clock.advance(300);
    expect(element.scrollTop).toBe(interrupted);
  });
});
