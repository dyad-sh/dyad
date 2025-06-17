import React from "react";
import { toast } from "sonner";
import { X, Copy, Check } from "lucide-react";

interface CustomErrorToastProps {
  message: string;
  toastId: string | number;
  copied?: boolean;
  onCopy?: () => void;
}

export function CustomErrorToast({
  message,
  toastId,
  copied = false,
  onCopy,
}: CustomErrorToastProps) {
  const handleClose = () => {
    toast.dismiss(toastId);
  };

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
    }
  };

  return (
    <div className="relative bg-red-50/95 backdrop-blur-sm border border-red-200 rounded-xl shadow-lg min-w-[400px] max-w-[500px] overflow-hidden">
      {/* Content */}
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="flex items-center mb-3">
              <div className="flex-shrink-0">
                <div className="w-5 h-5 bg-gradient-to-br from-red-400 to-red-500 rounded-full flex items-center justify-center shadow-sm">
                  <X className="w-3 h-3 text-white" />
                </div>
              </div>
              <h3 className="ml-3 text-sm font-medium text-red-900">Error</h3>

              {/* Action buttons */}
              <div className="flex items-center space-x-1.5 ml-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy();
                  }}
                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100/70 rounded-lg transition-all duration-150"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose();
                  }}
                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100/70 rounded-lg transition-all duration-150"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-sm text-red-800 leading-relaxed whitespace-pre-wrap bg-red-100/50 backdrop-blur-sm p-3 rounded-lg border border-red-200/50">
                {message}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
