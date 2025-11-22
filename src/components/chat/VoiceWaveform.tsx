import React, { useEffect, useRef } from "react";

interface VoiceWaveformProps {
  analyser: AnalyserNode | null;
}

export function VoiceWaveform({ analyser }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      // Draw bars
      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2; // Scale down height

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, "#a855f7"); // Purple
        gradient.addColorStop(1, "#3b82f6"); // Blue

        ctx.fillStyle = gradient;

        // Center vertically
        const y = (canvas.height - barHeight) / 2;

        // Rounded caps simulation (simple rect for now)
        ctx.fillRect(x, y, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser]);

  return (
    <div className="w-full h-[52px] flex items-center justify-center bg-muted/30 rounded-md overflow-hidden border border-border/50">
      <canvas
        ref={canvasRef}
        width={600}
        height={100}
        className="w-full h-full opacity-80"
      />
      <div className="absolute text-xs font-medium text-muted-foreground animate-pulse">
        Listening...
      </div>
    </div>
  );
}
