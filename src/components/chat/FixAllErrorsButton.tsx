import { Button } from "@/components/ui/button";
import { useStreamChat } from "@/hooks/useStreamChat";
import { Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";

interface FixAllErrorsButtonProps {
  errorMessages: string[];
  chatId: number;
}

export function FixAllErrorsButton({
  errorMessages,
  chatId,
}: FixAllErrorsButtonProps) {
  const { streamMessage } = useStreamChat();
  const [isLoading, setIsLoading] = useState(false);

  const handleFixAllErrors = () => {
    setIsLoading(true);
    const allErrors = errorMessages
      .map((msg, i) => `${i + 1}. ${msg}`)
      .join("\n");

    streamMessage({
      prompt: `Fix all of the following errors:\n\n${allErrors}`,
      chatId,
      onSettled: () => setIsLoading(false),
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isLoading}
      onClick={handleFixAllErrors}
      className="bg-red-50 hover:bg-red-100 dark:bg-red-950 dark:hover:bg-red-900 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 ml-auto hover:cursor-pointer"
    >
      {isLoading ? (
        <Loader2 size={16} className="mr-1 animate-spin" />
      ) : (
        <Sparkles size={16} className="mr-1" />
      )}
      Fix All Errors ({errorMessages.length})
    </Button>
  );
}
