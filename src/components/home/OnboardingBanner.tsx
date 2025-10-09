import { IpcClient } from "@/ipc/ipc_client";
import { Play } from "lucide-react";

export const OnboardingBanner = ({
  isVisible,
  setIsVisible,
}: {
  isVisible: boolean;
  setIsVisible: (isVisible: boolean) => void;
}) => {
  if (!isVisible) return null;

  return (
    // <div className="fixed top-0 left-0 right-0 z-50 flex justify-center mt-2">
    <div className="max-w-xl w-full mx-4 relative mb-4">
      <a
        onClick={(e) => {
          e.preventDefault();
          IpcClient.getInstance().openExternalUrl(
            "https://www.youtube.com/watch?v=rgdNoHLaRN4",
          );
          setIsVisible(false);
        }}
        target="_blank"
        rel="noopener noreferrer"
        className="cursor-pointer block bg-(--background-lightest) border border-border rounded-lg shadow-lg hover:bg-accent transition-colors"
      >
        <div className="flex items-center">
          <div className="relative p-2">
            <img
              src="https://img.youtube.com/vi/rgdNoHLaRN4/maxresdefault.jpg"
              alt="Get started with Dyad in 3 minutes"
              className="w-28 h-16 object-cover rounded-md"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 bg-background rounded-full flex items-center justify-center shadow-md">
                <Play size={20} className="text-foreground ml-0.5" />
              </div>
            </div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="text-foreground">
              <p className="font-semibold text-base">
                Get started with Dyad in 3 minutes
              </p>
              <p className="text-sm text-muted-foreground">
                Start building your app for free
              </p>
            </div>
          </div>
        </div>
      </a>
    </div>
    // </div>
  );
};
