import React, { useState, useRef, useEffect } from "react";

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
  spanRef: React.MutableRefObject<HTMLSpanElement[]>;
  inputRef: React.MutableRefObject<HTMLInputElement[]>;
}

export const DraggableTextInput = ({
  input,
  index,
  totalInputs,
  scale,
  onMove,
  onChange,
  onKeyDown,
  spanRef,
  inputRef,
}: DraggableTextInputProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffset.current.x;
        const newY = e.clientY - dragOffset.current.y;
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
  }, [isDragging, input.id, onMove, scale]);

  return (
    <div
      className="absolute z-[999]"
      style={{
        left: `${input.x}px`,
        top: `${input.y}px`,
      }}
    >
      <div className="relative">
        {/* Drag Handle - Inside input on the left */}
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
          className="pl-8 pr-3 py-2 bg-[var(--background)] border-2 border-[#7f22fe] rounded-md shadow-lg text-gray-900 dark:text-gray-100 focus:outline-none min-w-[200px] cursor-text"
          placeholder="Type text..."
          ref={(e) => {
            if (e) inputRef.current[index] = e;
          }}
        />
      </div>
    </div>
  );
};
