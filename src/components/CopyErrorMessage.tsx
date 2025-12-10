import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface CopyErrorMessageProps {
  errorMessage: string;
  className?: string;
}

export const CopyErrorMessage = ({
  errorMessage,
  className = "",
}: CopyErrorMessageProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(errorMessage);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error message:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        isCopied
          ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
          : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
      } ${className}`}
      title={isCopied ? "Copied!" : "Copy error message"}
    >
      {isCopied ? (
        <>
          <Check size={14} />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={14} />
          <span>Copy</span>
        </>
      )}
    </button>
  );
};
