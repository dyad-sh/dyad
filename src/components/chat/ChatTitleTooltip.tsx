import React, { useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  children: ReactNode;
  content: string;
  disabled?: boolean;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  children, 
  content, 
  disabled = false,
  className = ""
}) => {
  const [tooltipData, setTooltipData] = useState<{
    content: string;
    x: number;
    y: number;
  } | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (disabled || !content) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipData({
      content,
      x: rect.right + 22, 
      y: rect.top - 10 
    });
  };

  const handleMouseLeave = () => {
    setTooltipData(null);
  };

  return (
    <>
      <div
        className={`inline-block ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>

      {/* Portal tooltip */}
      {tooltipData && createPortal(
        <div
          className="fixed bg-blue-100 text-gray-700 text-sm rounded-lg px-3 py-2 z-[9999] pointer-events-none shadow-lg border border-gray-600"
          style={{
            left: tooltipData.x,
            top: tooltipData.y,
            transform: 'translate(-50%, -100%)',
            whiteSpace: 'nowrap',
            wordBreak: 'break-word',
          }}
        >
          {tooltipData.content}
        </div>,
        document.body
      )}
    </>
  );
};