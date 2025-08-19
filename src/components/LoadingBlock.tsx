import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { IpcClient } from "@/ipc/ipc_client";

const customLink = ({
  node: _node,
  ...props
}: {
  node?: any;
  [key: string]: any;
}) => (
  <a
    {...props}
    onClick={(e) => {
      const url = props.href;
      if (url) {
        e.preventDefault();
        IpcClient.getInstance().openExternalUrl(url);
      }
    }}
  />
);

export const VanillaMarkdownParser = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      components={{
        a: customLink,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

// Chat loader with human-like typing/deleting of rotating messages
function ChatLoader() {
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [typingSpeed, setTypingSpeed] = useState(100);

  const loadingTexts = [
    "Preparing your conversation... 🗨️",
    "Gathering thoughts... 💭",
    "Crafting the perfect response... 🎨",
    "Almost there... 🚀",
    "Just a moment... ⏳",
    "Warming up the neural networks... 🧠",
    "Connecting the dots... 🔗",
    "Brewing some digital magic... ✨",
    "Assembling words with care... 🔤",
    "Fine-tuning the response... 🎯",
    "Diving into deep thought... 🤿",
    "Weaving ideas together... 🕸️",
    "Sparking up the conversation... ⚡",
    "Polishing the perfect reply... 💎",
  ];

  useEffect(() => {
    const currentText = loadingTexts[currentTextIndex];
    const timer = window.setTimeout(() => {
      if (!isDeleting) {
        if (displayText.length < currentText.length) {
          setDisplayText(currentText.substring(0, displayText.length + 1));
          const randomSpeed = Math.random() * 50 + 30;
          const isLongPause = Math.random() > 0.85;
          setTypingSpeed(isLongPause ? 300 : randomSpeed);
        } else {
          setTypingSpeed(1500);
          setIsDeleting(true);
        }
      } else {
        if (displayText.length > 0) {
          setDisplayText(currentText.substring(0, displayText.length - 1));
          setTypingSpeed(30);
        } else {
          setIsDeleting(false);
          setCurrentTextIndex((prev) => (prev + 1) % loadingTexts.length);
          setTypingSpeed(500);
        }
      }
    }, typingSpeed);
    return () => window.clearTimeout(timer);
  }, [displayText, isDeleting, currentTextIndex, typingSpeed]);

  const renderFadingText = () => {
    return displayText.split("").map((char, index) => {
      const opacity = Math.min(
        0.8 + (index / (displayText.length || 1)) * 0.2,
        1,
      );
      const isEmoji = /\p{Emoji}/u.test(char);
      return (
        <span
          key={index}
          style={{ opacity }}
          className={isEmoji ? "inline-block animate-emoji-bounce" : ""}
        >
          {char}
        </span>
      );
    });
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <style>{`
        @keyframes blink { from, to { opacity: 0 } 50% { opacity: 1 } }
        @keyframes emoji-bounce { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        @keyframes text-pulse { 0%, 100% { opacity: .85 } 50% { opacity: 1 } }
        .animate-blink { animation: blink 1s steps(2, start) infinite; }
        .animate-emoji-bounce { animation: emoji-bounce 1.2s ease-in-out infinite; }
        .animate-text-pulse { animation: text-pulse 1.8s ease-in-out infinite; }
      `}</style>
      <div className="text-center animate-text-pulse">
        <div className="inline-block">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
            {renderFadingText()}
            <span className="ml-1 inline-block w-2 h-4 bg-gray-500 dark:bg-gray-400 animate-blink" />
          </p>
        </div>
      </div>
    </div>
  );
}

interface LoadingBlockProps {
  isStreaming?: boolean;
}

// Instead of showing raw thinking content, render the chat loader while streaming.
export function LoadingBlock({ isStreaming = false }: LoadingBlockProps) {
  if (!isStreaming) return null;
  return <ChatLoader />;
}
