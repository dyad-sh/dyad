import { IpcClient } from "@/ipc/ipc_client";
import React from "react";

// Types for the message system
export interface TextSpan {
  type: "text";
  content: string;
}

export interface LinkSpan {
  type: "link";
  content: string;
  url?: string;
  action?: () => void;
}

export type MessageSpan = TextSpan | LinkSpan;

export interface MessageConfig {
  spans: MessageSpan[];
}

// Generic Message component
export function Message({ spans }: MessageConfig) {
  return (
    <div className="max-w-3xl mx-auto mt-4 py-2 px-1 border border-blue-500 rounded-lg bg-blue-50 text-center">
      <p className="text-sm text-blue-700">
        {spans.map((span, index) => {
          if (span.type === "text") {
            return <span key={index}>{span.content}</span>;
          } else if (span.type === "link") {
            return (
              <a
                key={index}
                onClick={() => {
                  if (span.action) {
                    span.action();
                  } else if (span.url) {
                    IpcClient.getInstance().openExternalUrl(span.url);
                  }
                }}
                className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
              >
                {span.content}
              </a>
            );
          }
          return null;
        })}
      </p>
    </div>
  );
}

// Predefined message configurations
export const TURBO_EDITS_PROMO_MESSAGE: MessageConfig = {
  spans: [
    { type: "text", content: "Tired of waiting on AI?" },
    { type: "link", content: " Get Dyad Pro", url: "https://dyad.sh/pro#ai" },
    { type: "text", content: " for faster edits with Turbo Edits." },
  ],
};

export const SMART_CONTEXT_PROMO_MESSAGE: MessageConfig = {
  spans: [
    { type: "text", content: "Save up to 5x on AI costs with " },
    {
      type: "link",
      content: "Dyad Pro's Smart Context",
      url: "https://dyad.sh/pro#ai",
    },
  ],
};

// Example of other message types you could easily add
export const DIFFERENT_MODEL_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Getting stuck in a debugging loop? Try a different model.",
    },
  ],
};

export const REDDIT_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Join 600+ builders in the ",
    },
    {
      type: "link",
      content: "Dyad subreddit",
      url: "https://www.reddit.com/r/dyadbuilders/",
    },
  ],
};

export const REPORT_A_BUG_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Found a bug? Click Help > Report a Bug",
    },
  ],
};

export const UPLOAD_CHAT_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content:
        "Want to report a bad AI response? Upload the chat by clicking Help",
    },
  ],
};
// https://www.youtube.com/watch?v=a7OoruOkkeg&list=PL1xR2pfIiRlW7mgr9AS95OkFQBtvrSlO5
export const BUILD_A_BIBLE_APP_TIP: MessageConfig = {
  spans: [
    {
      type: "link",
      content: "Watch",
      url: "https://www.youtube.com/watch?v=a7OoruOkkeg&list=PL1xR2pfIiRlW7mgr9AS95OkFQBtvrSlO5",
    },
    {
      type: "text",
      content: " the creator of Dyad build a Bible app step-by-step",
    },
  ],
};

export const DEBUGGING_TIPS_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Getting stuck? Read our ",
    },
    {
      type: "link",
      content: "debugging tips",
      url: "https://www.dyad.sh/docs/guides/debugging",
    },
  ],
};

// Advanced tip: Customize your AI rules https://www.dyad.sh/docs/guides/ai-rules
export const AI_RULES_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Advanced tip: Customize your ",
    },
    {
      type: "link",
      content: "AI rules",
      url: "https://www.dyad.sh/docs/guides/ai-rules",
    },
  ],
};

export const NEW_CHAT_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Want to keep the AI focused? Start a new chat.",
    },
  ],
};

// Want to know what's next? Checkout our roadmap https://www.dyad.sh/docs/roadmap
export const ROADMAP_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Want to know what's next? Check out our ",
    },
    {
      type: "link",
      content: "roadmap",
      url: "https://www.dyad.sh/docs/roadmap",
    },
  ],
};

// Like Dyad? Star it on GitHub https://github.com/dyad-sh/dyad/
export const GITHUB_TIP: MessageConfig = {
  spans: [
    {
      type: "text",
      content: "Like Dyad? Star it on ",
    },
    {
      type: "link",
      content: "GitHub",
      url: "https://github.com/dyad-sh/dyad",
    },
  ],
};
// Array of all available messages for rotation
const ALL_MESSAGES = [
  TURBO_EDITS_PROMO_MESSAGE,
  SMART_CONTEXT_PROMO_MESSAGE,
  DIFFERENT_MODEL_TIP,
  REDDIT_TIP,
  REPORT_A_BUG_TIP,
  UPLOAD_CHAT_TIP,
  BUILD_A_BIBLE_APP_TIP,
  DEBUGGING_TIPS_TIP,
  AI_RULES_TIP,
  NEW_CHAT_TIP,
  ROADMAP_TIP,
  GITHUB_TIP,
];

// Main PromoMessage component using the modular system
export function PromoMessage({ seed }: { seed: number }) {
  const hashedSeed = hashNumber(seed);
  const randomMessage = ALL_MESSAGES[hashedSeed % ALL_MESSAGES.length];
  return <Message {...randomMessage} />;
}

/**
 * Hashes a 32-bit integer using a variant of the MurmurHash3 algorithm.
 * This function is designed to produce a good, random-like distribution
 * of hash values, which is crucial for data structures like hash tables.
 * @param {number} key - The integer to hash.
 * @returns {number} A 32-bit integer hash.
 */
function hashNumber(key: number): number {
  // Ensure the key is treated as an integer.
  let i = key | 0;

  // MurmurHash3's mixing function (fmix32)
  // It uses a series of bitwise multiplications, shifts, and XORs
  // to thoroughly mix the bits of the input key.

  // XOR with a shifted version of itself to start mixing bits.
  i ^= i >>> 16;
  // Multiply by a large prime to further scramble bits.
  i = Math.imul(i, 0x85ebca6b);
  // Another XOR shift.
  i ^= i >>> 13;
  // Another prime multiplication.
  i = Math.imul(i, 0xc2b2ae35);
  // Final XOR shift to get the final mix.
  i ^= i >>> 16;

  // Return the result as an unsigned 32-bit integer.
  return i >>> 0;
}
