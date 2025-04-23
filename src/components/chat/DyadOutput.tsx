import React, { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  AlertTriangle,
  XCircle,
} from "lucide-react";

interface DyadOutputProps {
  type: "error" | "warning";
  message?: string;
  children?: React.ReactNode;
}

export const DyadOutput: React.FC<DyadOutputProps> = ({
  type,
  message,
  children,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  // If the type is not warning, it is an error (in case LLM gives a weird "type")
  const isError = type !== "warning";
  const borderColor = isError ? "border-red-500" : "border-amber-500";
  const iconColor = isError ? "text-red-500" : "text-amber-500";
  const icon = isError ? (
    <XCircle size={16} className={iconColor} />
  ) : (
    <AlertTriangle size={16} className={iconColor} />
  );
  const label = isError ? "Error" : "Warning";

  return (
    <div
      className={`relative bg-(--background-lightest) hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${borderColor}`}
      onClick={() => setIsContentVisible(!isContentVisible)}
    >
      {/* Top-left label badge */}
      <div
        className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${iconColor} bg-white dark:bg-gray-900`}
        style={{ zIndex: 1 }}
      >
        {icon}
        <span>{label}</span>
      </div>
      {/* Main content, padded to avoid label */}
      <div className="flex items-center justify-between pl-20">
        <div className="flex items-center gap-2">
          {message && (
            <span className="text-gray-700 dark:text-gray-300 font-medium text-sm">
              {message.slice(0, isContentVisible ? undefined : 80) +
                (!isContentVisible ? "..." : "")}
            </span>
          )}
        </div>
        <div className="flex items-center">
          {isContentVisible ? (
            <ChevronsDownUp
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          ) : (
            <ChevronsUpDown
              size={20}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            />
          )}
        </div>
      </div>
      {isContentVisible && children && (
        <div className="text-sm mt-2 text-gray-800 dark:text-gray-200 pl-20">
          {children}
        </div>
      )}
    </div>
  );
};
