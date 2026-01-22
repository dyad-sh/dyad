import { IpcClient } from "@/ipc/ipc_client";
import { BookOpen, Sparkles } from "lucide-react";

export const OnboardingBanner = ({
  isVisible,
  setIsVisible,
}: {
  isVisible: boolean;
  setIsVisible: (isVisible: boolean) => void;
}) => {
  if (!isVisible) return null;

  return (
    <div className="max-w-xl w-full mx-4 relative mb-4">
      <a
        onClick={(e) => {
          e.preventDefault();
          IpcClient.getInstance().openExternalUrl(
            "https://github.com/yosiwizman/abba-ai#readme",
          );
          setIsVisible(false);
        }}
        target="_blank"
        rel="noopener noreferrer"
        className="cursor-pointer block bg-(--background-lightest) border border-border rounded-lg shadow-lg hover:bg-accent transition-colors"
      >
        <div className="flex items-center">
          <div className="relative p-4">
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md">
              <Sparkles size={32} className="text-white" />
            </div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="text-foreground">
              <p className="font-semibold text-base">
                Get started with ABBA AI
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <BookOpen size={14} />
                Read the documentation
              </p>
            </div>
          </div>
        </div>
      </a>
    </div>
  );
};
