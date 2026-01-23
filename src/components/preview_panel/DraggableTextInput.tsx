import React, { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

interface DraggableTextInputProps {
  input: {
    id: string;
    x: number;
    y: number;
    adjustedX: number;
    adjustedY: number;
    value: string;
  };
  index: number;
  totalInputs: number;
  scale: number;
  onMove: (
    id: string,
    x: number,
    y: number,
    adjustedX: number,
    adjustedY: number,
  ) => void;
  onChange: (id: string, value: string) => void;
  onKeyDown: (id: string, e: React.KeyboardEvent, index: number) => void;
  onRemove: (id: string) => void;
  spanRef: React.MutableRefObject<HTMLSpanElement[]>;
  inputRef: React.MutableRefObject<HTMLInputElement[]>;
  color: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export const DraggableTextInput = ({
  input,
  index,
  totalInputs,
  scale,
  onMove,
  onChange,
  onKeyDown,
  onRemove,
  spanRef,
  inputRef,
  color,
  containerRef,
}: DraggableTextInputProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDragging && containerRef?.current && elementRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const elementRect = elementRef.current.getBoundingClientRect();

        let newX = e.clientX - dragOffset.current.x;
        let newY = e.clientY - dragOffset.current.y;

        // Constrain within container bounds
        newX = Math.max(
          0,
          Math.min(newX, containerRect.width - elementRect.width),
        );
        newY = Math.max(
          0,
          Math.min(newY, containerRect.height - elementRect.height),
        );

        // Calculate adjusted coordinates for the canvas
        const adjustedX = newX / scale;
        const adjustedY = newY / scale;
        onMove(input.id, newX, newY, adjustedX, adjustedY);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, input.id, onMove, scale, containerRef]);

  return (
    <div
      ref={elementRef}
      className="absolute z-[999]"
      style={{
        left: `${input.x}px`,
        top: `${input.y}px`,
      }}
    >
      <div className="relative">
        {/* Drag Handle */}
        <div
          className="absolute left-2 top-1/2 -translate-y-1/2 cursor-move p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors z-10"
          onMouseDown={(e) => {
            setIsDragging(true);
            dragOffset.current = {
              x: e.clientX - input.x,
              y: e.clientY - input.y,
            };
            e.preventDefault();
            e.stopPropagation();
          }}
          title="Drag to move"
        >
          {/* Grip dots icon - smaller and more subtle */}
          <svg
            width="8"
            height="12"
            viewBox="0 0 8 12"
            fill="currentColor"
            className="text-gray-400 dark:text-gray-500"
          >
            <circle cx="2" cy="2" r="1" />
            <circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="2" cy="10" r="1" />
            <circle cx="6" cy="10" r="1" />
          </svg>
        </div>

        <span
          ref={(e) => {
            if (e) spanRef.current[index] = e;
          }}
          className="
          absolute
          invisible
          whitespace-pre
          text-base
          font-normal
        "
        ></span>
        <input
          autoFocus={index === totalInputs - 1}
          type="text"
          value={input.value}
          onChange={(e) => onChange(input.id, e.target.value)}
          onKeyDown={(e) => onKeyDown(input.id, e, index)}
          className="pl-8 pr-8 py-2 bg-[var(--background)] border-2 rounded-md shadow-lg text-gray-900 dark:text-gray-100 focus:outline-none min-w-[200px] cursor-text"
          style={{ borderColor: color }}
          placeholder="Type text..."
          ref={(e) => {
            if (e) inputRef.current[index] = e;
          }}
        />

        {/* Close Button - Rightmost */}
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors z-10 group"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove(input.id);
          }}
          title="Remove text input"
          type="button"
        >
          <X className="w-3 h-3 text-gray-400 dark:text-gray-500 group-hover:text-red-600 dark:group-hover:text-red-400" />
        </button>
      </div>
    </div>
  );
};
