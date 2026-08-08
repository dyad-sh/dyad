import { useState, useEffect } from "react";

interface SimpleAvatarProps {
  src?: string;
  alt?: string;
  fallbackText?: string;
}

export function SimpleAvatar({ src, alt, fallbackText }: SimpleAvatarProps) {
  const [hasError, setHasError] = useState(false);

  // Reset error state when src changes so new images can be attempted
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const showImage = src && !hasError;

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden text-xs font-medium">
      {showImage ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <span>{fallbackText}</span>
      )}
    </div>
  );
}
