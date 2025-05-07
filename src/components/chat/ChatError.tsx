import { XCircle, AlertTriangle } from "lucide-react"; // Assuming lucide-react is used

interface ChatErrorProps {
  error: string | null;
  onDismiss: () => void;
}

export function ChatError({ error, onDismiss }: ChatErrorProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="relative flex items-start text-red-600 bg-red-100 border border-red-500 rounded-md text-sm p-3 mx-4 mb-2 shadow-sm">
      <AlertTriangle
        className="h-5 w-5 mr-2 flex-shrink-0"
        aria-hidden="true"
      />
      <span className="flex-1">{error}</span>
      <button
        onClick={onDismiss}
        className="absolute top-1 right-1 p-1 rounded-full hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-400"
        aria-label="Dismiss error"
      >
        <XCircle className="h-4 w-4 text-red-500 hover:text-red-700" />
      </button>
    </div>
  );
}
