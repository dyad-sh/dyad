import { useState, useRef, useEffect } from "react";
import { formatDyadContentToMarkdown } from "@/lib/formatDyadContent";
export const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copyMessageContent = async (messageContent: string) => {
    try {
      const formattedContent = formatDyadContentToMarkdown(messageContent);

      // Copy to clipboard
      await navigator.clipboard.writeText(formattedContent);

      setCopied(true);
      // Clear existing timeout if any
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Set new timeout and store reference
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
      return true;
    } catch (error) {
      console.error("Failed to copy content:", error);
      return false;
    }
  };

  return { copyMessageContent, copied };
};
