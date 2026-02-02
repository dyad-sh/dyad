import { motion } from "framer-motion";

interface StreamingLoadingAnimationProps {
  variant: "initial" | "streaming";
}

/**
 * A delightful loading animation for chat streaming.
 * - "initial" variant: Shown when waiting for the first response (no content yet)
 * - "streaming" variant: Shown inline when content is being streamed
 */
export function StreamingLoadingAnimation({
  variant,
}: StreamingLoadingAnimationProps) {
  if (variant === "initial") {
    return <InitialLoadingAnimation />;
  }
  return <StreamingIndicator />;
}

/**
 * A flowing wave animation with glowing orbs for the initial loading state.
 * Creates an organic, "thinking" feel.
 */
function InitialLoadingAnimation() {
  const orbs = [0, 1, 2, 3, 4];

  return (
    <div className="flex h-8 items-center justify-start gap-1 p-2">
      {orbs.map((index) => (
        <motion.div
          key={index}
          className="relative"
          animate={{
            y: [0, -8, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 1.2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
            delay: index * 0.15,
          }}
        >
          {/* Glow effect */}
          <motion.div
            className="absolute inset-0 rounded-full bg-blue-400/40 blur-sm"
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.4, 0.8, 0.4],
            }}
            transition={{
              duration: 1.2,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
              delay: index * 0.15,
            }}
          />
          {/* Core orb with gradient */}
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background:
                "linear-gradient(135deg, var(--primary) 0%, #60a5fa 50%, #a78bfa 100%)",
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * A subtle pulsing indicator shown while content is streaming.
 * Uses a morphing shape animation.
 */
function StreamingIndicator() {
  return (
    <div className="mt-3 ml-1 flex items-center gap-2">
      <motion.div
        className="relative flex items-center justify-center"
        animate={{ rotate: 360 }}
        transition={{
          duration: 3,
          repeat: Number.POSITIVE_INFINITY,
          ease: "linear",
        }}
      >
        {/* Outer ring */}
        <motion.div
          className="absolute h-5 w-5 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: "var(--primary)",
            borderRightColor: "rgba(var(--primary-rgb, 59, 130, 246), 0.3)",
          }}
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.8, 1, 0.8],
          }}
          transition={{
            duration: 1.5,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
        {/* Inner pulsing dot */}
        <motion.div
          className="h-2 w-2 rounded-full"
          style={{
            background:
              "linear-gradient(135deg, var(--primary) 0%, #60a5fa 100%)",
          }}
          animate={{
            scale: [0.8, 1.2, 0.8],
            opacity: [0.6, 1, 0.6],
          }}
          transition={{
            duration: 1,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </motion.div>
      {/* Animated text hint */}
      <motion.span
        className="text-xs text-muted-foreground"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{
          duration: 2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        generating...
      </motion.span>
    </div>
  );
}
