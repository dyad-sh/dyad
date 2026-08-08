import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  trail: { x: number; y: number }[];
}

const BG_COLOR = "#0a0a0f";
const PARTICLE_COUNT = 64;
const CONNECT_DISTANCE = 140;
const MOUSE_RADIUS = 180;
const MOUSE_FORCE = 0.14;
const HEX_SIZE = 38;

function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pulse: number,
) {
  const alpha = 0.025 + pulse * 0.02;
  ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
  ctx.lineWidth = 0.6;

  const hexWidth = HEX_SIZE * Math.sqrt(3);
  const hexHeight = HEX_SIZE * 2;
  const xStep = hexWidth;
  const yStep = hexHeight * 0.75;

  for (let row = -1; row < height / yStep + 1; row++) {
    for (let col = -1; col < width / xStep + 1; col++) {
      const x = col * xStep + (row % 2) * (xStep / 2);
      const y = row * yStep;
      drawHex(ctx, x, y, HEX_SIZE);
    }
  }
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + size * Math.cos(angle);
    const py = y + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  pulse: number,
) {
  const alpha = 0.06 + pulse * 0.04;
  ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
  ctx.lineWidth = 1;

  const segments = 4;
  const gap = Math.PI / 6;
  const segArc = (Math.PI * 2 - segments * gap) / segments;

  for (let i = 0; i < segments; i++) {
    const start = rotation + i * (segArc + gap);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + segArc);
    ctx.stroke();
  }
}

function drawScanLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scanY: number,
) {
  const gradient = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
  gradient.addColorStop(0, "rgba(0, 229, 255, 0)");
  gradient.addColorStop(0.5, "rgba(0, 229, 255, 0.04)");
  gradient.addColorStop(1, "rgba(0, 229, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, scanY - 40, width, 80);

  ctx.strokeStyle = "rgba(0, 229, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, scanY);
  ctx.lineTo(width, scanY);
  ctx.stroke();
}

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pulse: number,
) {
  const size = 28;
  const alpha = 0.35 + pulse * 0.15;
  ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
  ctx.lineWidth = 1.5;

  const corners = [
    { x: 0, y: 0, dx: 1, dy: 1 },
    { x: width, y: 0, dx: -1, dy: 1 },
    { x: 0, y: height, dx: 1, dy: -1 },
    { x: width, y: height, dx: -1, dy: -1 },
  ];

  for (const c of corners) {
    ctx.beginPath();
    ctx.moveTo(c.x + c.dx * size, c.y);
    ctx.lineTo(c.x + c.dx * 4, c.y);
    ctx.lineTo(c.x, c.y + c.dy * 4);
    ctx.lineTo(c.x, c.y + c.dy * size);
    ctx.stroke();
  }
}

function drawVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pulse: number,
) {
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  gradient.addColorStop(0, `rgba(6, 20, 40, ${0.12 + pulse * 0.06})`);
  gradient.addColorStop(0.5, "rgba(3, 10, 24, 0.6)");
  gradient.addColorStop(1, "rgba(2, 4, 12, 0.95)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function JarvisBackground({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const pulseRef = useRef(0);
  const rafRef = useRef(0);
  const scanYRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const initParticles = () => {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.6 + 0.6,
        alpha: Math.random() * 0.4 + 0.3,
        trail: [],
      }));
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particlesRef.current.length === 0) {
        initParticles();
      }
    };

    const animate = () => {
      pulseRef.current += 0.015;
      const pulse = (Math.sin(pulseRef.current) + 1) / 2;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;

      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, width, height);

      // Hex grid
      drawHexGrid(ctx, width, height, pulse);

      // Rotating rings
      const cx = width / 2;
      const cy = height / 2;
      const ringBase = Math.min(width, height) * 0.18;
      drawRing(ctx, cx, cy, ringBase, pulseRef.current * 0.08, pulse);
      drawRing(ctx, cx, cy, ringBase * 1.5, -pulseRef.current * 0.05, pulse);
      drawRing(ctx, cx, cy, ringBase * 2.2, pulseRef.current * 0.03, pulse);

      // Scan line
      scanYRef.current += height * 0.002;
      if (scanYRef.current > height + 80) scanYRef.current = -80;
      drawScanLine(ctx, width, height, scanYRef.current);

      // Update particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x <= 0 || p.x >= width) p.vx *= -1;
        if (p.y <= 0 || p.y >= height) p.vy *= -1;
        p.x = Math.max(0, Math.min(width, p.x));
        p.y = Math.max(0, Math.min(height, p.y));

        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < MOUSE_RADIUS && dist > 1) {
          const force = ((MOUSE_RADIUS - dist) / MOUSE_RADIUS) * MOUSE_FORCE;
          p.vx -= (dx / dist) * force;
          p.vy -= (dy / dist) * force;
        }

        p.vx *= 0.991;
        p.vy *= 0.991;

        // Trail
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 6) p.trail.shift();
      }

      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONNECT_DISTANCE) {
            const alpha =
              (1 - dist / CONNECT_DISTANCE) * 0.18 * (0.6 + pulse * 0.4);
            ctx.strokeStyle = `rgba(0, 229, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Particle trails + dots
      for (const p of particles) {
        // Draw trail
        if (p.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(p.trail[0].x, p.trail[0].y);
          for (let i = 1; i < p.trail.length; i++) {
            ctx.lineTo(p.trail[i].x, p.trail[i].y);
          }
          const trailAlpha = p.alpha * 0.25 * (0.6 + pulse * 0.4);
          ctx.strokeStyle = `rgba(34, 211, 238, ${trailAlpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        const glow = 0.5 + pulse * 0.5;
        ctx.shadowBlur = 12 * glow;
        ctx.shadowColor = `rgba(0, 229, 255, ${0.7 * glow})`;
        ctx.fillStyle = `rgba(34, 211, 238, ${0.4 + pulse * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Corner brackets
      drawCornerBrackets(ctx, width, height, pulse);

      // Vignette
      drawVignette(ctx, width, height, pulse);

      rafRef.current = requestAnimationFrame(animate);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) {
        mouseRef.current = { x: -9999, y: -9999 };
        return;
      }
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };

    resize();
    rafRef.current = requestAnimationFrame(animate);

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener("mousemove", onMouseMove);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      aria-hidden
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div className="jarvis-pulse-overlay absolute inset-0" />
      <div className="jarvis-scan-overlay absolute inset-0" />
    </div>
  );
}
