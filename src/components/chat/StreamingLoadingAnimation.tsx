import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

interface StreamingLoadingAnimationProps {
  variant: "initial" | "streaming";
}

/**
 * A delightful loading animation for chat streaming.
 * - "initial" variant: Shown when waiting for the first response (no content yet)
 * - "streaming" variant: Shown inline when content is being streamed
 */
export function StreamingLoadingAnimation({
  variant,
}: StreamingLoadingAnimationProps) {
  if (variant === "initial") {
    return <InitialLoadingAnimation />;
  }
  return <StreamingIndicator />;
}

const INITIAL_VERBS = [
  "thinking",
  "pondering",
  "reasoning",
  "mulling",
  "noodling",
  "contemplating",
  "daydreaming",
  "meditating",
  "ruminating",
  "wondering",
  "imagining",
  "brainstorming",
];

const STREAMING_VERBS = [
  "brewing",
  "conjuring",
  "cooking",
  "crafting",
  "weaving",
  "assembling",
  "forging",
  "composing",
  "sculpting",
  "distilling",
  "sketching",
  "mixing",
  "painting",
  "stitching",
  "wiring",
  "molding",
  "tuning",
  "polishing",
  "building",
  "shaping",
  "spinning",
  "tinkering",
  "whittling",
  "arranging",
  "rendering",
  "summoning",
  "channeling",
  "unspooling",
  "manifesting",
  "crystallizing",
];

const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const SCRAMBLE_SPEED_MS = 30;
const REVEAL_STAGGER_MS = 60;

function useRotatingVerb(verbs: string[]) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * verbs.length),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % verbs.length);
    }, 5000);
    return () => clearInterval(id);
  }, [verbs]);
  return verbs[index];
}

function useScrambleText(text: string) {
  const [display, setDisplay] = useState(text + "...");
  const rafRef = useRef<number>(0);
  const prevTextRef = useRef(text);

  const scramble = useCallback((target: string) => {
    const len = Math.max(target.length, prevTextRef.current.length);
    const startTime = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const revealed = Math.floor(elapsed / REVEAL_STAGGER_MS);
      let result = "";
      for (let i = 0; i < len; i++) {
        if (i < revealed) {
          result += i < target.length ? target[i] : "";
        } else {
          const scrambleCycle = Math.floor(elapsed / SCRAMBLE_SPEED_MS + i);
          result += SCRAMBLE_CHARS[scrambleCycle % SCRAMBLE_CHARS.length];
        }
      }

      if (revealed >= len) {
        setDisplay(target + "...");
        prevTextRef.current = target;
        return;
      }

      setDisplay(result + "...");
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (text !== prevTextRef.current) {
      scramble(text);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, scramble]);

  return display;
}

function ScrambleVerb({ verb }: { verb: string }) {
  const display = useScrambleText(verb);
  return (
    <span
      className="inline-block text-sm text-muted-foreground"
      aria-hidden="true"
    >
      {display}
    </span>
  );
}

/**
 * A snappy wave animation with monochrome glowing orbs and a rotating verb.
 * Uses spring-like timing for a crisp, bouncy feel.
 */
function InitialLoadingAnimation() {
  const orbs = [0, 1, 2, 3, 4];
  const verb = useRotatingVerb(INITIAL_VERBS);

  return (
    <div className="flex items-center gap-3 p-2">
      <div className="relative flex h-10 items-center justify-start gap-1.5">
        {orbs.map((index) => (
          <motion.div
            key={index}
            className="relative"
            animate={{
              y: [0, -10, 3, -1, 0],
            }}
            transition={{
              duration: 0.8,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: 0.3,
              ease: [0.22, 1.2, 0.36, 1],
              delay: index * 0.07,
            }}
          >
            {/* Soft halo glow */}
            <motion.div
              className="absolute -inset-1 rounded-full blur-md"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--primary) 35%, transparent), transparent 70%)",
              }}
              animate={{
                scale: [1, 1.8, 1],
                opacity: [0.15, 0.4, 0.15],
              }}
              transition={{
                duration: 0.8,
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 0.3,
                ease: "easeOut",
                delay: index * 0.07,
              }}
            />
            {/* Core orb */}
            <motion.div
              className="h-2 w-2 rounded-full bg-primary"
              style={{
                boxShadow:
                  "0 0 6px color-mix(in srgb, var(--primary) 30%, transparent)",
              }}
              animate={{
                scale: [1, 1.3, 0.9, 1],
                opacity: [0.6, 1, 0.8, 0.6],
              }}
              transition={{
                duration: 0.8,
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 0.3,
                ease: [0.22, 1.2, 0.36, 1],
                delay: index * 0.07,
              }}
            />
          </motion.div>
        ))}
      </div>
      <ScrambleVerb verb={verb} />
    </div>
  );
}

// Each bar has its own personality: height range, speed, and phase offset
const BARS = [
  { minH: 5, maxH: 15, duration: 1.0, delay: 0 },
  { minH: 7, maxH: 19, duration: 1.2, delay: 0.12 },
  { minH: 4, maxH: 13, duration: 1.1, delay: 0.25 },
  { minH: 8, maxH: 20, duration: 1.05, delay: 0.08 },
  { minH: 5, maxH: 11, duration: 1.3, delay: 0.3 },
];

/**
 * An organic equalizer-bar animation for the streaming state.
 * Each bar has unique height, speed, and rhythm for a lively, musical feel.
 */
function StreamingIndicator() {
  const verb = useRotatingVerb(STREAMING_VERBS);

  return (
    <div className="mt-3 ml-1 flex items-center gap-2.5">
      <div className="flex h-6 items-end gap-[3px]">
        {BARS.map((bar, i) => (
          <motion.div
            key={i}
            className="w-[3px] rounded-full bg-primary"
            animate={{
              height: [
                bar.minH,
                bar.maxH,
                bar.minH * 1.3,
                bar.maxH * 0.8,
                bar.minH,
              ],
              opacity: [0.45, 1, 0.6, 0.9, 0.45],
            }}
            transition={{
              duration: bar.duration,
              repeat: Number.POSITIVE_INFINITY,
              ease: [0.22, 1.2, 0.36, 1],
              delay: bar.delay,
            }}
          />
        ))}
      </div>
      <ScrambleVerb verb={verb} />
    </div>
  );
}
